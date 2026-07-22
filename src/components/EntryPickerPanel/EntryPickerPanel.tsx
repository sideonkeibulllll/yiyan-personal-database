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
import type { Entry } from '@/types';
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

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => {
      setExpanded(prev => !prev);
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
      onClick={onToggle}
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
}: EntryPickerPanelProps) {
  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  // 数据列表（第二块）
  const [dataEntries, setDataEntries] = useState<Entry[]>([]);
  // 关联列表（第三块）
  const [relatedEntries, setRelatedEntries] = useState<Entry[]>([]);
  // 当前选中的"主"条目（用于关联刷新）
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(initialEntryId ?? null);
  // 加载状态
  const [loadingData, setLoadingData] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState(false);

  /** 搜索条目 → 刷新第二块 */
  const handleSearch = useCallback(async () => {
    setLoadingData(true);
    try {
      const db = await getDatabase();
      let results: Entry[];
      if (searchQuery.trim()) {
        results = await db.searchEntries(searchQuery.trim());
      } else {
        results = await db.getAllEntries();
      }
      // === 修复 2：按最近复制和最近长按排序 ===
      // 从 window 读取交互记录
      const COPY_KEY = '__yiyan_last_copy_at__';
      const MENU_KEY = '__yiyan_last_menu_at__';
      const copyMap: Record<string, number> = (window as any)[COPY_KEY] || {};
      const menuMap: Record<string, number> = (window as any)[MENU_KEY] || {};
      results.sort((a, b) => {
        const aCopy = copyMap[a.id] || 0;
        const bCopy = copyMap[b.id] || 0;
        const aMenu = menuMap[a.id] || 0;
        const bMenu = menuMap[b.id] || 0;
        // 取复制和长按中最新的时间
        const aMax = Math.max(aCopy, aMenu, a.lastUsedAt || 0);
        const bMax = Math.max(bCopy, bMenu, b.lastUsedAt || 0);
        return bMax - aMax;
      });
      setDataEntries(results);
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setLoadingData(false);
    }
  }, [searchQuery]);

  /** 获取与指定条目关联的其他条目 */
  const loadRelated = useCallback(async (entryId: string, currentSelectedIds?: Set<string>) => {
    setLoadingRelated(true);
    try {
      const db = await getDatabase();
      const entry = await db.getEntryById(entryId);
      if (!entry) {
        setRelatedEntries([]);
        return;
      }

      const relatedMap = new Map<string, Entry>();

      // 同组
      if (entry.groupId) {
        const sameGroup = await db.getEntriesByGroupId(entry.groupId);
        sameGroup.forEach(e => {
          if (e.id !== entryId) relatedMap.set(e.id, e);
        });
      }

      // 同标签
      if (entry.tags && entry.tags.length > 0) {
        for (const tag of entry.tags) {
          const sameTag = await db.getEntriesByTagId(tag.id);
          sameTag.forEach(e => {
            if (e.id !== entryId) relatedMap.set(e.id, e);
          });
        }
      }

      // 有连线
      const links = await db.getLinksByEntryId(entryId);
      for (const link of links) {
        const otherId = link.sourceId === entryId ? link.targetId : link.sourceId;
        const other = await db.getEntryById(otherId);
        if (other) relatedMap.set(otherId, other);
      }

      // === 修复 1：过滤已选中的数据 ===
      const selectedToFilter = currentSelectedIds ?? selectedIds;
      const filtered = Array.from(relatedMap.values()).filter(
        e => !selectedToFilter.has(e.id)
      );
      setRelatedEntries(filtered);
    } catch (err) {
      console.error('加载关联失败:', err);
      setRelatedEntries([]);
    } finally {
      setLoadingRelated(false);
    }
  }, [selectedIds]);

  /** 初始加载 */
  useEffect(() => {
    handleSearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      loadRelated(entryId);
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
    loadRelated(entryId);
  }, [multiSelect, selectedIds, onSelectionChange, loadRelated]);

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

        {/* 第一块：搜索 */}
        <div className="ep-search-section">
          <div className="ep-search-row">
            <input
              className="ep-search-input"
              placeholder="关键字搜索…"
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

        {/* 第二块：数据 */}
        <div className="ep-data-section">
          <div className="ep-section-label">
            数据 {dataEntries.length > 0 && <span className="ep-count">({dataEntries.length})</span>}
          </div>
          <div className="ep-list" style={{ maxHeight: '30vh', overflowY: 'auto' }}>
            {loadingData ? (
              <div className="ep-loading">加载中…</div>
            ) : dataEntries.length > 0 ? (
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
            )}
          </div>
        </div>

        {/* 第三块：关联数据 */}
        <div className="ep-related-section">
          <div className="ep-section-label">
            关联数据 {relatedEntries.length > 0 && <span className="ep-count">({relatedEntries.length})</span>}
            {currentEntryId && <span className="ep-current-hint">· 基于：{dataEntries.find(e => e.id === currentEntryId)?.content.slice(0, 20) ?? '…'}…</span>}
          </div>
          <div className="ep-list" style={{ maxHeight: '25vh', overflowY: 'auto' }}>
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
              <div className="ep-empty">选择上方条目后显示关联</div>
            )}
          </div>
        </div>

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
