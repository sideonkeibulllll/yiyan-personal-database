/**
 * 待办日常页面
 * 日期选择器 + 当天待办列表 + 倒计时显示
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { BottomNav } from '@/components/BottomNav';
import type { Todo } from '@/types';
import './TodoPage.css';

/** 格式化日期为 YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 获取接下来 7 天的日期 */
function getUpcomingDates(): { date: Date; label: string; folderDate: string }[] {
  const dates: { date: Date; label: string; folderDate: string }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const label = i === 0 ? '今天' : i === 1 ? '明天' : i === 2 ? '后天' : `${d.getMonth() + 1}/${d.getDate()}`;
    dates.push({ date: d, label, folderDate: formatDate(d) });
  }
  return dates;
}

/** 格式化倒计时 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '已结束';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}天${hours}时${minutes}分`;
  if (hours > 0) return `${hours}时${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

/** 格式化时间显示 */
function formatTime(ts?: number): string {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TodoPage() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return formatDate(today);
  });
  const [now, setNow] = useState(Date.now());
  const [showAddOptions, setShowAddOptions] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [showAddInfo, setShowAddInfo] = useState(false);

  const todos = useTodoStore(state => state.todos);
  const loadTodosByDate = useTodoStore(state => state.loadTodosByDate);
  const addTodo = useTodoStore(state => state.addTodo);
  const toggleDone = useTodoStore(state => state.toggleDone);
  const deleteTodo = useTodoStore(state => state.deleteTodo);
  const isLoading = useTodoStore(state => state.isLoading);
  const settings = useSettingsStore(state => state.settings);

  const upcomingDates = getUpcomingDates();
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // 加载待办
  useEffect(() => {
    loadTodosByDate(selectedDate);
  }, [selectedDate, loadTodosByDate]);

  // 每秒更新倒计时
  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 排序：未完成在上，已完成沉底
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return (a.startTime || 0) - (b.startTime || 0);
  });

  // 下拉添加新待办
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0) {
      setPullDistance(Math.min(diff, 80));
    }
  }, [isPulling]);

  const handleTouchEnd = useCallback(() => {
    if (pullDistance >= 80) {
      navigate('/todo/new');
    }
    setIsPulling(false);
    setPullDistance(0);
  }, [pullDistance, navigate]);

  // 从模板导入
  const handleImportTemplate = useCallback(() => {
    navigate('/todo/templates');
  }, [navigate]);

  // 倒计时条
  const activeTodos = sortedTodos.filter(t => t.status === 'pending' && t.endTime && t.endTime > now);
  const countdownTodos = activeTodos
    .filter(t => (t.endTime! - now) < 60 * 60 * 1000) // < 60 分钟
    .slice(0, 3);

  return (
    <div
      className="todo-page"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <main className="page-content">
        {/* 日期选择器 */}
        <div className="date-selector">
          {upcomingDates.map(d => (
            <button
              key={d.folderDate}
              className={`date-chip ${selectedDate === d.folderDate ? 'active' : ''}`}
              onClick={() => setSelectedDate(d.folderDate)}
            >
              <span className="date-label">{d.label}</span>
              <span className="date-day">{d.date.getDate()}</span>
            </button>
          ))}
        </div>

        {/* 待办列表 */}
        <div className="todo-list" style={{ transform: `translateY(${pullDistance}px)` }}>
          {isLoading ? (
            <div className="todo-loading">加载中...</div>
          ) : sortedTodos.length > 0 ? (
            sortedTodos.map(todo => (
              <TodoItem
                key={todo.id}
                todo={todo}
                now={now}
                onToggleDone={() => toggleDone(todo.id)}
                onDelete={() => deleteTodo(todo.id)}
                onEdit={() => navigate(`/todo/${todo.id}/edit`)}
              />
            ))
          ) : (
            <div className="todo-empty">
              <p>今天还没有待办</p>
              <p className="todo-empty-hint">下拉添加新待办</p>
            </div>
          )}
        </div>

        {/* 从模板导入 */}
        <button className="todo-import-btn glass" onClick={handleImportTemplate}>
          <span>从模板导入</span>
        </button>
      </main>

      {/* 底部倒计时条 */}
      {settings.todo.showCountdown && countdownTodos.length > 0 && (
        <div className="countdown-bar glass">
          {countdownTodos.map(todo => (
            <div key={todo.id} className="countdown-item">
              <span className="countdown-title">{todo.title}</span>
              <span className="countdown-time">{formatCountdown(todo.endTime! - now)}</span>
            </div>
          ))}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

/** 单个待办项 */
interface TodoItemProps {
  todo: Todo;
  now: number;
  onToggleDone: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function TodoItem({ todo, now, onToggleDone, onDelete, onEdit }: TodoItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isSwiping.current = true;
      setSwipeOffset(Math.max(-80, Math.min(80, dx)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeOffset <= -80) {
      // 左滑完成
      onToggleDone();
    } else if (swipeOffset >= 80) {
      // 右滑删除
      onDelete();
    }
    setSwipeOffset(0);
    isSwiping.current = false;
  }, [swipeOffset, onToggleDone, onDelete]);

  // 倒计时显示
  const countdown = todo.endTime && todo.endTime > now ? todo.endTime - now : 0;
  const showCountdown = todo.status === 'pending' && countdown > 0;

  const isDone = todo.status === 'done';

  return (
    <div
      className={`todo-item ${isDone ? 'done' : ''} ${todo.isToday ? 'is-today' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => !isSwiping.current && setShowMenu(!showMenu)}
      style={{ transform: `translateX(${swipeOffset}px)` }}
    >
      <div className="todo-item-main">
        <div className="todo-item-header">
          <span className="todo-item-title">{todo.title}</span>
          {showCountdown && countdown < 60 * 60 * 1000 && (
            <span className="todo-countdown">{formatCountdown(countdown)}</span>
          )}
          {showCountdown && countdown >= 60 * 60 * 1000 && (
            <span className="todo-time-display">{formatTime(todo.endTime)}</span>
          )}
        </div>
        <div className="todo-item-meta">
          <span className="todo-time">{formatTime(todo.startTime)} - {formatTime(todo.endTime)}</span>
          {todo.isToday && <span className="todo-today-badge">今日</span>}
        </div>
        {todo.note && <div className="todo-item-note">{todo.note}</div>}
      </div>

      {/* 滑动背景 */}
      <div className="todo-swipe-left">
        <span>{isDone ? '重新激活' : '完成'}</span>
      </div>
      <div className="todo-swipe-right">
        <span>删除</span>
      </div>

      {/* 长按菜单 */}
      {showMenu && (
        <div className="todo-quick-menu" onClick={e => e.stopPropagation()}>
          <button onClick={onToggleDone}>{isDone ? '重新激活' : '标记完成'}</button>
          <button onClick={onEdit}>编辑</button>
          <button onClick={() => { onDelete(); setShowMenu(false); }}>删除</button>
          <button onClick={() => setShowMenu(false)}>关闭</button>
        </div>
      )}
    </div>
  );
}
