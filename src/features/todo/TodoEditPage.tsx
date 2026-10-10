/**
 * 待办编辑页 v2
 * 编辑字段：标题、开始时间、结束时间、今日处理、标签、备注
 * v2 变更：
 * - c: 支持添加图片附件
 * - c: 待办删除时图片附件不保留
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { BottomNav } from '@/components/BottomNav';
import { getTodoDatabase } from '@/services/todoDatabase';
import { pickImages, saveImageForTodo, readTodoThumbAsSrc, deleteTodoAttachmentFiles, deleteAllTodoAttachments } from '@/services/todoAttachmentService';
import { getTodoAttachments as loadTodoAttachmentsMeta, appendTodoAttachment, removeTodoAttachment, clearTodoAttachments } from '@/services/todoAttachmentsMeta';
import { markTodoTagClicked, sortTodoTagsByRecent, clearTodoTagRecent } from '@/utils/todoTagRecent';
import type { Todo, TodoAttachment } from '@/types';
import './TodoEditPage.css';

/** 格式化时间戳为 datetime-local input 值 */
function toDateTimeLocal(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(ts - offset).toISOString().slice(0, 16);
}

/** 快捷时间预设
 * type: 'relative' = 基于已选时间递增/递减
 * type: 'absolute' = 绝对时间
 */
const TIME_PRESETS: { label: string; offsetMinutes: number; type: 'relative' | 'absolute' }[] = [
  { label: '-10分钟', offsetMinutes: -10, type: 'relative' },
  { label: '当前时间', offsetMinutes: 0, type: 'absolute' },
  { label: '+30分钟', offsetMinutes: 30, type: 'relative' },
  { label: '+1小时', offsetMinutes: 60, type: 'relative' },
  { label: '+4小时', offsetMinutes: 240, type: 'relative' },
  { label: '明天6点', offsetMinutes: -3, type: 'absolute' },
];

