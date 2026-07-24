/**
 * 条目选择器面板
 * 独立浮层，分为 3 块：搜索 | 数据 | 关联数据
 * 
 * - 搜索：输入关键字后点击搜索按钮→刷新第二块（数据）
 * - 数据：当前搜索结果，点选后刷新第三块（关联数据）
 * - 关联数据：与选中条目"同组/同标签/有连线"的条目，可多选
 * - 第三块的点选也会触发关联更新（链式）
 * - 单行卡片形式，长按展开完整内容
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import type { Entry, Todo } from '@/types';
import './EntryPickerPanel.css';

interface EntryPickerPanelProps {
  /** 已选中的条目 ID 列表 */
  selectedIds: Set<string>;
  /** 选中变化回调 */
  onSelectionChange: (ids: Set<string>) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 初始选中的条目（如从 QuickMenu「就此内容谈话」跳来时传入） */
  initialEntryId?: string;
  /** 是否允许多选（默认 true） */
  multiSelect?: boolean;
  /** 初始模式：'entry' 数据选择器 或 'todo' 待办选择器 */
  initialMode?: 'entry' | 'todo';
}

/** 搜索 SVG */
const SearchSvg = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
  </svg>
);

const CloseSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ChevronDownSvg = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const ChevronUpSvg = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6" />
  </svg>
);

