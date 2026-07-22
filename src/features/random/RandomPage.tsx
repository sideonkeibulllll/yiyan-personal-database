/**
 * 随机浏览页面
 * 加权随机"抽卡"浏览体验，支持范围筛选
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from './QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import type { Entry } from '@/types';
import './RandomPage.css';

export function RandomPage() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const toggleStar = useEntryStore(state => state.toggleStar);
  const tags = useTagStore(state => state.tags);

  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  // 筛选条件
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterStarred, setFilterStarred] = useState<boolean | undefined>(undefined);

  // 获取随机条目
  const getRandomEntry = useCallback(() => {
    const filtered = filterEntries(entries, {
      tagIds: filterTagIds.length > 0 ? filterTagIds : undefined,
      isStarred: filterStarred,
    });
    const selected = weightedRandomSelect(filtered);
    setCurrentEntry(selected);
    setIsLoading(false);
  }, [entries, filterTagIds, filterStarred]);

  // 初始加载
  useEffect(() => {
    if (entries.length > 0) {
      getRandomEntry();
    } else {
      setIsLoading(false);
    }
  }, [entries, getRandomEntry]);

  // 复制内容
  const handleCopy = useCallback(async () => {
    if (!currentEntry) return;

    try {
      await navigator.clipboard.writeText(currentEntry.content);
      markAsUsed(currentEntry.id);
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = currentEntry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(currentEntry.id);
    }
  }, [currentEntry, markAsUsed]);

  // 长按开始
  const handlePressStart = useCallback(() => {
    setIsPressed(true);
    const timer = setTimeout(() => {
      setShowMenu(true);
      setIsPressed(false);
    }, 500);
    setLongPressTimer(timer);
  }, []);

  // 长按结束
  const handlePressEnd = useCallback(() => {
    setIsPressed(false);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  // 切换星标
  const handleToggleStar = useCallback(() => {
    if (currentEntry) {
      toggleStar(currentEntry.id);
      setCurrentEntry({ ...currentEntry, isStarred: !currentEntry.isStarred });
    }
  }, [currentEntry, toggleStar]);

  // 下一张
  const handleNext = useCallback(() => {
    getRandomEntry();
  }, [getRandomEntry]);

  // 筛选变更
  const handleFilterChange = useCallback((tagIds: string[], starred?: boolean) => {
    setFilterTagIds(tagIds);
    setFilterStarred(starred);
    setShowFilter(false);

    // 重新获取随机条目
    const filtered = filterEntries(entries, {
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      isStarred: starred,
    });
    const selected = weightedRandomSelect(filtered);
    setCurrentEntry(selected);
  }, [entries]);

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
        {currentEntry ? (
          <>
            <div
              className={`card-container ${isPressed ? 'pressed' : ''}`}
              onClick={handleCopy}
              onMouseDown={handlePressStart}
              onMouseUp={handlePressEnd}
              onMouseLeave={handlePressEnd}
              onTouchStart={handlePressStart}
              onTouchEnd={handlePressEnd}
            >
              <div className="entry-card glass">
                <div className="card-content">
                  {currentEntry.content}
                </div>

                <div className="card-meta">
                  {currentEntry.isStarred && (
                    <span className="meta-star">⭐</span>
                  )}
                  {currentEntry.tags && currentEntry.tags.length > 0 && (
                    <div className="meta-tags">
                      {currentEntry.tags.map(tag => (
                        <span key={tag.id} className="meta-tag">#{tag.name}</span>
                      ))}
                    </div>
                  )}
                  <span className="meta-time">
                    {new Date(currentEntry.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            </div>

            <div className="card-actions">
              <button className="nav-btn glass" onClick={handleNext}>
                <span>🎴</span>
                <span>下一张</span>
              </button>
              <button className="nav-btn glass" onClick={handleToggleStar}>
                <span>{currentEntry.isStarred ? '⭐' : '☆'}</span>
                <span>{currentEntry.isStarred ? '已星标' : '星标'}</span>
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
      {showMenu && currentEntry && (
        <QuickMenu
          entry={currentEntry}
          onClose={() => setShowMenu(false)}
          onToggleStar={handleToggleStar}
          onViewLinks={() => {
            setShowMenu(false);
            navigate(`/links/${currentEntry.id}`);
          }}
          onEditTags={() => {
            setShowMenu(false);
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
      {showTagSelector && currentEntry && (
        <div className="filter-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={currentEntry.tags?.map(t => t.id) || []}
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
