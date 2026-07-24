/**
 * 待办编辑页
 * 编辑字段：标题、开始时间、结束时间、今日处理、标签、备注
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { BottomNav } from '@/components/BottomNav';
import { getTodoDatabase } from '@/services/todoDatabase';
import type { Todo } from '@/types';
import './TodoEditPage.css';

/** 格式化时间戳为 datetime-local input 值 */
function toDateTimeLocal(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(ts - offset).toISOString().slice(0, 16);
}

/** 快捷时间预设 */
const TIME_PRESETS = [
  { label: '+30分钟', minutes: 30 },
  { label: '+1小时', minutes: 60 },
  { label: '+2小时', minutes: 120 },
  { label: '+4小时', minutes: 240 },
];

export function TodoEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new' || !id;

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [startTime, setStartTime] = useState<number | undefined>(undefined);
  const [endTime, setEndTime] = useState<number | undefined>(undefined);
  // 今日处理默认不选中：避免新建/编辑时误打标
  const [isToday, setIsToday] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#f76707');

  const updateTodo = useTodoStore(state => state.updateTodo);
  const addTodo = useTodoStore(state => state.addTodo);
  const deleteTodo = useTodoStore(state => state.deleteTodo);
  const tags = useTodoTagStore(state => state.tags);
  const loadTags = useTodoTagStore(state => state.loadTags);
  const createTag = useTodoTagStore(state => state.createTag);

  // 加载标签列表
  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // 加载已有待办：主动按 id 查库，避免依赖外部 currentTodo 未设置导致字段为空
  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = await getTodoDatabase();
        const todo = await db.getTodoById(id);
        if (cancelled || !todo) {
          if (!cancelled) setLoading(false);
          return;
        }
        setTitle(todo.title);
        setNote(todo.note || '');
        setStartTime(todo.startTime);
        setEndTime(todo.endTime);
        setIsToday(todo.isToday);
        setSelectedTagIds(todo.tagIds || []);
      } catch (err) {
        console.error('[TodoEditPage] load todo failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, id]);

  // 保存
  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const refTime = startTime || Date.now();
      const folderDate = timestampToFolderDate(refTime);

      if (isNew) {
        await addTodo({
          title: title.trim(),
          note: note.trim() || undefined,
          startTime,
          endTime,
          isToday,
          folderDate,
          tagIds: selectedTagIds,
        });
      } else if (id) {
        await updateTodo(id, {
          title: title.trim(),
          note: note.trim() || undefined,
          startTime,
          endTime,
          isToday,
          tagIds: selectedTagIds,
          folderDate,
        });
      }
      navigate('/todo');
    } finally {
      setSaving(false);
    }
  }, [title, note, startTime, endTime, isToday, selectedTagIds, isNew, id, addTodo, updateTodo, navigate]);

  // 快捷设置时间
  const handlePresetTime = useCallback((minutes: number, target: 'start' | 'end') => {
    const ts = Date.now() + minutes * 60 * 1000;
    if (target === 'start') setStartTime(ts);
    else setEndTime(ts);
  }, []);

  // 删除整条待办
  const handleDelete = useCallback(async () => {
    if (isNew || !id) return;
    if (!confirm('确定删除这条待办吗？')) return;
    try {
      await deleteTodo(id);
      navigate('/todo');
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, [isNew, id, deleteTodo, navigate]);

  // 创建新标签
  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    const tag = await createTag(newTagName.trim(), newTagColor);
    setSelectedTagIds(prev => [...prev, tag.id]);
    setNewTagName('');
    setShowTagEditor(false);
  }, [newTagName, newTagColor, createTag]);

  if (loading) {
    return (
      <div className="todo-edit-page">
        <main className="page-content">
          <div className="todo-edit-loading">加载中...</div>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="todo-edit-page">
      <main className="page-content">
        <div className="todo-edit-header">
          <button className="todo-edit-back" onClick={() => navigate('/todo')}>←</button>
          <h2>{isNew ? '新建待办' : '编辑待办'}</h2>
          {!isNew && (
            <button
              className="todo-edit-delete-btn"
              onClick={handleDelete}
              title="删除此待办"
            >
              删除
            </button>
          )}
          <button
            className="todo-edit-save"
            onClick={handleSave}
            disabled={!title.trim() || saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>

        <div className="todo-edit-form">
          {/* 标题 */}
          <div className="form-group">
            <label className="form-label">标题</label>
            <input
              type="text"
              className="form-input glass"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="待办标题..."
              autoFocus
            />
          </div>

          {/* 开始时间 */}
          <div className="form-group">
            <label className="form-label">开始时间</label>
            <div className="time-presets">
              {TIME_PRESETS.map(p => (
                <button
                  key={p.label}
                  className="time-preset-chip"
                  onClick={() => handlePresetTime(p.minutes, 'start')}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              className="form-input glass"
              value={toDateTimeLocal(startTime)}
              onChange={e => setStartTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
            />
          </div>

          {/* 结束时间 */}
          <div className="form-group">
            <label className="form-label">结束时间</label>
            <div className="time-presets">
              {TIME_PRESETS.map(p => (
                <button
                  key={p.label}
                  className="time-preset-chip"
                  onClick={() => handlePresetTime(p.minutes, 'end')}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              className="form-input glass"
              value={toDateTimeLocal(endTime)}
              onChange={e => setEndTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
            />
          </div>

          {/* 今日处理 */}
          <label className="todo-edit-toggle">
            <input
              type="checkbox"
              checked={isToday}
              onChange={e => setIsToday(e.target.checked)}
            />
            <span>今日处理</span>
          </label>

          {/* 标签 */}
          <div className="form-group">
            <label className="form-label">标签</label>
            {/* 已选标签区（带小x删除） */}
            {selectedTagIds.length > 0 && (
              <div className="selected-tags-list">
                {selectedTagIds.map(tagId => {
                  const tag = tags.find(t => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <div
                      key={tagId}
                      className="selected-tag-chip"
                      style={{ borderColor: tag.color || undefined, background: tag.color ? tag.color + '22' : undefined }}
                    >
                      <span
                        className="selected-tag-color-dot"
                        style={{ background: tag.color || 'var(--color-text-tertiary)' }}
                      />
                      <span className="selected-tag-name">{tag.name}</span>
                      <button
                        className="selected-tag-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTagIds(prev => prev.filter(id => id !== tagId));
                        }}
                        title="移除标签"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* 可选标签列表（单击选中，双击删除整个标签） */}
            <div className="tag-list">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  className={`tag-chip ${selectedTagIds.includes(tag.id) ? 'active' : ''}`}
                  style={tag.color ? { borderColor: selectedTagIds.includes(tag.id) ? tag.color : undefined } : undefined}
                  onClick={() => {
                    setSelectedTagIds(prev =>
                      prev.includes(tag.id)
                        ? prev.filter(t => t !== tag.id)
                        : [...prev, tag.id] // 追加到末尾：最近添加的在右侧
                    );
                  }}
                  onDoubleClick={() => {
                    // 双击删除整个标签（从标签池中删除）
                    if (confirm(`确定删除标签 "${tag.name}" 吗？`)) {
                      useTodoTagStore.getState().deleteTag(tag.id);
                      setSelectedTagIds(prev => prev.filter(t => t !== tag.id));
                    }
                  }}
                >
                  <span
                    className="tag-color-dot"
                    style={{ background: tag.color || 'var(--color-text-tertiary)' }}
                  />
                  {tag.name}
                </button>
              ))}
              <button
                className="tag-add-btn"
                onClick={() => setShowTagEditor(!showTagEditor)}
              >
                + 新标签
              </button>
            </div>

            {showTagEditor && (
              <div className="tag-editor glass">
                <input
                  type="text"
                  className="form-input glass"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  placeholder="标签名..."
                />
                <div className="color-picker">
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={e => setNewTagColor(e.target.value)}
                  />
                  <span className="color-hint">标签颜色</span>
                </div>
                <button
                  className="tag-editor-confirm"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                >
                  创建
                </button>
              </div>
            )}
          </div>

          {/* 备注 */}
          <div className="form-group">
            <label className="form-label">备注</label>
            <textarea
              className="form-input glass"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="添加备注..."
              rows={3}
            />
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

/** 将时间戳转为 YYYY-MM-DD */
function timestampToFolderDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