/** 格式化日期 */
function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 格式化时间简短显示 */
function formatTimeShort(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 单行卡片 */
function EntryCard({
  entry,
  isSelected,
  onToggle,
}: {
  entry: Entry;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 用 passively 监听 touchstart，避免 onTouchStart 与 onClick 冲突
  // onTouchStart 在 React 中是 passive=false 的合成事件，可能阻止 click。
  // 改为只在 touchstart 中启动计时器，touchend/move 中取消，
  // 如果计时器触发→展开；否则让 click 正常触发选中。
  const startLongPress = (e: React.TouchEvent | React.MouseEvent) => {
    // 不阻止默认行为，让 click 能正常触发
    longPressTimer.current = setTimeout(() => {
      setExpanded(prev => !prev);
      // 长按触发后，标记本次 touch 已处理，阻止后续 click 选中
      (e.currentTarget as HTMLElement).dataset.longPressTriggered = '1';
      setTimeout(() => {
        delete (e.currentTarget as HTMLElement).dataset.longPressTriggered;
      }, 300);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div
      className={`ep-card ${isSelected ? 'selected' : ''} ${expanded ? 'expanded' : ''}`}
      onClick={(e) => {
        // 如果是长按触发的展开/收起，跳过选中逻辑
        if ((e.currentTarget as HTMLElement).dataset.longPressTriggered === '1') {
          return;
        }
        onToggle();
      }}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
    >
      <div className="ep-card-main">
        <div className={`ep-card-checkbox ${isSelected ? 'checked' : ''}`}>
          {isSelected && '✓'}
        </div>
        <div className="ep-card-text">
          {entry.content.length > 80 && !expanded
            ? entry.content.slice(0, 80) + '…'
            : entry.content}
        </div>
        {entry.isStarred && <span className="ep-card-star">★</span>}
        {entry.source && <span className="ep-card-source">{entry.source}</span>}
        <span className="ep-card-date">{formatDate(entry.createdAt)}</span>
        <span className="ep-card-expand-hint">
          {expanded ? <ChevronUpSvg /> : <ChevronDownSvg />}
        </span>
      </div>
      {expanded && (
        <div className="ep-card-detail">
          {entry.supplement && (
            <div className="ep-card-detail-row">
              <span className="ep-card-detail-label">补充：</span>
              <span>{entry.supplement}</span>
            </div>
          )}
          {entry.tags && entry.tags.length > 0 && (
            <div className="ep-card-detail-row">
              <span className="ep-card-detail-label">标签：</span>
              <span>{entry.tags.map(t => '#' + t.name).join(' ')}</span>
            </div>
          )}
          <div className="ep-card-detail-row">
            <span className="ep-card-detail-label">使用次数：</span>
            <span>{entry.copyCount} 次</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function EntryPickerPanel({
  selectedIds,
  onSelectionChange,
  onClose,
  initialEntryId,
  multiSelect = true,
  initialMode = 'entry',
}: EntryPickerPanelProps) {
  // 模式切换：'entry' 数据选择器 或 'todo' 待办选择器
  const [pickerMode, setPickerMode] = useState<'entry' | 'todo'>(initialMode);
  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  // 数据列表（第二块）
  const [dataEntries, setDataEntries] = useState<Entry[]>([]);
  // 待办列表（第二块，待办模式）
  const [dataTodos, setDataTodos] = useState<Todo[]>([]);
  // 关联列表（第三块）
  const [relatedEntries, setRelatedEntries] = useState<Entry[]>([]);
  // 当前选中的"主"条目（用于关联刷新）
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(initialEntryId ?? null);
  // 加载状态
  const [loadingData, setLoadingData] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState(false);
  // 待办模式下块过滤：'tag' 按标签 或 'time' 按时间
  const [todoFilterMode, setTodoFilterMode] = useState<'tag' | 'time'>('time');
  // 关联数据的筛选选项（多条 tag/组时展示）
  const [relatedFilterOptions, setRelatedFilterOptions] = useState<{ type: 'tag' | 'group'; id: string; name: string }[]>([]);
  const [activeRelatedFilter, setActiveRelatedFilter] = useState<string | null>(null);

  /** 搜索条目 → 刷新第二块 */
  const handleSearch = useCallback(async () => {
    setLoadingData(true);
    try {
      if (pickerMode === 'todo') {
        // 待办模式：加载待办数据
        const todoDb = await getTodoDatabase();
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;
        let results: Todo[];
        if (searchQuery.trim()) {
          results = await todoDb.searchTodos(searchQuery.trim(), 'all');
        } else {
          results = await todoDb.getTodosByDate(todayStr);
        }
        setDataTodos(results);
        setDataEntries([]);
      } else {
        const db = await getDatabase();
        let results: Entry[];
        if (searchQuery.trim()) {
          results = await db.searchEntries(searchQuery.trim());
        } else {
          results = await db.getAllEntries();
        }
        // === 修复 2：按最近复制和最近长按排序 ===
        const COPY_KEY = '__yiyan_last_copy_at__';
        const MENU_KEY = '__yiyan_last_menu_at__';
        const copyMap: Record<string, number> = (window as any)[COPY_KEY] || {};
        const menuMap: Record<string, number> = (window as any)[MENU_KEY] || {};
        results.sort((a, b) => {
          const aCopy = copyMap[a.id] || 0;
          const bCopy = copyMap[b.id] || 0;
          const aMenu = menuMap[a.id] || 0;
          const bMenu = menuMap[b.id] || 0;
          const aMax = Math.max(aCopy, aMenu, a.lastUsedAt || 0);
          const bMax = Math.max(bCopy, bMenu, b.lastUsedAt || 0);
          return bMax - aMax;
        });
        setDataEntries(results);
        setDataTodos([]);
      }
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setLoadingData(false);
    }
  }, [searchQuery, pickerMode]);

  /** 获取与指定条目关联的其他条目 */
  const loadRelated = useCallback(async (entryId: string, currentSelectedIds?: Set<string>) => {
    setLoadingRelated(true);
    setActiveRelatedFilter(null);
    try {
      const db = await getDatabase();
      const entry = await db.getEntryById(entryId);
      if (!entry) {
        setRelatedEntries([]);
        setRelatedFilterOptions([]);
        return;
      }

      const relatedMap = new Map<string, Entry>();
      // 收集关联类型信息用于筛选
      const tagSources = new Map<string, string>(); // entryId -> tagId
      const groupSources = new Map<string, string>(); // entryId -> groupId
      const linkSources = new Set<string>(); // 通过连线关联的 entryId
      const filterOptions: { type: 'tag' | 'group'; id: string; name: string }[] = [];

      // 同组
      if (entry.groupId) {
        const sameGroup = await db.getEntriesByGroupId(entry.groupId);
        sameGroup.forEach(e => {
          if (e.id !== entryId) {
            relatedMap.set(e.id, e);
            groupSources.set(e.id, entry.groupId!);
          }
        });
        if (sameGroup.length > 1) {
          filterOptions.push({ type: 'group', id: entry.groupId, name: '同组' });
        }
      }

      // 同标签（可能有多个标签）
      if (entry.tags && entry.tags.length > 0) {
        for (const tag of entry.tags) {
          const sameTag = await db.getEntriesByTagId(tag.id);
          sameTag.forEach(e => {
            if (e.id !== entryId) {
              relatedMap.set(e.id, e);
              tagSources.set(e.id, tag.id);
            }
          });
          if (sameTag.length > 1) {
            filterOptions.push({ type: 'tag', id: tag.id, name: `#${tag.name}` });
          }
        }
      }

      // 有连线
      const links = await db.getLinksByEntryId(entryId);
      for (const link of links) {
        const otherId = link.sourceId === entryId ? link.targetId : link.sourceId;
        const other = await db.getEntryById(otherId);
        if (other) {
          relatedMap.set(otherId, other);
          linkSources.add(otherId);
        }
      }
      if (links.length > 0) {
        filterOptions.push({ type: 'group', id: '__links__', name: '连线' });
      }

      setRelatedFilterOptions(filterOptions);

      // === 修复 1：过滤已选中的数据 ===
      const selectedToFilter = currentSelectedIds ?? selectedIds;
      const filtered = Array.from(relatedMap.values()).filter(
        e => !selectedToFilter.has(e.id)
      );
      setRelatedEntries(filtered);
    } catch (err) {
      console.error('加载关联失败:', err);
      setRelatedEntries([]);
      setRelatedFilterOptions([]);
    } finally {
      setLoadingRelated(false);
    }
  }, [selectedIds]);

  /** 加载待办关联数据：同标签或同日期 */
  const loadTodoRelated = useCallback(async (todoId: string, currentSelectedIds?: Set<string>) => {
    setLoadingRelated(true);
    try {
      const todoDb = await getTodoDatabase();
      const todo = await todoDb.getTodoById(todoId);
      if (!todo) {
        setRelatedEntries([]);
        return;
      }

      const relatedMap = new Map<string, Entry>();

      // 同日期待办中的同标签
      if (todo.tags && todo.tags.length > 0) {
        const sameDateTodos = await todoDb.getTodosByDate(todo.folderDate);
        for (const t of sameDateTodos) {
          if (t.id === todoId) continue;
          if (t.tags && t.tags.some(tag => todo.tags!.some(tt => tt.id === tag.id))) {
            // 将 Todo 转为类似 Entry 的结构以复用 EntryCard
            relatedMap.set(t.id, {
              id: t.id,
              content: t.title,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
              isStarred: false,
              copyCount: 0,
              tags: t.tags,
            } as Entry);
          }
        }
      }

      const selectedToFilter = currentSelectedIds ?? selectedIds;
      const filtered = Array.from(relatedMap.values()).filter(
        e => !selectedToFilter.has(e.id)
      );
      setRelatedEntries(filtered);
    } catch (err) {
      console.error('加载待办关联失败:', err);
      setRelatedEntries([]);
    } finally {
      setLoadingRelated(false);
    }
  }, [selectedIds]);

  /** 初始加载 */
  useEffect(() => {
    handleSearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 切换模式时重新加载 */
  useEffect(() => {
    handleSearch();
    setRelatedEntries([]);
  }, [pickerMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 如果有初始选中条目，加载关联 */
  useEffect(() => {
    if (initialEntryId) {
      setCurrentEntryId(initialEntryId);
      loadRelated(initialEntryId);
    }
  }, [initialEntryId, loadRelated]);

  // === 修复 1：selectedIds 变化时重新过滤关联列表 ===
  useEffect(() => {
    if (currentEntryId) {
      setRelatedEntries(prev => prev.filter(e => !selectedIds.has(e.id)));
    }
  }, [selectedIds, currentEntryId]);

  /** 点击数据块中的条目 */
  const handleDataEntryClick = useCallback((entryId: string) => {
    if (!multiSelect) {
      const newSet = new Set<string>();
      newSet.add(entryId);
      onSelectionChange(newSet);
      setCurrentEntryId(entryId);
      if (pickerMode === 'entry') {
        loadRelated(entryId);
      } else {
        loadTodoRelated(entryId);
      }
      return;
    }

    // 多选模式
    const newSet = new Set(selectedIds);
    if (newSet.has(entryId)) {
      newSet.delete(entryId);
    } else {
      newSet.add(entryId);
    }
    onSelectionChange(newSet);
    setCurrentEntryId(entryId);
    if (pickerMode === 'entry') {
      loadRelated(entryId);
    } else {
      loadTodoRelated(entryId);
    }
  }, [multiSelect, selectedIds, onSelectionChange, loadRelated, pickerMode]);

  /** 点击关联块中的条目 */
  const handleRelatedEntryClick = useCallback((entryId: string) => {
    if (!multiSelect) {
      const newSet = new Set<string>();
      newSet.add(entryId);
      onSelectionChange(newSet);
      setCurrentEntryId(entryId);
      loadRelated(entryId);
      return;
    }

    const newSet = new Set(selectedIds);
    if (newSet.has(entryId)) {
      newSet.delete(entryId);
    } else {
      newSet.add(entryId);
    }
    onSelectionChange(newSet);
    setCurrentEntryId(entryId);
    loadRelated(entryId);
  }, [multiSelect, selectedIds, onSelectionChange, loadRelated]);

  return (
    <div className="entry-picker-overlay" onClick={onClose}>
      <div className="entry-picker-panel glass" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="ep-header">
          <h3 className="ep-title">选择数据</h3>
          <button className="ep-close" onClick={onClose}><CloseSvg /></button>
        </div>

        {/* 模式切换 */}
        <div className="ep-mode-switch">
          <button
            className={`ep-mode-btn ${pickerMode === 'entry' ? 'active' : ''}`}
            onClick={() => setPickerMode('entry')}
          >数据</button>
          <button
            className={`ep-mode-btn ${pickerMode === 'todo' ? 'active' : ''}`}
            onClick={() => setPickerMode('todo')}
          >待办</button>
        </div>

        {/* 第一块：搜索 */}
        <div className="ep-search-section">
          <div className="ep-search-row">
            <input
              className="ep-search-input"
              placeholder={pickerMode === 'todo' ? '搜索待办…' : '关键字搜索…'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            />
            <button className="ep-search-btn" onClick={handleSearch}>
              <SearchSvg />
              <span>搜索</span>
            </button>
          </div>
        </div>

        {/* 第二块：数据/待办 */}
        <div className="ep-data-section">
          <div className="ep-section-label">
            <span>
              {pickerMode === 'todo' ? '待办' : '数据'} {(pickerMode === 'todo' ? dataTodos.length : dataEntries.length) > 0 && <span className="ep-count">({pickerMode === 'todo' ? dataTodos.length : dataEntries.length})</span>}
            </span>
            {/* 一键全选按钮 */}
            {(pickerMode === 'todo' ? dataTodos.length : dataEntries.length) > 0 && (
              <button
                className="ep-select-all-btn"
                onClick={() => {
                  const allIds = pickerMode === 'todo'
                    ? dataTodos.map(t => t.id)
                    : dataEntries.map(e => e.id);
                  const newSet = new Set(selectedIds);
                  // 检查是否已全部选中，若全选则取消全选
                  const allSelected = allIds.every(id => newSet.has(id));
                  if (allSelected) {
                    allIds.forEach(id => newSet.delete(id));
                  } else {
                    allIds.forEach(id => newSet.add(id));
                  }
                  onSelectionChange(newSet);
                  // 注意：不刷新关联数据
                }}
              >
                {pickerMode === 'todo'
                  ? (dataTodos.every(t => selectedIds.has(t.id)) ? '取消全选' : '全选')
                  : (dataEntries.every(e => selectedIds.has(e.id)) ? '取消全选' : '全选')
                }
              </button>
            )}
          </div>
          <div className="ep-list">
            {loadingData ? (
              <div className="ep-loading">加载中…</div>
            ) : pickerMode === 'todo' ? (
              dataTodos.length > 0 ? (
                dataTodos.map(todo => (
                  <div
                    key={todo.id}
                    className={`ep-card ${selectedIds.has(todo.id) ? 'selected' : ''}`}
                    onClick={() => handleDataEntryClick(todo.id)}
                  >
                    <div className="ep-card-main">
                      <div className={`ep-card-checkbox ${selectedIds.has(todo.id) ? 'checked' : ''}`}>
                        {selectedIds.has(todo.id) && '✓'}
                      </div>
                      <div className="ep-card-text">{todo.title}</div>
                      {todo.startTime && <span className="ep-card-date">{formatTimeShort(todo.startTime)}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <div className="ep-empty">暂无待办</div>
              )
            ) : (
              dataEntries.length > 0 ? (
                dataEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedIds.has(entry.id)}
                    onToggle={() => handleDataEntryClick(entry.id)}
                  />
                ))
              ) : (
                <div className="ep-empty">暂无数据</div>
              )
            )}
          </div>
        </div>

        {/* 第三块：待办模式下的筛选块 */}
        {pickerMode === 'todo' ? (
          <div className="ep-related-section">
            <div className="ep-section-label">
              <span>按标签/按时间</span>
              {/* 完成1：待办模式关联数据全选 */}
              {relatedEntries.length > 0 && (
                <button
                  className="ep-select-all-btn"
                  onClick={() => {
                    const allIds = relatedEntries.map(e => e.id);
                    const newSet = new Set(selectedIds);
                    const allSelected = allIds.every(id => newSet.has(id));
                    if (allSelected) {
                      allIds.forEach(id => newSet.delete(id));
                    } else {
                      allIds.forEach(id => newSet.add(id));
                    }
                    onSelectionChange(newSet);
                  }}
                >
                  {relatedEntries.every(e => selectedIds.has(e.id)) ? '取消全选' : '全选'}
                </button>
              )}
            </div>
            <div className="ep-todo-filter-buttons">
              <button
                className={`ep-filter-btn ${todoFilterMode === 'time' ? 'active' : ''}`}
                onClick={() => setTodoFilterMode('time')}
              >按时间</button>
              <button
                className={`ep-filter-btn ${todoFilterMode === 'tag' ? 'active' : ''}`}
                onClick={() => setTodoFilterMode('tag')}
              >按标签</button>
            </div>
            <div className="ep-list">
              {loadingRelated ? (
                <div className="ep-loading">加载中…</div>
              ) : relatedEntries.length > 0 ? (
                relatedEntries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedIds.has(entry.id)}
                    onToggle={() => handleRelatedEntryClick(entry.id)}
                  />
                ))
              ) : (
                <div className="ep-empty">选择上方待办后显示关联</div>
              )}
            </div>
          </div>
        ) : (
          /* 第三块：数据模式下的关联数据 */
          <div className="ep-related-section">
            <div className="ep-section-label">
              <span>
                关联数据 {relatedEntries.length > 0 && <span className="ep-count">({relatedEntries.length})</span>}
                {currentEntryId && <span className="ep-current-hint">· 基于：{dataEntries.find(e => e.id === currentEntryId)?.content.slice(0, 20) ?? '…'}…</span>}
              </span>
              {/* 完成1：一键全选关联数据 */}
              {relatedEntries.length > 0 && (
                <button
                  className="ep-select-all-btn"
                  onClick={() => {
                    const allIds = relatedEntries.map(e => e.id);
                    const newSet = new Set(selectedIds);
                    const allSelected = allIds.every(id => newSet.has(id));
                    if (allSelected) {
                      allIds.forEach(id => newSet.delete(id));
                    } else {
                      allIds.forEach(id => newSet.add(id));
                    }
                    onSelectionChange(newSet);
                  }}
                >
                  {relatedEntries.every(e => selectedIds.has(e.id)) ? '取消全选' : '全选'}
                </button>
              )}
            </div>
            {/* 关联筛选按钮（当有条目同时有多个 tag/组时显示） */}
            {relatedFilterOptions.length > 1 && (
              <div className="ep-related-filters">
                <button
                  className={`ep-filter-btn ${activeRelatedFilter === null ? 'active' : ''}`}
                  onClick={() => setActiveRelatedFilter(null)}
                >全部</button>
                {relatedFilterOptions.map(opt => (
                  <button
                    key={opt.id}
                    className={`ep-filter-btn ${activeRelatedFilter === opt.id ? 'active' : ''}`}
                    onClick={() => setActiveRelatedFilter(opt.id)}
                  >{opt.name}</button>
                ))}
              </div>
            )}
            <div className="ep-list">
              {loadingRelated ? (
                <div className="ep-loading">加载中…</div>
              ) : relatedEntries.length > 0 ? (
                relatedEntries
                  .filter(entry => {
                    if (!activeRelatedFilter) return true;
                    // 简单筛选：如果条目标签中有对应的 tag id 则保留
                    if (entry.tags) {
                      return entry.tags.some(t => t.id === activeRelatedFilter);
                    }
                    return false;
                  })
                  .map(entry => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedIds.has(entry.id)}
                      onToggle={() => handleRelatedEntryClick(entry.id)}
                    />
                  ))
              ) : (
                <div className="ep-empty">选择上方条目后显示关联</div>
              )}
            </div>
          </div>
        )}

        {/* 底部 */}
        <div className="ep-footer">
          <span className="ep-selected-count">已选 {selectedIds.size} 条</span>
          <div className="ep-footer-actions">
            <button className="ep-footer-btn ep-clear-btn" onClick={() => onSelectionChange(new Set())}>
              清空
            </button>
            <button className="ep-footer-btn ep-confirm-btn" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
