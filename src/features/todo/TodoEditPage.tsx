/**
 * 待办编辑页 v3
 *
 * 结构决策：先在卡片上把这条待办"看见"，再逐项调参数。
 * - 上半：一张和待办清单里一模一样的预览卡，标题直接打在卡上，改一个字卡就变
 * - 下半：参数行（52px），点某一行才从底部升起抽屉，控件都住在抽屉里
 * - 顶部 44px 返回条：取消 / 新建·编辑 / 保存（唯一保存入口）
 *
 * 逻辑沿用 v2：字段、保存、删除、标签池编辑、图片附件一个都没有动。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
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

/** 参数行里的时间文案（M/D HH:mm） */
function formatRowTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 预览卡上的时刻（HH:mm） */
function formatClock(ts?: number): string {
  if (!ts) return '--:--';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/** 标签颜色：六个圆点，和卡片左侧那道记号同一个暖色系 */
const TAG_COLORS = ['#f76707', '#f59f00', '#fa5252', '#d6336c', '#6aa8ff', '#46e0a5'];

/** 获取明天指定小时的时间戳 */
function getTomorrowAtHour(hour: number): number {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

/** 抽屉："哪一行被点开了" */
type SheetKey = 'start' | 'end' | 'tags' | 'note' | 'photos';

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
  // 本版新增：当前打开的参数抽屉（纯 UI 状态）
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);

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

  /* === 预览卡用的派生值（纯展示，无副作用） === */
  const previewTags = useMemo(
    () => selectedTagIds
      .map(tagId => tags.find(t => t.id === tagId))
      .filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [selectedTagIds, tags],
  );

  const previewColor = previewTags.length > 0 && previewTags[previewTags.length - 1]?.color
    ? previewTags[previewTags.length - 1].color!
    : 'var(--color-accent-primary)';

  const previewTime = (startTime || endTime)
    ? `${formatClock(startTime)} – ${formatClock(endTime)}`
    : '未设时间';

  const closeSheet = useCallback(() => setOpenSheet(null), []);

  const sheetTitle = openSheet === 'start' ? '开始时间'
    : openSheet === 'end' ? '结束时间'
      : openSheet === 'tags' ? '标签'
        : openSheet === 'note' ? '备注'
          : openSheet === 'photos' ? '图片附件'
            : '';

  if (loading) {
    return (
      <div className="todo-edit-page">
        <header className="te-bar">
          <button type="button" className="te-bar-text" onClick={() => navigate('/todo')}>取消</button>
          <span className="te-bar-title">编辑</span>
          <span className="te-bar-text is-ghost">保存</span>
        </header>
        <main className="te-body">
          <div className="te-loading">正在翻开这条待办…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="todo-edit-page">
      {/* ══ 顶部返回条：保存只有这一个入口 ══ */}
      <header className="te-bar">
        <button type="button" className="te-bar-text" onClick={() => navigate('/todo')}>取消</button>
        <span className="te-bar-title">{isNew ? '新建' : '编辑'}</span>
        <button
          type="button"
          className="te-bar-text te-bar-save"
          onClick={handleSave}
          disabled={!title.trim() || saving}
        >
          {saving ? '保存中' : '保存'}
        </button>
      </header>

      <main className="te-body">
        {/* ══ 预览卡：你正在造的这条待办，就长这样 ══ */}
        <label className="te-preview" style={{ '--te-color': previewColor } as React.CSSProperties}>
          <span className="te-preview-bar" aria-hidden="true" />
          <div className="te-preview-main">
            <input
              type="text"
              className="te-preview-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="要做点什么？"
              aria-label="待办标题"
              autoFocus
            />
            <div className="te-preview-meta">
              <span className="te-preview-time">{previewTime}</span>
              {isToday && <span className="te-preview-badge">今日</span>}
              {previewTags.map(tag => (
                <span key={tag.id} className="te-preview-tag">
                  <i style={{ background: tag.color || 'var(--color-text-tertiary)' }} aria-hidden="true" />
                  {tag.name}
                </span>
              ))}
              {note.trim() && <span className="te-preview-note">有备注</span>}
            </div>
          </div>
        </label>

        {/* ══ 参数行：左标签右值，点一下才展开控件 ══ */}
        <div className="te-params">
          <button type="button" className="te-row" onClick={() => setOpenSheet('start')}>
            <span className="te-row-label">开始</span>
            <span className={`te-row-value${startTime ? '' : ' is-empty'}`}>
              {startTime ? formatRowTime(startTime) : '未设置'}
            </span>
            <svg className="te-row-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 1.5 5.5 4 3 6.5" />
            </svg>
          </button>

          <button type="button" className="te-row" onClick={() => setOpenSheet('end')}>
            <span className="te-row-label">结束</span>
            <span className={`te-row-value${endTime ? '' : ' is-empty'}`}>
              {endTime ? formatRowTime(endTime) : '未设置'}
            </span>
            <svg className="te-row-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 1.5 5.5 4 3 6.5" />
            </svg>
          </button>

          <button
            type="button"
            className="te-row"
            role="switch"
            aria-checked={isToday}
            onClick={() => setIsToday(v => !v)}
          >
            <span className="te-row-label">今日处理</span>
            <span className={`te-switch${isToday ? ' on' : ''}`} aria-hidden="true"><i /></span>
          </button>

          <button type="button" className="te-row" onClick={() => setOpenSheet('tags')}>
            <span className="te-row-label">标签</span>
            <span className={`te-row-value${previewTags.length ? '' : ' is-empty'}`}>
              {previewTags.length > 0 ? previewTags.map(t => t.name).join('、') : '未选'}
            </span>
            <svg className="te-row-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 1.5 5.5 4 3 6.5" />
            </svg>
          </button>

          <button type="button" className="te-row" onClick={() => setOpenSheet('note')}>
            <span className="te-row-label">备注</span>
            <span className={`te-row-value${note.trim() ? '' : ' is-empty'}`}>
              {note.trim() ? note.trim().replace(/\s+/g, ' ').slice(0, 18) : '未填写'}
            </span>
            <svg className="te-row-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 1.5 5.5 4 3 6.5" />
            </svg>
          </button>

          <button type="button" className="te-row" onClick={() => setOpenSheet('photos')}>
            <span className="te-row-label">图片</span>
            <span className={`te-row-value${attachments.length ? '' : ' is-empty'}`}>
              {attachments.length > 0 ? `${attachments.length} 张` : '未添加'}
            </span>
            <svg className="te-row-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 1.5 5.5 4 3 6.5" />
            </svg>
          </button>
        </div>

        {/* 底部只留一句提示 + 已有待办的删除入口（保存已在顶栏） */}
        <p className="te-hint">
          {isNew ? '保存后落到这一天的时间线里' : '改完点右上角保存'}
        </p>
        {!isNew && (
          <button type="button" className="te-delete" onClick={handleDelete}>
            删除这条待办
          </button>
        )}
      </main>

      {/* ══ 参数抽屉：只有点开的那一项才出现 ══ */}
      {openSheet && (
        <>
          <div className="te-sheet-scrim" onClick={closeSheet} />
          <div className="te-sheet" role="dialog" aria-label={sheetTitle}>
            <span className="te-grip" aria-hidden="true" />
            <div className="te-sheet-head">
              <span className="te-sheet-title">{sheetTitle}</span>
              <button type="button" className="te-sheet-done" onClick={closeSheet}>完成</button>
            </div>

            <div className="te-sheet-body">
              {(openSheet === 'start' || openSheet === 'end') && (
                <>
                  <div className="te-presets">
                    {TIME_PRESETS.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        className="te-chip"
                        onClick={() => handlePresetTime(p, openSheet === 'start' ? 'start' : 'end')}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="datetime-local"
                    className="te-input"
                    aria-label={openSheet === 'start' ? '开始时间' : '结束时间'}
                    value={toDateTimeLocal(openSheet === 'start' ? startTime : endTime)}
                    onChange={e => {
                      const ts = e.target.value ? new Date(e.target.value).getTime() : undefined;
                      if (openSheet === 'start') setStartTime(ts);
                      else setEndTime(ts);
                    }}
                  />
                  <p className="te-sheet-note">
                    {openSheet === 'start' ? '保存时会按开始时间归到那一天' : '不设结束时间也可以'}
                  </p>
                </>
              )}

              {openSheet === 'tags' && (
                <>
                  {selectedTagIds.length > 0 && (
                    <div className="te-selected-tags">
                      {selectedTagIds.map(tagId => {
                        const tag = tags.find(t => t.id === tagId);
                        if (!tag) return null;
                        return (
                          <span
                            key={tagId}
                            className="te-selected-tag"
                            style={{ borderColor: tag.color || undefined, background: tag.color ? tag.color + '22' : undefined }}
                          >
                            <i style={{ background: tag.color || 'var(--color-text-tertiary)' }} aria-hidden="true" />
                            <span>{tag.name}</span>
                            <button
                              type="button"
                              className="te-selected-remove"
                              onClick={e => {
                                e.stopPropagation();
                                setSelectedTagIds(prev => prev.filter(t => t !== tagId));
                              }}
                              aria-label={`移除标签 ${tag.name}`}
                            >
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                                <path d="M18 6 6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="te-tag-list">
                    {sortedTags.map(tag => (
                      <span key={tag.id} className="te-tag-wrap">
                        <button
                          type="button"
                          className={`te-tag${selectedTagIds.includes(tag.id) ? ' on' : ''}`}
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
                          <i className="te-tag-dot" style={{ background: tag.color || 'var(--color-text-tertiary)' }} aria-hidden="true" />
                          {tag.name}
                        </button>
                        <button
                          type="button"
                          className="te-tag-edit"
                          title="编辑标签（改名 / 改色 / 删除）"
                          onClick={() => handleOpenTagEdit(tag)}
                          aria-label={`编辑标签 ${tag.name}`}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="te-tag-new"
                      onClick={() => { setShowTagEditor(!showTagEditor); setEditingTagId(null); }}
                    >
                      + 新标签
                    </button>
                  </div>

                  {showTagEditor && (
                    <div className="te-tag-editor">
                      <input
                        type="text"
                        className="te-input"
                        value={newTagName}
                        onChange={e => setNewTagName(e.target.value)}
                        placeholder="标签名…"
                      />
                      <TagColorRow value={newTagColor} onChange={setNewTagColor} />
                      <button
                        type="button"
                        className="te-tag-confirm"
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim()}
                      >
                        创建
                      </button>
                    </div>
                  )}

                  {/* v2.10.0: 已有标签编辑面板（改名 / 改色 / 删除） */}
                  {editingTagId && (
                    <div className="te-tag-editor">
                      <div className="te-tag-editor-title">
                        编辑「{tags.find(t => t.id === editingTagId)?.name || ''}」
                      </div>
                      <input
                        type="text"
                        className="te-input"
                        value={editTagName}
                        onChange={e => setEditTagName(e.target.value)}
                        placeholder="标签名…"
                      />
                      <TagColorRow value={editTagColor} onChange={setEditTagColor} />
                      <div className="te-tag-editor-actions">
                        <button type="button" className="te-tag-danger" onClick={handleDeleteTagFromEditor}>
                          删除标签
                        </button>
                        <button type="button" className="te-tag-ghost" onClick={() => setEditingTagId(null)}>
                          取消
                        </button>
                        <button
                          type="button"
                          className="te-tag-confirm"
                          onClick={handleSaveTagEdit}
                          disabled={!editTagName.trim()}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {openSheet === 'note' && (
                <>
                  <textarea
                    className="te-textarea"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="这件事的来龙去脉…"
                    rows={5}
                  />
                  <p className="te-sheet-note">备注会跟在标题下面，显示在清单里</p>
                </>
              )}

              {openSheet === 'photos' && (
                <>
                  <div className="te-attachments">
                    {attachments.map(att => (
                      <div key={att.id} className="te-attachment">
                        {thumbSrcs[att.id] && (
                          <img src={thumbSrcs[att.id]} alt="附件" className="te-attachment-thumb" />
                        )}
                        <button
                          type="button"
                          className="te-attachment-delete"
                          onClick={() => handleDeleteAttachment(att)}
                          aria-label="删除这张图片"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="te-attachment-add"
                      onClick={handlePickImages}
                      disabled={isPickingImages}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>{isPickingImages ? '选择中…' : '添加图片'}</span>
                    </button>
                  </div>
                  <p className="te-sheet-note">最多 9 张，删除待办时一起清理</p>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 六个色点 + 自定义色盘（替代原来一整排色块） */
function TagColorRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="te-colors">
      {TAG_COLORS.map(c => (
        <button
          key={c}
          type="button"
          className={`te-color${value.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
          style={{ '--te-dot': c } as React.CSSProperties}
          onClick={() => onChange(c)}
          aria-label={`颜色 ${c}`}
        />
      ))}
      <label
        className={`te-color te-color-custom${TAG_COLORS.some(c => c.toLowerCase() === value.toLowerCase()) ? '' : ' on'}`}
        title="自定义颜色"
      >
        <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      </label>
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