/** 获取明天指定小时的时间戳 */
function getTomorrowAtHour(hour: number): number {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

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
  // v2.10.0: 已有标签的编辑状态（改名 / 改色 / 删除）
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('#f76707');
  // c: 图片附件状态
  const [attachments, setAttachments] = useState<TodoAttachment[]>([]);
  const [thumbSrcs, setThumbSrcs] = useState<Record<string, string>>({});
  const [isPickingImages, setIsPickingImages] = useState(false);
  const todoIdRef = useRef<string | null>(null);

  const updateTodo = useTodoStore(state => state.updateTodo);
  const addTodo = useTodoStore(state => state.addTodo);
  const deleteTodo = useTodoStore(state => state.deleteTodo);
  const tags = useTodoTagStore(state => state.tags);
  const loadTags = useTodoTagStore(state => state.loadTags);
  const createTag = useTodoTagStore(state => state.createTag);
  const updateTag = useTodoTagStore(state => state.updateTag);
  const deleteTag = useTodoTagStore(state => state.deleteTag);

  // v2.10.0: 标签排序 —— 最近点击过的浮到最前（记录在进入页面时读取，编辑中不跳位）
  const sortedTags = useMemo(() => sortTodoTagsByRecent(tags), [tags]);

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
        // c: 加载附件（从 localStorage 元数据）
        const loadedAtts = loadTodoAttachmentsMeta(todo.id);
        if (loadedAtts.length > 0) {
          setAttachments(loadedAtts);
          todoIdRef.current = todo.id;
          // 异步加载缩略图
          const srcs: Record<string, string> = {};
          for (const att of loadedAtts) {
            const src = await readTodoThumbAsSrc(att.thumbPath);
            if (src) srcs[att.id] = src;
          }
          if (!cancelled) setThumbSrcs(srcs);
        }
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
  const handlePresetTime = useCallback((preset: typeof TIME_PRESETS[0], target: 'start' | 'end') => {
    const currentVal = target === 'start' ? startTime : endTime;
    let ts: number;
    if (preset.type === 'absolute') {
      if (preset.offsetMinutes === 0) {
        // 当前时间
        ts = Date.now();
      } else if (preset.offsetMinutes === -3) {
        // 明天6点
        ts = getTomorrowAtHour(6);
      } else {
        ts = Date.now();
      }
    } else {
      // relative: 基于当前已选时间或当前时间
      const base = currentVal ?? Date.now();
      ts = base + preset.offsetMinutes * 60 * 1000;
    }
    if (target === 'start') setStartTime(ts);
    else setEndTime(ts);
  }, [startTime, endTime]);

  // c: 删除待办时同时删除图片附件
  const handleDelete = useCallback(async () => {
    if (isNew || !id) return;
    if (!confirm('确定删除这条待办吗？')) return;
    try {
      // c: 删除所有附件文件
      if (attachments.length > 0) {
        await deleteAllTodoAttachments(attachments);
      }
      // c: 清除 localStorage 中的附件元数据
      if (id) {
        clearTodoAttachments(id);
      }
      await deleteTodo(id);
      navigate('/todo');
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, [isNew, id, attachments, deleteTodo, navigate]);

  // c: 选择图片附件
  const handlePickImages = useCallback(async () => {
    setIsPickingImages(true);
    try {
      // 为新待办生成临时 ID，保存后迁移
      const tempId = id && id !== 'new' ? id : `temp_${Date.now()}`;
      todoIdRef.current = tempId;
      const images = await pickImages(9);
      for (const img of images) {
        const att = await saveImageForTodo(tempId, img);
        // c: 保存附件元数据到 localStorage
        const fullAtt: TodoAttachment = {
          ...att,
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          todoId: tempId,
        };
        appendTodoAttachment(tempId, fullAtt);
        setAttachments(prev => [...prev, fullAtt]);
        const src = await readTodoThumbAsSrc(fullAtt.thumbPath);
        if (src) setThumbSrcs(prev => ({ ...prev, [fullAtt.id]: src }));
      }
    } catch (err) {
      console.error('[TodoEditPage] pickImages failed:', err);
    } finally {
      setIsPickingImages(false);
    }
  }, [id]);

  // c: 删除附件
  const handleDeleteAttachment = useCallback(async (att: TodoAttachment) => {
    if (!confirm('删除这张图片？')) return;
    await deleteTodoAttachmentFiles(att);
    removeTodoAttachment(att.todoId, att.id);
    setAttachments(prev => prev.filter(a => a.id !== att.id));
    setThumbSrcs(prev => {
      const next = { ...prev };
      delete next[att.id];
      return next;
    });
  }, []);

  // 创建新标签（同名标签会复用已有记录，需去重避免重复选中）
  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    const tag = await createTag(newTagName.trim(), newTagColor);
    setSelectedTagIds(prev => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
    setNewTagName('');
    setShowTagEditor(false);
  }, [newTagName, newTagColor, createTag]);

  // v2.10.0: 打开已有标签的编辑面板（改名 / 改色 / 删除）
  const handleOpenTagEdit = useCallback((tag: { id: string; name: string; color?: string }) => {
    setShowTagEditor(false);
    setEditingTagId(tag.id);
    setEditTagName(tag.name);
    setEditTagColor(tag.color || '#f76707');
  }, []);

  // v2.10.0: 保存标签编辑（改名 / 改色）
  const handleSaveTagEdit = useCallback(async () => {
    if (!editingTagId) return;
    const name = editTagName.trim();
    if (!name) return;
    // 重名检查（排除自己；标签池 name 有 UNIQUE 约束，撞名会直接写库失败）
    if (tags.some(t => t.id !== editingTagId && t.name === name)) {
      alert(`已存在同名标签"${name}"，请换一个名称`);
      return;
    }
    try {
      await updateTag(editingTagId, { name, color: editTagColor });
    } catch (err) {
      alert('保存失败：' + (err instanceof Error ? err.message : '未知错误'));
      return;
    }
    setEditingTagId(null);
  }, [editingTagId, editTagName, editTagColor, tags, updateTag]);

  // v2.10.0: 从编辑面板删除标签（从标签池移除，待办上的关联由数据层清理）
  const handleDeleteTagFromEditor = useCallback(async () => {
    if (!editingTagId) return;
    const tag = tags.find(t => t.id === editingTagId);
    if (!tag) return;
    if (!confirm(`确定删除标签 "${tag.name}" 吗？删除后无法恢复`)) return;
    try {
      await deleteTag(editingTagId);
      clearTodoTagRecent(editingTagId);
      setSelectedTagIds(prev => prev.filter(t => t !== editingTagId));
    } catch (err) {
      alert('删除失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
    setEditingTagId(null);
  }, [editingTagId, tags, deleteTag]);

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
                  onClick={() => handlePresetTime(p, 'start')}
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
                  onClick={() => handlePresetTime(p, 'end')}
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
            {/* 可选标签列表（单击选中；右侧 ✎ 编辑；v2.10.0 按最近点击排序） */}
            <div className="tag-list">
              {sortedTags.map(tag => (
                <span key={tag.id} className="tag-chip-wrap">
                  <button
                    className={`tag-chip ${selectedTagIds.includes(tag.id) ? 'active' : ''}`}
                    style={tag.color ? { borderColor: selectedTagIds.includes(tag.id) ? tag.color : undefined } : undefined}
                    onClick={() => {
                      // v2.10.0: 记录点击，下次进入编辑页时该标签排到最前
                      markTodoTagClicked(tag.id);
                      setSelectedTagIds(prev =>
                        prev.includes(tag.id)
                          ? prev.filter(t => t !== tag.id)
                          : [...prev, tag.id] // 追加到末尾：最近添加的在右侧
                      );
                    }}
                    onDoubleClick={() => {
                      // 双击删除整个标签（保留快捷方式；也可用右侧 ✎ 打开编辑面板）
                      if (confirm(`确定删除标签 "${tag.name}" 吗？`)) {
                        deleteTag(tag.id);
                        clearTodoTagRecent(tag.id);
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
                  <button
                    className="tag-chip-edit"
                    title="编辑标签（改名 / 改色 / 删除）"
                    onClick={() => handleOpenTagEdit(tag)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                </span>
              ))}
              <button
                className="tag-add-btn"
                onClick={() => { setShowTagEditor(!showTagEditor); setEditingTagId(null); }}
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

            {/* v2.10.0: 已有标签编辑面板（改名 / 改色 / 删除） */}
            {editingTagId && (
              <div className="tag-editor glass">
                <div className="tag-editor-title">
                  编辑标签「{tags.find(t => t.id === editingTagId)?.name || ''}」
                </div>
                <input
                  type="text"
                  className="form-input glass"
                  value={editTagName}
                  onChange={e => setEditTagName(e.target.value)}
                  placeholder="标签名..."
                />
                <div className="color-picker">
                  <input
                    type="color"
                    value={editTagColor}
                    onChange={e => setEditTagColor(e.target.value)}
                  />
                  <span className="color-hint">标签颜色</span>
                </div>
                <div className="tag-editor-actions">
                  <button className="tag-editor-delete" onClick={handleDeleteTagFromEditor}>
                    删除标签
                  </button>
                  <button className="tag-editor-cancel" onClick={() => setEditingTagId(null)}>
                    取消
                  </button>
                  <button
                    className="tag-editor-confirm"
                    onClick={handleSaveTagEdit}
                    disabled={!editTagName.trim()}
                  >
                    保存
                  </button>
                </div>
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

          {/* c: 图片附件 */}
          <div className="form-group">
            <label className="form-label">图片附件</label>
            <div className="todo-attachments">
              {attachments.map(att => (
                <div key={att.id} className="todo-attachment-item">
                  {thumbSrcs[att.id] && (
                    <img src={thumbSrcs[att.id]} alt="附件" className="todo-attachment-thumb" />
                  )}
                  <button
                    className="todo-attachment-delete"
                    onClick={() => handleDeleteAttachment(att)}
                    title="删除"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                className="todo-attachment-add"
                onClick={handlePickImages}
                disabled={isPickingImages}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{isPickingImages ? '选择中...' : '添加图片'}</span>
              </button>
            </div>
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
