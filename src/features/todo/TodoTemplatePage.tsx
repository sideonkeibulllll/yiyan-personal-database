/**
 * 待办模板系统（v3.5.0 翻新）
 *
 * - 列表视图：模板卡片（名称 + 项数 + 自动应用摘要）
 * - 详情视图：
 *   · 自动应用：周1~7 多选 —— 打开 App 时命中当天 → 自动生成到当天待办
 *   · 模板项：标题 / 备注 / 起止时间 / 今日处理 / 待办标签，可拖拽排序
 *   · 应用到指定日期（手动一次性）
 * - 输入防抖保存（500ms）；切模板 / 离开页面时立即落盘
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodoDatabase } from '@/services/todoDatabase';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { BottomNav } from '@/components/BottomNav';
import { parseAutoWeekdays, formatAutoWeekdays, WEEKDAY_LABELS } from '@/utils/todoWeekdays';
import type { TodoTemplate, TodoTemplateItem } from '@/types';
import './TodoTemplatePage.css';

/** 输入防抖保存间隔（标题/备注/时间等高频输入） */
const SAVE_DEBOUNCE_MS = 500;

/** 单字星期标签（胶囊用） */
const DAY_SHORT: Record<number, string> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };

/** 分钟偏移 → time 输入框值（空 = 未设置） */
function minutesToInput(m?: number | null): string {
  if (m === undefined || m === null) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** time 输入框值 → 分钟偏移（空 / 非法 → undefined） */
function inputToMinutes(v: string): number | undefined {
  if (!v) return undefined;
  const [h, m] = v.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  return h * 60 + m;
}

/** 解析模板项标签（JSON 字符串 → 数组，容错） */
function parseItemTagIds(item: TodoTemplateItem): string[] {
  if (!item.tagIds) return [];
  try {
    const arr = JSON.parse(item.tagIds);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function TodoTemplatePage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TodoTemplate[]>([]);
  /** 每个模板的项数（列表卡片展示） */
  const [tplItemCount, setTplItemCount] = useState<Map<string, number>>(new Map());
  const [selectedTemplate, setSelectedTemplate] = useState<TodoTemplate | null>(null);
  const [items, setItems] = useState<TodoTemplateItem[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyDate, setApplyDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  /** 展开标签面板的项 id（同时只开一个） */
  const [tagPanelItemId, setTagPanelItemId] = useState<string | null>(null);
  /** 正在拖拽的项 id */
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  // 待办标签池
  const tags = useTodoTagStore(state => state.tags);
  const loadTags = useTodoTagStore(state => state.loadTags);

  /* === 防抖保存队列（标题/备注/时间/标签等高频输入） === */
  const pendingRef = useRef<Map<string, Partial<TodoTemplateItem>>>(new Map());
  const timerRef = useRef<number | null>(null);

  const flushPending = useCallback(async () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current.size === 0) return;
    const writes = Array.from(pendingRef.current.entries());
    pendingRef.current.clear();
    try {
      const db = await getTodoDatabase();
      for (const [id, updates] of writes) {
        await db.updateTemplateItem(id, updates);
      }
    } catch (e) {
      console.error('[TodoTemplatePage] 保存失败:', e);
    }
  }, []);

  /** 排队更新模板项：本地立即生效 + 500ms 防抖落盘 */
  const queueItemUpdate = useCallback((id: string, updates: Partial<TodoTemplateItem>) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...updates } : i)));
    const pending = pendingRef.current;
    pending.set(id, { ...(pending.get(id) || {}), ...updates });
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flushPending(); }, SAVE_DEBOUNCE_MS);
  }, [flushPending]);

  // 卸载时落盘（防抖窗口内离开页面不丢输入）
  useEffect(() => () => { void flushPending(); }, [flushPending]);

  /* === 数据加载 === */
  const loadTemplates = useCallback(async () => {
    try {
      const db = await getTodoDatabase();
      const list = await db.getAllTemplates();
      setTemplates(list);
      // 项数统计（列表卡片展示）
      try {
        const allItems = await db.getAllTemplateItems();
        const counts = new Map<string, number>();
        for (const it of allItems) counts.set(it.templateId, (counts.get(it.templateId) || 0) + 1);
        setTplItemCount(counts);
      } catch { /* 项数展示失败不影响主流程 */ }
    } catch (e) {
      console.error('[TodoTemplatePage] 加载模板失败:', e);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadTags();
  }, [loadTemplates, loadTags]);

  /* === 模板操作 === */
  const handleSelectTemplate = useCallback(async (template: TodoTemplate) => {
    await flushPending(); // 切模板前把未保存的输入落盘
    setSelectedTemplate(template);
    setTagPanelItemId(null);
    try {
      const db = await getTodoDatabase();
      setItems(await db.getTemplateItems(template.id));
    } catch (e) {
      console.error('[TodoTemplatePage] 加载模板项失败:', e);
      setItems([]);
    }
  }, [flushPending]);

  const handleBackToList = useCallback(() => {
    void flushPending();
    setSelectedTemplate(null);
    setItems([]);
    setTagPanelItemId(null);
    void loadTemplates(); // 刷新计数/摘要
  }, [flushPending, loadTemplates]);

  const handleCreateTemplate = useCallback(async () => {
    if (!newTemplateName.trim()) return;
    try {
      const db = await getTodoDatabase();
      const template = await db.createTemplate(newTemplateName.trim());
      setTemplates(prev => [template, ...prev]);
      setNewTemplateName('');
      setShowCreateDialog(false);
      setSelectedTemplate(template);
      setItems([]);
    } catch (e) {
      console.error('[TodoTemplatePage] 创建模板失败:', e);
      alert(`创建模板失败：${(e as Error).message}`);
    }
  }, [newTemplateName]);

  const handleAddItem = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      const db = await getTodoDatabase();
      const newItem = await db.addTemplateItem({
        templateId: selectedTemplate.id,
        title: '新待办',
        isToday: true, // 保持原默认（新增项默认勾「今日处理」）
        sortOrder: items.length,
      });
      setItems(prev => [...prev, newItem]);
    } catch (e) {
      console.error('[TodoTemplatePage] 添加模板项失败:', e);
    }
  }, [selectedTemplate, items.length]);

  const handleDeleteItem = useCallback(async (id: string) => {
    pendingRef.current.delete(id); // 取消该项的挂起写入，防删除后又写回
    try {
      await flushPending();
      const db = await getTodoDatabase();
      await db.deleteTemplateItem(id);
      setItems(prev => prev.filter(i => i.id !== id));
      if (tagPanelItemId === id) setTagPanelItemId(null);
    } catch (e) {
      console.error('[TodoTemplatePage] 删除模板项失败:', e);
    }
  }, [flushPending, tagPanelItemId]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!selectedTemplate) return;
    try {
      await flushPending();
      const db = await getTodoDatabase();
      await db.deleteTemplate(selectedTemplate.id);
      setTemplates(prev => prev.filter(t => t.id !== selectedTemplate.id));
      setSelectedTemplate(null);
      setItems([]);
    } catch (e) {
      console.error('[TodoTemplatePage] 删除模板失败:', e);
    }
  }, [selectedTemplate, flushPending]);

  const handleApplyTemplate = useCallback(async () => {
    if (!selectedTemplate || !applyDate) return;
    try {
      await flushPending(); // 应用前先落盘，确保生成的是最新内容
      const db = await getTodoDatabase();
      await db.importTemplateToDate(selectedTemplate.id, applyDate);
      navigate('/todo');
    } catch (e) {
      console.error('[TodoTemplatePage] 应用模板失败:', e);
      alert(`应用失败：${(e as Error).message}`);
    }
  }, [selectedTemplate, applyDate, flushPending, navigate]);

  /* === 自动应用（周1~7） === */
  const saveWeekdays = useCallback(async (days: number[]) => {
    if (!selectedTemplate) return;
    const value = formatAutoWeekdays(days);
    try {
      const db = await getTodoDatabase();
      await db.updateTemplate(selectedTemplate.id, { autoWeekdays: value || undefined });
      const updated: TodoTemplate = { ...selectedTemplate, autoWeekdays: value || undefined };
      setSelectedTemplate(updated);
      setTemplates(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    } catch (e) {
      console.error('[TodoTemplatePage] 保存自动应用失败:', e);
    }
  }, [selectedTemplate]);

  const toggleWeekday = useCallback((day: number) => {
    if (!selectedTemplate) return;
    const cur = parseAutoWeekdays(selectedTemplate.autoWeekdays);
    const next = cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day];
    void saveWeekdays(next);
  }, [selectedTemplate, saveWeekdays]);

  /* === 标签选择 === */
  const toggleItemTag = useCallback((item: TodoTemplateItem, tagId: string) => {
    const cur = parseItemTagIds(item);
    const next = cur.includes(tagId) ? cur.filter(id => id !== tagId) : [...cur, tagId];
    queueItemUpdate(item.id, { tagIds: next.length > 0 ? JSON.stringify(next) : undefined });
  }, [queueItemUpdate]);

  /* === 拖拽排序 === */
  const handleItemDragStart = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('.template-item') as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const step = rect ? rect.height + 12 : 96; // 卡片高度 + gap
    const fromIndex = items.findIndex(i => i.id === id);
    if (fromIndex === -1) return;

    const startY = e.clientY;
    const total = items.length;
    let currentIndex = fromIndex;
    setDraggingItemId(id);
    document.body.classList.add('template-dragging');

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const delta = Math.round((ev.clientY - startY) / step);
      const target = Math.max(0, Math.min(total - 1, fromIndex + delta));
      if (target !== currentIndex) {
        currentIndex = target;
        setItems(prev => {
          const list = [...prev];
          const from = list.findIndex(i => i.id === id);
          if (from === -1) return prev;
          const [moved] = list.splice(from, 1);
          list.splice(target, 0, moved);
          return list;
        });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDraggingItemId(null);
      document.body.classList.remove('template-dragging');
      // 落位后持久化新顺序
      setItems(prev => {
        void (async () => {
          try {
            const db = await getTodoDatabase();
            for (let i = 0; i < prev.length; i++) {
              if (prev[i].sortOrder !== i) await db.updateTemplateItem(prev[i].id, { sortOrder: i });
            }
          } catch (err) {
            console.error('[TodoTemplatePage] 保存排序失败:', err);
          }
        })();
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [items]);

  // 拖拽中页面卸载时解锁滚动
  useEffect(() => () => { document.body.classList.remove('template-dragging'); }, []);

  /* === 派生 === */
  const autoDays = selectedTemplate ? parseAutoWeekdays(selectedTemplate.autoWeekdays) : [];
  const autoSummary = autoDays.length === 0
    ? ''
    : autoDays.length === 7
      ? '每天'
      : autoDays.length === 5 && autoDays.join(',') === '1,2,3,4,5'
        ? '工作日'
        : autoDays.map(d => WEEKDAY_LABELS[d]).join('、');

  return (
    <div className="todo-template-page">
      <main className="page-content">
        <div className="template-header">
          <button
            className="template-back"
            onClick={() => { if (selectedTemplate) handleBackToList(); else navigate('/todo'); }}
            aria-label="返回"
          >
            ←
          </button>
          <h2>{selectedTemplate ? selectedTemplate.name : '模板管理'}</h2>
          {selectedTemplate ? (
            <button className="template-apply-btn" onClick={() => setShowApplyDialog(true)}>应用到日期</button>
          ) : (
            <button className="template-add-btn" onClick={() => setShowCreateDialog(true)} aria-label="新建模板">+</button>
          )}
        </div>

        {!selectedTemplate ? (
          /* ===== 模板列表 ===== */
          <div className="template-list">
            {templates.length > 0 ? (
              templates.map(tpl => {
                const days = parseAutoWeekdays(tpl.autoWeekdays);
                const dayLabel = days.length === 7 ? '每天'
                  : days.length === 5 && days.join(',') === '1,2,3,4,5' ? '工作日'
                    : days.map(d => WEEKDAY_LABELS[d]).join('、');
                return (
                  <div
                    key={tpl.id}
                    className="template-card glass"
                    onClick={() => void handleSelectTemplate(tpl)}
                  >
                    <div className="template-card-main">
                      <span className="template-name">{tpl.name}</span>
                      <span className="template-card-meta">
                        {tplItemCount.get(tpl.id) ?? 0} 项
                        {days.length > 0 && <span className="template-card-auto"> · 自动：{dayLabel}</span>}
                      </span>
                    </div>
                    <span className="template-arrow">›</span>
                  </div>
                );
              })
            ) : (
              <div className="template-empty">
                <p>还没有模板</p>
                <p className="template-empty-hint">点击右上角 + 创建第一个模板</p>
              </div>
            )}
          </div>
        ) : (
          /* ===== 模板详情 ===== */
          <div className="template-detail">
            {/* 自动应用 */}
            <div className="template-auto glass">
              <div className="template-auto-head">
                <span className="template-auto-title">自动应用</span>
                <span className="template-auto-hint">
                  {autoSummary === '每天' ? '每天自动生成'
                    : autoSummary === '工作日' ? '每个工作日自动生成'
                      : autoSummary ? `每周 ${autoSummary} 自动生成` : '未开启'}
                </span>
              </div>
              <div className="template-weekdays">
                {[1, 2, 3, 4, 5, 6, 7].map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`template-day ${autoDays.includes(d) ? 'on' : ''}`}
                    onClick={() => toggleWeekday(d)}
                    title={WEEKDAY_LABELS[d]}
                  >
                    {DAY_SHORT[d]}
                  </button>
                ))}
              </div>
              <div className="template-auto-presets">
                <button type="button" onClick={() => void saveWeekdays([1, 2, 3, 4, 5])}>工作日</button>
                <button type="button" onClick={() => void saveWeekdays([1, 2, 3, 4, 5, 6, 7])}>每天</button>
                <button type="button" onClick={() => void saveWeekdays([])}>不自动</button>
              </div>
              <p className="template-auto-note">选中的星期，打开 App 时会自动把这套待办生成到当天。</p>
            </div>

            {/* 模板项 */}
            <div className="template-items">
              {items.map(item => {
                const selectedTagIds = parseItemTagIds(item);
                const selectedTags = tags.filter(t => selectedTagIds.includes(t.id));
                return (
                  <div
                    key={item.id}
                    className={`template-item glass ${draggingItemId === item.id ? 'dragging' : ''}`}
                  >
                    <div className="template-item-row">
                      {/* 拖拽把手 */}
                      <div
                        className="template-drag-handle"
                        onPointerDown={e => handleItemDragStart(e, item.id)}
                        title="拖拽排序"
                      >
                        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" opacity="0.55">
                          <circle cx="3" cy="3" r="1.3" /><circle cx="9" cy="3" r="1.3" />
                          <circle cx="3" cy="8" r="1.3" /><circle cx="9" cy="8" r="1.3" />
                          <circle cx="3" cy="13" r="1.3" /><circle cx="9" cy="13" r="1.3" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        className="template-item-title"
                        value={item.title}
                        placeholder="待办标题"
                        onChange={e => queueItemUpdate(item.id, { title: e.target.value })}
                      />
                      <button
                        type="button"
                        className="template-item-remove"
                        onClick={() => void handleDeleteItem(item.id)}
                        aria-label="删除此项"
                      >
                        ×
                      </button>
                    </div>

                    <input
                      type="text"
                      className="template-item-note"
                      value={item.note ?? ''}
                      placeholder="备注（可选）"
                      onChange={e => queueItemUpdate(item.id, { note: e.target.value })}
                    />

                    <div className="template-item-times">
                      <label>
                        开始
                        <input
                          type="time"
                          value={minutesToInput(item.startTime)}
                          onChange={e => queueItemUpdate(item.id, { startTime: inputToMinutes(e.target.value) })}
                        />
                      </label>
                      <label>
                        结束
                        <input
                          type="time"
                          value={minutesToInput(item.endTime)}
                          onChange={e => queueItemUpdate(item.id, { endTime: inputToMinutes(e.target.value) })}
                        />
                      </label>
                      <label className="template-item-today">
                        <input
                          type="checkbox"
                          checked={item.isToday}
                          onChange={e => queueItemUpdate(item.id, { isToday: e.target.checked })}
                        />
                        <span>今日处理</span>
                      </label>
                    </div>

                    {/* 标签 */}
                    <div className="template-item-tags">
                      {selectedTags.map(tag => (
                        <span key={tag.id} className="template-tag-chip on">
                          <span className="template-tag-dot" style={{ background: tag.color || 'var(--color-accent-primary)' }} />
                          {tag.name}
                          <button
                            type="button"
                            className="template-tag-remove"
                            onClick={() => toggleItemTag(item, tag.id)}
                            aria-label={`移除标签 ${tag.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="template-tag-add"
                        onClick={() => setTagPanelItemId(prev => (prev === item.id ? null : item.id))}
                      >
                        {selectedTags.length > 0 ? '改标签' : '+ 标签'}
                      </button>
                    </div>
                    {tagPanelItemId === item.id && (
                      <div className="template-tag-panel">
                        {tags.length === 0 ? (
                          <span className="template-tag-empty">还没有待办标签（可在待办编辑页创建）</span>
                        ) : (
                          tags.map(tag => {
                            const on = selectedTagIds.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                className={`template-tag-option ${on ? 'on' : ''}`}
                                onClick={() => toggleItemTag(item, tag.id)}
                              >
                                <span className="template-tag-dot" style={{ background: tag.color || 'var(--color-accent-primary)' }} />
                                {tag.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="template-item-add" onClick={() => void handleAddItem()}>
                + 添加待办项
              </button>
            </div>

            <button className="template-delete-btn" onClick={() => void handleDeleteTemplate()}>
              删除模板
            </button>
          </div>
        )}
      </main>

      {/* 创建模板对话框 */}
      {showCreateDialog && (
        <div className="dialog-overlay" onClick={() => setShowCreateDialog(false)}>
          <div className="dialog-content glass" onClick={e => e.stopPropagation()}>
            <h3>创建模板</h3>
            <input
              type="text"
              className="form-input glass"
              value={newTemplateName}
              onChange={e => setNewTemplateName(e.target.value)}
              placeholder="模板名称..."
              autoFocus
            />
            <div className="dialog-actions">
              <button onClick={() => setShowCreateDialog(false)}>取消</button>
              <button
                onClick={() => void handleCreateTemplate()}
                disabled={!newTemplateName.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 应用模板对话框 */}
      {showApplyDialog && (
        <div className="dialog-overlay" onClick={() => setShowApplyDialog(false)}>
          <div className="dialog-content glass" onClick={e => e.stopPropagation()}>
            <h3>应用到日期</h3>
            <input
              type="date"
              className="form-input glass"
              value={applyDate}
              onChange={e => setApplyDate(e.target.value)}
            />
            <div className="dialog-actions">
              <button onClick={() => setShowApplyDialog(false)}>取消</button>
              <button onClick={() => void handleApplyTemplate()}>应用</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
