/**
 * 搜索页面
 * 全文搜索 + 结果列表 + 一键复制
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { BottomNav } from '@/components/BottomNav';
import type { Entry } from '@/types';
import './SearchPage.css';

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);

const StarFilledIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const StarOutlineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const LightbulbIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
    <path d="M9 18h6"/><path d="M10 22h4"/>
  </svg>
);

export function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [filterStarred, setFilterStarred] = useState<boolean | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useEntryStore(state => state.search);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const tags = useTagStore(state => state.tags);

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 执行搜索
  const handleSearch = useCallback(async () => {
    if (!keyword.trim() && selectedTagIds.length === 0 && filterStarred === undefined) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await search(keyword.trim(), {
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        isStarred: filterStarred,
      });
      setResults(searchResults);
    } finally {
      setIsSearching(false);
    }
  }, [keyword, selectedTagIds, filterStarred, search]);

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch();
    }, 300);
    return () => clearTimeout(timer);
  }, [handleSearch]);

  // 复制内容
  const handleCopy = useCallback(async (entry: Entry) => {
    try {
      await navigator.clipboard.writeText(entry.content);
      markAsUsed(entry.id);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1500);
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = entry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(entry.id);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 1500);
    }
  }, [markAsUsed]);

  // 切换标签筛选
  const toggleTagFilter = useCallback((tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  }, []);

  // 切换星标筛选
  const toggleStarFilter = useCallback(() => {
    setFilterStarred(prev => prev === undefined ? true : prev === true ? false : undefined);
  }, []);

  return (
    <div className="search-page">
      <main className="page-content">
        {/* 搜索框 */}
        <div className="search-input-wrapper glass">
          <span className="search-icon"><SearchIcon /></span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="搜索内容..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          {keyword && (
            <button className="clear-btn" onClick={() => setKeyword('')}><CloseIcon /></button>
          )}
        </div>

        {/* 筛选栏 */}
        <div className="filter-bar">
          <button
            className={`filter-chip ${filterStarred !== undefined ? 'active' : ''}`}
            onClick={toggleStarFilter}
          >
            <span>{filterStarred === false ? <StarOutlineIcon /> : <StarFilledIcon />}</span>
            <span>{filterStarred === false ? '未星标' : filterStarred ? '已星标' : '全部'}</span>
          </button>

          {tags.map(tag => (
            <button
              key={tag.id}
              className={`filter-chip ${selectedTagIds.includes(tag.id) ? 'active' : ''}`}
              onClick={() => toggleTagFilter(tag.id)}
            >
              #{tag.name}
            </button>
          ))}
        </div>

        {/* 搜索结果 */}
        <div className="search-results">
          {isSearching ? (
            <div className="search-loading">
              <div className="loading-spinner small" />
            </div>
          ) : results.length > 0 ? (
            results.map(entry => (
              <div
                key={entry.id}
                className="result-item glass"
                onClick={() => handleCopy(entry)}
              >
                <div className="result-content">
                  {entry.content}
                </div>
                <div className="result-meta">
                  {entry.isStarred && <span className="meta-icon"><StarFilledIcon /></span>}
                  {entry.tags && entry.tags.length > 0 && (
                    <span className="meta-tags-count">{entry.tags.length} 标签</span>
                  )}
                  <span className="meta-time">
                    {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            ))
          ) : keyword || selectedTagIds.length > 0 || filterStarred !== undefined ? (
            <div className="empty-results">
              <span className="empty-icon"><SearchIcon /></span>
              <p className="empty-text">没有找到相关内容</p>
            </div>
          ) : (
            <div className="search-hint">
              <span className="hint-icon"><LightbulbIcon /></span>
              <p>输入关键词开始搜索</p>
              <p className="hint-sub">点击结果即可复制</p>
            </div>
          )}
        </div>
      </main>

      {/* 轻提示 */}
      {showToast && (
        <div className="toast glass">
          <span>已复制</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
