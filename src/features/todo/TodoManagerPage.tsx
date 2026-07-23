/**
 * 待办管理器 - 时间轴视图
 * 左侧 0-24 点时间轴 + 右侧待办卡片
 * 连续块填充着色 + 按日期文件夹 + 批量操作
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { BottomNav } from '@/components/BottomNav';
import type { Todo } from '@/types';
import './TodoManagerPage.css';

/** 系统色板（8 种） */
const COLOR_PALETTE = [
  '#cbb99f', '#e3dfd6', '#f2e1ca', '#806a4d',
  '#9b8568', '#e65c33', '#605039', '#8c7773',
];

/** 格式化日期为 YYYY-MM-DD */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 格式化小时 */
function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function TodoManagerPage() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => formatDate(new Date()));
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<string[]>([]);
  const [showBatchActions, setShowBatchActions] = useState(false);

  const todos = useTodoStore(state => state.todos);
  const loadTodosByDate = useTodoStore(state => state.loadTodosByDate);
  const batchUpdateTime = useTodoStore(state => state.batchUpdateTime);
  const batchAddTags = useTodoStore(state => state.batchAddTags);
  const toggleDone = useTodoStore(state => state.toggleDone);
  const deleteTodo = useTodoStore(state => state.deleteTodo);
  const tags = useTodoTagStore(state => state.tags);

  // 加载选定日期的待办
  useEffect(() => {
    loadTodosByDate(selectedDate);
  }, [selectedDate, loadTodosByDate]);

  // 生成过去 14 天 + 未来 14 天的文件夹
  useEffect(() => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = -14; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      dates.push(formatDate(d));
    }
    setFolders(dates);
  }, []);

  // 时间轴小时（0-24）
  const hours = Array.from({ length: 25 }, (_, i) => i);
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  // 为待办分配颜色
  const getTodoColor = useCallback((todo: Todo, index: number): string => {
    if (todo.tagIds && todo.tagIds.length > 0) {
      const tag = tags.find(t => t.id === todo.tagIds![0]);
      if (tag?.color) return tag.color;
    }
    return COLOR_PALETTE[index % COLOR_PALETTE.length];
  }, [tags]);

  // 排序待办（按开始时间，无开始时间的排最后）
  const sortedTodos = [...todos].sort((a, b) => {
    return (a.startTime || Infinity) - (b.startTime || Infinity);
  });

  // 批量选择
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 批量改时间
  const handleBatchUpdateTime = useCallback(async (offsetMs: number) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await batchUpdateTime(ids, offsetMs);
    setSelectedIds(new Set());
    setShowBatchActions(false);
  }, [selectedIds, batchUpdateTime]);

  // 批量添加标签
  const handleBatchAddTag = useCallback(async (tagId: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await batchAddTags(ids, [tagId]);
    setSelectedIds(new Set());
    setShowBatchActions(false);
  }, [selectedIds, batchAddTags]);

  return (
    <div className="todo-manager-page">
      <main className="page-content">
        <div className="manager-header">
          <button className="manager-back" onClick={() => navigate('/todo')}>←</button>
          <h2>待办管理器</h2>
          <button
            className="manager-batch-btn"
            onClick={() => {
              setBatchMode(!batchMode);
              setSelectedIds(new Set());
            }}
          >
            {batchMode ? '退出批量' : '批量操作'}
          </button>
        </div>

        {/* 文件夹选择 */}
        <div className="folder-selector">
          {folders.map(date => {
            const d = new Date(date);
            const label = `${d.getMonth() + 1}/${d.getDate()}`;
            return (
              <button
                key={date}
                className={`folder-chip ${selectedDate === date ? 'active' : ''}`}
                onClick={() => setSelectedDate(date)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 时间轴视图 */}
        <div className="timeline-view">
          {/* 左侧时间轴 */}
          <div className="timeline-axis">
            {hours.map(h => (
              <div key={h} className="timeline-hour">
                <span className="hour-label">{formatHour(h)}</span>
              </div>
            ))}
          </div>

          {/* 右侧待办卡片区域 */}
          <div className="timeline-content">
            {/* 当前时间指示线 */}
            {selectedDate === formatDate(new Date()) && (
              <div
                className="timeline-now-line"
                style={{ top: `${(currentHour / 24) * 100}%` }}
              >
                <span className="now-label">现在</span>
              </div>
            )}

            {/* 过去时间灰色背景 */}
            {selectedDate === formatDate(new Date()) && (
              <div
                className="timeline-past"
                style={{ height: `${(currentHour / 24) * 100}%` }}
              />
            )}

            {/* 待办卡片 */}
            {sortedTodos.map((todo, index) => {
              const startHour = todo.startTime
                ? new Date(todo.startTime).getHours() + new Date(todo.startTime).getMinutes() / 60
                : 0;
              const endHour = todo.endTime
                ? new Date(todo.endTime).getHours() + new Date(todo.endTime).getMinutes() / 60
                : startHour + 1;

              const top = `${(startHour / 24) * 100}%`;
              const height = `${((endHour - startHour) / 24) * 100}%`;
              const color = getTodoColor(todo, index);
              const isSelected = selectedIds.has(todo.id);

              return (
                <div
                  key={todo.id}
                  className={`timeline-todo-card ${todo.status === 'done' ? 'done' : ''} ${isSelected ? 'selected' : ''}`}
                  style={{
                    top,
                    height,
                    backgroundColor: color + '33',
                    borderLeft: `3px solid ${color}`,
                  }}
                  onClick={() => {
                    if (batchMode) toggleSelect(todo.id);
                    else navigate(`/todo/${todo.id}/edit`);
                  }}
                >
                  <div className="card-title">{todo.title}</div>
                  <div className="card-time">
                    {String(new Date(todo.startTime || 0).getHours()).padStart(2, '0')}:
                    {String(new Date(todo.startTime || 0).getMinutes()).padStart(2, '0')} -
                    {todo.endTime ? `${String(new Date(todo.endTime).getHours()).padStart(2, '0')}:${String(new Date(todo.endTime).getMinutes()).padStart(2, '0')}` : '--:--'}
                  </div>
                  {batchMode && isSelected && <div className="card-check">✓</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 从模板导入 */}
        <button
          className="manager-import-btn"
          onClick={() => navigate('/todo/templates')}
        >
          从模板导入到这一天
        </button>
      </main>

      {/* 批量操作栏 */}
      {batchMode && selectedIds.size > 0 && (
        <div className="batch-actions-bar glass">
          <span className="batch-count">已选 {selectedIds.size} 项</span>
          <div className="batch-actions">
            <button onClick={() => handleBatchUpdateTime(60 * 60 * 1000)}>+1h</button>
            <button onClick={() => handleBatchUpdateTime(-60 * 60 * 1000)}>-1h</button>
            <button onClick={() => handleBatchUpdateTime(24 * 60 * 60 * 1000)}>+1天</button>
            {tags.length > 0 && (
              <select
                onChange={e => e.target.value && handleBatchAddTag(e.target.value)}
                value=""
              >
                <option value="">添加标签...</option>
                {tags.map(tag => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            className="batch-done-btn"
            onClick={() => {
              selectedIds.forEach(id => toggleDone(id));
              setSelectedIds(new Set());
            }}
          >
            批量完成
          </button>
          <button
            className="batch-delete-btn"
            onClick={() => {
              selectedIds.forEach(id => deleteTodo(id));
              setSelectedIds(new Set());
            }}
          >
            批量删除
          </button>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
