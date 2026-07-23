/**
 * 首页 - 录入页面
 * 极简输入框 + 粘贴/发送按钮
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clipboard } from '@capacitor/clipboard';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { TagSelector } from '@/components/TagSelector/TagSelector';
import { BottomNav } from '@/components/BottomNav';
import './HomePage.css';

type InputMode = 'input' | 'tag' | 'info';

/** 快捷时间预设（分钟后当前时间）*/
const QUICK_TIME_PRESETS: { label: string; offsetMinutes: number }[] = [
  { label: '+30分钟', offsetMinutes: 30 },
  { label: '+1小时', offsetMinutes: 60 },
  { label: '+2小时', offsetMinutes: 120 },
  { label: '+4小时', offsetMinutes: 240 },
  { label: '今天18点', offsetMinutes: -1 }, // 特殊值，实际计算在函数里
  { label: '明天12点', offsetMinutes: -2 },
];

/** 获取当天指定小时的时间戳 */
function getTodayAtHour(hour: number): number {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

/** 获取明天指定小时的时间戳 */
function getTomorrowAtHour(hour: number): number {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

/** 将时间戳转为 YYYY-MM-DD */
function timestampToFolderDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Clipboard SVG icon */
const ClipboardIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

/** Send SVG icon */
const SendIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/** Tag SVG icon */
const TagIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

/** Paperclip/Attachment SVG icon */
const PaperclipIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

/** Stacked cards SVG icon */
const CardsIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="16" height="14" rx="2" />
    <rect x="6" y="4" width="16" height="14" rx="2" />
  </svg>
);

/** Search SVG icon */
const SearchIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function HomePage() {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<InputMode>('input');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [lastEntryContent, setLastEntryContent] = useState<string | null>(null);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const [isTodoMode, setIsTodoMode] = useState(false);
  const [todoStartTime, setTodoStartTime] = useState<number | undefined>(undefined);
  const [todoEndTime, setTodoEndTime] = useState<number | undefined>(undefined);
  const [todoIsToday, setTodoIsToday] = useState(true);
  const [showTodoAdvanced, setShowTodoAdvanced] = useState(false);
  const [lastTodoId, setLastTodoId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();
  const addEntry = useEntryStore(state => state.addEntry);
  const addTagToEntry = useTagStore(state => state.addTagToEntry);
  const removeTagFromEntry = useTagStore(state => state.removeTagFromEntry);
  const getTagsByEntryId = useTagStore(state => state.getTagsByEntryId);
  const addTodo = useTodoStore(state => state.addTodo);

  // 自动聚焦
  useEffect(() => {
    if (mode === 'input' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // 显示轻提示
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, []);

  // 读取剪贴板
  const readClipboard = useCallback(async () => {
    try {
      const { value } = await Clipboard.read();
      if (value) {
        setContent(value);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    } catch {
      // 剪贴板读取失败，静默处理
    }
  }, []);

  // 发送/录入
  const handleSend = useCallback(async () => {
    if (!content.trim()) return;

    if (isTodoMode) {
      // 待办模式：创建待办
      const now = Date.now();
      const startTime = todoStartTime;
      const endTime = todoEndTime;
      // folderDate 以开始时间为准，没开始时间则用当天
      const refTime = startTime || now;
      const folderDate = timestampToFolderDate(refTime);
      const todo = await addTodo({
        title: content.trim(),
        startTime,
        endTime,
        isToday: todoIsToday,
        folderDate,
      });
      setLastTodoId(todo.id);
      setContent('');
      showToastMessage('待办已创建');

      // 3秒后弹出「添加更多信息」提示
      if (modeTimerRef.current) {
        clearTimeout(modeTimerRef.current);
      }
      // 快速提示后重置高级选项
      setTodoStartTime(undefined);
      setTodoEndTime(undefined);
      setShowTodoAdvanced(false);
      return;
    }

    const entry = await addEntry(content.trim());
    setLastEntryId(entry.id);
    setLastEntryContent(content.trim());
    setContent('');
    showToastMessage('已入库');

    // 切换到标签/信息选择模式
    setMode('tag');

    // 3秒后自动回退到输入模式
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    modeTimerRef.current = setTimeout(() => {
      setMode('input');
    }, 3000);
  }, [content, addEntry, showToastMessage, isTodoMode, todoStartTime, todoEndTime, todoIsToday, addTodo]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 选择添加标签
  const handleAddTag = useCallback(async () => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    if (!lastEntryId) {
      showToastMessage('无法获取条目ID');
      setMode('input');
      return;
    }
    // 加载当前条目已有的标签
    const existingTags = await getTagsByEntryId(lastEntryId);
    setPendingTagIds(existingTags.map(t => t.id));
    setShowTagSelector(true);
    setMode('input');
  }, [lastEntryId, getTagsByEntryId, showToastMessage]);

  // 确认保存标签
  const handleConfirmTags = useCallback(async () => {
    if (!lastEntryId) return;
    try {
      const existingTags = await getTagsByEntryId(lastEntryId);
      const currentTagIds = new Set(existingTags.map(t => t.id));
      const newTagIds = new Set(pendingTagIds);

      // 添加新标签
      for (const tagId of pendingTagIds) {
        if (!currentTagIds.has(tagId)) {
          await addTagToEntry(lastEntryId, tagId);
        }
      }

      // 移除旧标签
      for (const tagId of currentTagIds) {
        if (!newTagIds.has(tagId)) {
          await removeTagFromEntry(lastEntryId, tagId);
        }
      }

      setShowTagSelector(false);
      showToastMessage('标签已保存');
    } catch (err) {
      console.error('保存标签失败:', err);
      showToastMessage('保存失败');
    }
  }, [lastEntryId, pendingTagIds, getTagsByEntryId, addTagToEntry, removeTagFromEntry, showToastMessage]);

  // 选择添加信息
  const handleAddInfo = useCallback(() => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    if (!lastEntryId) {
      showToastMessage('无法获取条目ID');
      setMode('input');
      return;
    }
    setMode('input');
    navigate(`/entry/${lastEntryId}/edit`);
  }, [lastEntryId, navigate, showToastMessage]);

  // 处理快捷时间预设
  const handleQuickTime = useCallback((preset: typeof QUICK_TIME_PRESETS[0], target: 'start' | 'end') => {
    let ts: number;
    if (preset.offsetMinutes === -1) {
      ts = getTodayAtHour(18);
    } else if (preset.offsetMinutes === -2) {
      ts = getTomorrowAtHour(12);
    } else {
      ts = Date.now() + preset.offsetMinutes * 60 * 1000;
    }
    if (target === 'start') {
      setTodoStartTime(ts);
    } else {
      setTodoEndTime(ts);
    }
  }, []);

  return (
    <div className="home-page">
      <main className="page-content">
        <div className="center-area">
        {mode === 'input' ? (
          <div className="input-section">
            <div className="input-wrapper glass">
              <textarea
                ref={textareaRef}
                className="content-input"
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isTodoMode ? '开始你的规划...' : '记录你的想法...'}
                rows={4}
              />
            </div>

            {/* 待办模式切换 */}
            <label className="todo-mode-toggle">
              <input
                type="checkbox"
                checked={isTodoMode}
                onChange={e => {
                  setIsTodoMode(e.target.checked);
                  if (!e.target.checked) {
                    setShowTodoAdvanced(false);
                    setTodoStartTime(undefined);
                    setTodoEndTime(undefined);
                  }
                }}
              />
              <span>待办模式</span>
            </label>

            {/* 待办高级选项 */}
            {isTodoMode && (
              <div className="todo-advanced">
                <button
                  className="todo-advanced-toggle"
                  onClick={() => setShowTodoAdvanced(!showTodoAdvanced)}
                >
                  <span>{showTodoAdvanced ? '收起选项' : '高级选项'}</span>
                </button>
                {showTodoAdvanced && (
                  <div className="todo-advanced-body glass">
                    {/* 开始时间 */}
                    <div className="todo-time-group">
                      <label className="todo-time-label">开始时间</label>
                      <div className="todo-time-presets">
                        {QUICK_TIME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            className={`todo-preset-chip ${todoStartTime && preset.label === 'test' ? 'active' : ''}`}
                            onClick={() => handleQuickTime(preset, 'start')}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="datetime-local"
                        className="todo-time-input glass"
                        value={todoStartTime ? new Date(todoStartTime).toISOString().slice(0, 16) : ''}
                        onChange={e => setTodoStartTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
                      />
                    </div>

                    {/* 结束时间 */}
                    <div className="todo-time-group">
                      <label className="todo-time-label">结束时间</label>
                      <div className="todo-time-presets">
                        {QUICK_TIME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            className="todo-preset-chip"
                            onClick={() => handleQuickTime(preset, 'end')}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="datetime-local"
                        className="todo-time-input glass"
                        value={todoEndTime ? new Date(todoEndTime).toISOString().slice(0, 16) : ''}
                        onChange={e => setTodoEndTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
                      />
                    </div>

                    {/* 今日处理 */}
                    <label className="todo-mode-toggle">
                      <input
                        type="checkbox"
                        checked={todoIsToday}
                        onChange={e => setTodoIsToday(e.target.checked)}
                      />
                      <span>今日处理</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="input-actions">
              <button className="action-btn secondary" onClick={readClipboard}>
                <span className="btn-icon">{ClipboardIcon}</span>
                <span>粘贴</span>
              </button>
              <button
                className="action-btn primary"
                onClick={handleSend}
                disabled={!content.trim()}
              >
                <span className="btn-icon">{SendIcon}</span>
                <span>发送</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mode-section">
            <p className="mode-hint">为上一条添加信息？</p>
            <div className="mode-actions">
              <button className="mode-btn glass" onClick={handleAddTag}>
                <span className="btn-icon">{TagIcon}</span>
                <span>添加标签</span>
              </button>
              <button className="mode-btn glass" onClick={handleAddInfo}>
                <span className="btn-icon">{PaperclipIcon}</span>
                <span>添加信息</span>
              </button>
            </div>
            <p className="mode-timer">3秒后自动回退...</p>
          </div>
        )}
        </div>

        {/* 快捷入口 */}
        <div className="quick-actions">
          <button className="quick-btn glass" onClick={() => navigate('/random')}>
            <span className="btn-icon">{CardsIcon}</span>
            <span>随机浏览</span>
          </button>
          <button className="quick-btn glass" onClick={() => navigate('/search')}>
            <span className="btn-icon">{SearchIcon}</span>
            <span>搜索</span>
          </button>
        </div>
      </main>

      {/* 标签选择器弹层 */}
      {showTagSelector && (
        <div className="home-tag-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="home-tag-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={pendingTagIds}
              onSelectionChange={setPendingTagIds}
              onClose={() => setShowTagSelector(false)}
              entryId={lastEntryId ?? undefined}
              entryContent={lastEntryContent ?? undefined}
            />
            <div className="home-tag-actions">
              <button
                className="home-tag-btn home-tag-cancel"
                onClick={() => setShowTagSelector(false)}
              >
                取消
              </button>
              <button
                className="home-tag-btn home-tag-confirm"
                onClick={handleConfirmTags}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {showToast && (
        <div className="toast glass">
          <span>{toastMessage}</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
