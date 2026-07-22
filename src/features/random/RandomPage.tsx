/**
 * 随机浏览页面
 * 卡片堆叠流式排列，自动填屏 + 分页刷新
 */
import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from './QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import type { Entry } from '@/types';
import './RandomPage.css';

/** 一次抽取的批次大小 */
const BATCH_SIZE = 20;
/** 卡片间距 (px) */
const CARD_GAP = 12;

export function RandomPage() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const toggleStar = useEntryStore(state => state.toggleStar);
  const tags = useTagStore(state => state.tags);

  // 当前展示的一批条目
  const [currentEntries, setCurrentEntries] = useState<Entry[]>([]);
  // 实际展示的卡片数（测量后决定）
  const [displayCount, setDisplayCount] = useState<number>(BATCH_SIZE);
  // 上次抽取的 id 列表，用于避免连续两屏重复
  const lastIdsRef = useRef<Set<string>>(new Set());

  const [showMenu, setShowMenu] = useState(false);
  const [menuEntry, setMenuEntry] = useState<Entry | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSelectorEntry, setTagSelectorEntry] = useState<Entry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 每张卡片的长按计时器
  const longPressTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pressedId, setPressedId] = useState<string | null>(null);

  // 卡片容器引用（用于测量）
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 筛选条件
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterStarred, setFilterStarred] = useState<boolean | undefined>(undefined);

  // 抽取一批随机条目
  const getRandomEntries = useCallback(() => {
    const filtered = filterEntries(entries, {
      tagIds: filterTagIds.length > 0 ? filterTagIds : undefined,
      isStarred: filterStarred,
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setDisplayCount(0);
      setIsLoading(false);
      return;
    }

    // 排除上一屏出现过的条目（如果过滤后仍足够多）
    const lastIds = lastIdsRef.current;
    let candidates = filtered;
    if (filtered.length > lastIds.size + 1) {
      candidates = filtered.filter(e => !lastIds.has(e.id));
    }

    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(BATCH_SIZE, candidates.length);

    for (let i = 0; i < pickCount; i++) {
      const remaining = candidates.filter(e => !usedIds.has(e.id));
      if (remaining.length === 0) break;
      const selected = weightedRandomSelect(remaining);
      if (!selected) break;
      result.push(selected);
      usedIds.add(selected.id);
    }

    // 如果排除后不够，从全量里补
    if (result.length < BATCH_SIZE && filtered.length > result.length) {
      for (let i = result.length; i < Math.min(BATCH_SIZE, filtered.length); i++) {
        const remaining = filtered.filter(e => !usedIds.has(e.id));
        if (remaining.length === 0) break;
        const selected = weightedRandomSelect(remaining);
        if (!selected) break;
        result.push(selected);
        usedIds.add(selected.id);
      }
    }

    // 更新 lastIds
    lastIdsRef.current = new Set(result.map(e => e.id));

    setCurrentEntries(result);
    setDisplayCount(result.length); // 初始全部渲染，测量后再裁剪
    setIsLoading(false);
  }, [entries, filterTagIds, filterStarred]);

  // 初始加载
  useEffect(() => {
    if (entries.length > 0) {
      getRandomEntries();
    } else {
      setIsLoading(false);
    }
  }, [entries, getRandomEntries]);

  // 测量卡片高度，计算能完整展示几张
  useLayoutEffect(() => {
    if (currentEntries.length === 0 || !cardsContainerRef.current) return;

    const container = cardsContainerRef.current;
    const availableHeight = container.clientHeight;

    let cumulativeHeight = 0;
    let count = 0;

    for (let i = 0; i < currentEntries.length; i++) {
      const entry = currentEntries[i];
      const cardEl = cardRefs.current.get(entry.id);
      if (!cardEl) continue;

      const cardHeight = cardEl.offsetHeight;
      // 累加卡片高度 + 间距（第一张不需要上方间距）
      const heightToAdd = i === 0 ? cardHeight : cardHeight + CARD_GAP;

      if (cumulativeHeight + heightToAdd > availableHeight && count > 0) {
        break;
      }
      cumulativeHeight += heightToAdd;
      count++;
    }

    if (count > 0 && count !== displayCount) {
      setDisplayCount(count);
    }
  }, [currentEntries, displayCount]);

  // 复制内容
  const handleCopy = useCallback(async (entry: Entry) => {
    try {
      await navigator.clipboard.writeText(entry.content);
      markAsUsed(entry.id);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = entry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(entry.id);
    }
  }, [markAsUsed]);

  // 长按开始
  const handlePressStart = useCallback((entryId: string) => {
    setPressedId(entryId);
    const timer = setTimeout(() => {
      const entry = currentEntries.find(e => e.id === entryId);
      if (entry) {
        setMenuEntry(entry);
        setShowMenu(true);
      }
      setPressedId(null);
    }, 500);
    longPressTimersRef.current.set(entryId, timer);
  }, [currentEntries]);

  // 长按结束
  const handlePressEnd = useCallback((entryId: string) => {
    setPressedId(null);
    const timer = longPressTimersRef.current.get(entryId);
    if (timer) {
      clearTimeout(timer);
      longPressTimersRef.current.delete(entryId);
    }
  }, []);

  // 切换星标
  const handleToggleStar = useCallback((entryId: string) => {
    const entry = currentEntries.find(e => e.id === entryId);
    if (!entry) return;
    toggleStar(entryId);
    // 更新本地状态
    setCurrentEntries(prev =>
      prev.map(e =>
        e.id === entryId ? { ...e, isStarred: !e.isStarred } : e
      )
    );
    if (menuEntry && menuEntry.id === entryId) {
      setMenuEntry({ ...menuEntry, isStarred: !menuEntry.isStarred });
    }
  }, [currentEntries, toggleStar, menuEntry]);

  // 下一屏（重新随机抽取）
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    getRandomEntries();
  }, [getRandomEntries]);

  // 筛选变更
  const handleFilterChange = useCallback((tagIds: string[], starred?: boolean) => {
    setFilterTagIds(tagIds);
    setFilterStarred(starred);
    setShowFilter(false);
    lastIdsRef.current = new Set();
    setIsLoading(true);

    // 重新获取随机条目
    const filtered = filterEntries(entries, {
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      isStarred: starred,
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setDisplayCount(0);
      setIsLoading(false);
      return;
    }

    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(BATCH_SIZE, filtered.length);

    for (let i = 0; i < pickCount; i++) {
      const remaining = filtered.filter(e => !usedIds.has(e.id));
      if (remaining.length === 0) break;
      const selected = weightedRandomSelect(remaining);
      if (!selected) break;
      result.push(selected);
      usedIds.add(selected.id);
    }

    lastIdsRef.current = new Set(result.map(e => e.id));
    setCurrentEntries(result);
    setDisplayCount(result.length);
    setIsLoading(false);
  }, [entries]);

  // 清理长按计时器
  useEffect(() => {
    return () => {
      longPressTimersRef.current.forEach(timer => clearTimeout(timer));
      longPressTimersRef.current.clear();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="random-page">
        <div className="loading-card glass">
          <div className="loading-spinner" />
        </div>
        <BottomNav />
      </div>
    );
  }

  const visibleEntries = currentEntries.slice(0, displayCount);

  return (
    <div className="random-page">
      <header className="page-header">
        <h1 className="page-title">随机浏览</h1>
        <button className="filter-btn" onClick={() => setShowFilter(true)}>
          <span>🔍</span>
        </button>
      </header>

      {/* 筛选标签显示 */}
      {(filterTagIds.length > 0 || filterStarred !== undefined) && (
        <div className="active-filters">
          {filterStarred !== undefined && (
            <span className="filter-badge">
              {filterStarred ? '⭐ 已星标' : '☆ 未星标'}
              <button onClick={() => handleFilterChange(filterTagIds, undefined)}>✕</button>
            </span>
          )}
          {filterTagIds.map(tagId => {
            const tag = tags.find(t => t.id === tagId);
            return tag ? (
              <span key={tagId} className="filter-badge">
                #{tag.name}
                <button onClick={() => handleFilterChange(filterTagIds.filter(id => id !== tagId), filterStarred)}>✕</button>
              </span>
            ) : null;
          })}
        </div>
      )}

      <main className="page-content">
        {visibleEntries.length > 0 ? (
          <>
            <div
              className="cards-stack"
              ref={cardsContainerRef}
            >
              {/* 全部渲染用于测量，但超出部分隐藏 */}
              {currentEntries.map((entry, index) => {
                const isVisible = index < displayCount;
                return (
                  <div
                    key={entry.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(entry.id, el);
                      else cardRefs.current.delete(entry.id);
                    }}
                    className={`card-item ${pressedId === entry.id ? 'pressed' : ''} ${!isVisible ? 'card-hidden' : ''}`}
                    onClick={() => handleCopy(entry)}
                    onMouseDown={() => handlePressStart(entry.id)}
                    onMouseUp={() => handlePressEnd(entry.id)}
                    onMouseLeave={() => handlePressEnd(entry.id)}
                    onTouchStart={() => handlePressStart(entry.id)}
                    onTouchEnd={() => handlePressEnd(entry.id)}
                  >
                    <div className="entry-card glass">
                      <div className="card-content">
                        {entry.content}
                      </div>

                      <div className="card-meta">
                        {entry.isStarred && (
                          <span className="meta-star">⭐</span>
                        )}
                        {entry.tags && entry.tags.length > 0 && (
                          <div className="meta-tags">
                            {entry.tags.map(tag => (
                              <span key={tag.id} className="meta-tag">#{tag.name}</span>
                            ))}
                          </div>
                        )}
                        <span className="meta-time">
                          {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card-actions">
              <button className="nav-btn glass" onClick={handleRefresh}>
                <span>🔄</span>
                <span>刷新下一屏</span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">📭</span>
            <p className="empty-text">没有符合条件的记忆</p>
            <p className="empty-hint">尝试调整筛选条件</p>
          </div>
        )}
      </main>

      {/* 快捷菜单 */}
      {showMenu && menuEntry && (
        <QuickMenu
          entry={menuEntry}
          onClose={() => setShowMenu(false)}
          onToggleStar={() => handleToggleStar(menuEntry.id)}
          onViewLinks={() => {
            setShowMenu(false);
            navigate(`/links/${menuEntry.id}`);
          }}
          onEditTags={() => {
            setShowMenu(false);
            setTagSelectorEntry(menuEntry);
            setShowTagSelector(true);
          }}
        />
      )}

      {/* 筛选面板 */}
      {showFilter && (
        <div className="filter-overlay" onClick={() => setShowFilter(false)}>
          <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>筛选条件</h3>
              <button onClick={() => setShowFilter(false)}>✕</button>
            </div>

            {/* 星标筛选 */}
            <div className="filter-section">
              <label className="filter-label">星标状态</label>
              <div className="star-filter">
                <button
                  className={filterStarred === undefined ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, undefined)}
                >
                  全部
                </button>
                <button
                  className={filterStarred === true ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, true)}
                >
                  ⭐ 已星标
                </button>
                <button
                  className={filterStarred === false ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, false)}
                >
                  ☆ 未星标
                </button>
              </div>
            </div>

            {/* 标签筛选 */}
            <div className="filter-section">
              <label className="filter-label">标签筛选</label>
              <TagSelector
                selectedTagIds={filterTagIds}
                onSelectionChange={setFilterTagIds}
              />
            </div>
          </div>
        </div>
      )}

      {/* 标签选择器 */}
      {showTagSelector && tagSelectorEntry && (
        <div className="filter-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={tagSelectorEntry.tags?.map(t => t.id) || []}
              onSelectionChange={async (tagIds) => {
                // TODO: 保存标签变更
                setShowTagSelector(false);
              }}
              onClose={() => setShowTagSelector(false)}
            />
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
