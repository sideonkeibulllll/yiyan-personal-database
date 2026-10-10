/**
 * 搜索页面
 * 全文搜索 + 结果列表 + 一键复制
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { getDatabase } from '@/services/database';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from '@/features/random/QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import { TIME_RANGE_PRESETS, resolveTimeRange, timeRangeLabel, sanitizeTimeRangeState } from '@/utils/timeRangeFilter';
import type { TimeRangePreset, TimeRangeState } from '@/utils/timeRangeFilter';
import type { Entry, Todo, TodoSearchTimeFilter, Tag } from '@/types';
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

const PaperclipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>
);

const PaperclipOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    <path d="m2 2 20 20"/>
  </svg>
);

const LightbulbIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
    <path d="M9 18h6"/><path d="M10 22h4"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>
);

/* === v2.10.0: 时间范围筛选（修改时间；换算逻辑见 utils/timeRangeFilter 共享模块） === */

/** 时间筛选记忆键：缓存上次选择的 N（下次进入自动恢复） */
const TIME_RANGE_STORAGE_KEY = 'yiyan_search_time_filter_v1';

function loadTimeFilter(): TimeRangeState {
  try {
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeTimeRangeState(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persistTimeFilter(state: TimeRangeState): void {
  try {
    if (!state.preset) {
      localStorage.removeItem(TIME_RANGE_STORAGE_KEY);
    } else {
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    /* 忽略存储失败 */
  }
}

export function SearchPage() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // v2.6.3: 轻提示改为可自定义文案（原实现硬编码「已复制」，其它场景复用时会显示错误文案）
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const showToastMessage = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1800);
  }, []);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [filterStarred, setFilterStarred] = useState<boolean | undefined>(undefined);
  const [filterHasAttachment, setFilterHasAttachment] = useState<boolean | undefined>(undefined);
  // v2.10.0: 时间范围筛选（缓存上次选择：「近N天」的 N 会被记住）
  const [timeFilter, setTimeFilter] = useState<TimeRangeState>(() => loadTimeFilter());
  const [showTimePanel, setShowTimePanel] = useState(false);
  const [todoMode, setTodoMode] = useState(false);
  const [todoResults, setTodoResults] = useState<Todo[]>([]);
  const [todoTimeFilter, setTodoTimeFilter] = useState<TodoSearchTimeFilter>('future');
  const [menuEntry, setMenuEntry] = useState<Entry | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  // v2.6.3: 「编辑标签」改为打开 TagSelector 覆盖层（与随机页行为统一）
  const [tagSelectorEntry, setTagSelectorEntry] = useState<Entry | null>(null);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const longPressTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 修复7：标签搜索模式 + 关联标签推荐
  const [tagSearchMode, setTagSearchMode] = useState(false); // 是否处于标签搜索模式
  const [matchedTags, setMatchedTags] = useState<Tag[]>([]); // 关键字匹配的标签
  const [activeTagId, setActiveTagId] = useState<string | null>(null); // 当前激活的标签
  const [linkedTags, setLinkedTags] = useState<{ tag: Tag; count: number }[]>([]); // 关联标签推荐

  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useEntryStore(state => state.search);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const tags = useTagStore(state => state.tags);
  const searchTodos = useTodoStore(state => state.searchTodos);

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 修复7：加载关联标签推荐 — 找出拥有该标签的数据还链接了哪些其他标签
  const loadLinkedTags = useCallback(async (tagId: string) => {
    try {
      const db = await getDatabase();
      const entriesWithTag = await db.getEntriesByTagId(tagId);
      const linkedTagCount = new Map<string, number>();

      for (const entry of entriesWithTag) {
        if (entry.tags) {
          for (const tag of entry.tags) {
            if (tag.id !== tagId) {
              linkedTagCount.set(tag.id, (linkedTagCount.get(tag.id) || 0) + 1);
            }
          }
        }
      }

      // 获取关联标签的完整信息并按数量排序
      const allTags = await db.getAllTags();
      const linked = Array.from(linkedTagCount.entries())
        .map(([id, count]) => ({ tag: allTags.find(t => t.id === id)!, count }))
        .filter(item => item.tag)
        .sort((a, b) => b.count - a.count);

      setLinkedTags(linked);
    } catch (err) {
      console.error('加载关联标签失败:', err);
      setLinkedTags([]);
    }
  }, []);

  // 修复7：标签搜索 — 关键字匹配标签
  const handleTagSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setMatchedTags([]);
      setTagSearchMode(false);
      return;
    }
    const lower = kw.toLowerCase();
    const matched = tags.filter(tag => tag.name.toLowerCase().includes(lower));
    setMatchedTags(matched);
    setTagSearchMode(matched.length > 0);
  }, [tags]);

  // 修复7：点击匹配的标签 → 列出该标签下所有卡片
  const handleTagClick = useCallback(async (tagId: string) => {
    setActiveTagId(tagId);
    setKeyword('');
    setMatchedTags([]);
    setTagSearchMode(false);
    setSelectedTagIds([tagId]);
    // 加载关联标签推荐
    loadLinkedTags(tagId);
  }, [loadLinkedTags]);

  // 修复7：切换关联标签
  const handleSwitchTag = useCallback(async (tagId: string) => {
    setActiveTagId(tagId);
    setSelectedTagIds([tagId]);
    loadLinkedTags(tagId);
  }, [loadLinkedTags]);

  // 执行搜索
  const handleSearch = useCallback(async () => {
    if (todoMode) {
      if (!keyword.trim()) {
        setTodoResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const todoSearchResults = await searchTodos(keyword.trim(), todoTimeFilter);
        setTodoResults(todoSearchResults);
      } finally {
        setIsSearching(false);
      }
      return;
    }

    if (!keyword.trim() && selectedTagIds.length === 0 && filterStarred === undefined && filterHasAttachment === undefined && !timeFilter.preset) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await search(keyword.trim(), {
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        isStarred: filterStarred,
        hasAttachment: filterHasAttachment,
        // v2.10.0: 修改时间范围（近1/3/7天 或 自定义日期）
        ...resolveTimeRange(timeFilter),
      });
      setResults(searchResults);
    } finally {
      setIsSearching(false);
    }
  }, [keyword, selectedTagIds, filterStarred, filterHasAttachment, timeFilter, search, todoMode, todoTimeFilter, searchTodos]);

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
      showToastMessage('已复制');
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = entry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(entry.id);
      showToastMessage('已复制');
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

  // 切换附件筛选
  const toggleAttachmentFilter = useCallback(() => {
    setFilterHasAttachment(prev => prev === undefined ? true : prev === true ? false : undefined);
  }, []);

  // v2.10.0: 应用时间筛选（并缓存为下次记忆）
  const applyTimeFilter = useCallback((next: TimeRangeState) => {
    setTimeFilter(next);
    persistTimeFilter(next);
  }, []);

  // 时间预设：点已激活的项 = 取消
  const handleTimePresetClick = useCallback((preset: TimeRangePreset) => {
    applyTimeFilter(timeFilter.preset === preset ? {} : { preset });
  }, [timeFilter.preset, applyTimeFilter]);

  // 自定义日期变更（即改即搜）
  const handleCustomDateChange = useCallback((field: 'from' | 'to', value: string) => {
    applyTimeFilter({ ...timeFilter, preset: 'custom', [field]: value || undefined });
  }, [timeFilter, applyTimeFilter]);

  // 长按结果项
  const handlePressStart = useCallback((entry: Entry) => {
    const timer = setTimeout(() => {
      setMenuEntry(entry);
      setShowMenu(true);
    }, 500);
    longPressTimersRef.current.set(entry.id, timer);
  }, []);

  const handlePressEnd = useCallback((entryId: string) => {
    const timer = longPressTimersRef.current.get(entryId);
    if (timer) {
      clearTimeout(timer);
      longPressTimersRef.current.delete(entryId);
    }
  }, []);

  useEffect(() => () => {
    longPressTimersRef.current.forEach(t => clearTimeout(t));
    longPressTimersRef.current.clear();
  }, []);

  // 保存为智能标签
  const [showSaveSmartTag, setShowSaveSmartTag] = useState(false);
  const [smartTagName, setSmartTagName] = useState('');

  const handleSaveSmartTag = useCallback(async () => {
    if (!smartTagName.trim()) return;
    const { getDatabase } = await import('@/services/database');
    const db = await getDatabase();
    await db.createTag(smartTagName.trim(), {
      isSmart: true,
      searchCriteria: {
        keyword: keyword.trim() || undefined,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
        isStarred: filterStarred,
        hasAttachment: filterHasAttachment,
      },
    });
    setSmartTagName('');
    setShowSaveSmartTag(false);
    showToastMessage('已保存为智能标签');
  }, [smartTagName, keyword, selectedTagIds, filterStarred, filterHasAttachment]);

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
            placeholder={todoMode ? "搜索待办..." : "搜索内容或标签..."}
            value={keyword}
            onChange={e => {
              setKeyword(e.target.value);
              if (!todoMode) handleTagSearch(e.target.value);
            }}
          />
          {keyword && (
            <button className="clear-btn" onClick={() => { setKeyword(''); setMatchedTags([]); setTagSearchMode(false); }}><CloseIcon /></button>
          )}
        </div>

        {/* 修复7：标签搜索匹配结果 */}
        {!todoMode && tagSearchMode && matchedTags.length > 0 && (
          <div className="tag-search-results">
            <div className="tag-search-label">匹配的标签：</div>
            <div className="tag-search-list">
              {matchedTags.map(tag => (
                <button
                  key={tag.id}
                  className={`tag-search-chip ${activeTagId === tag.id ? 'active' : ''}`}
                  style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
                  onClick={() => handleTagClick(tag.id)}
                >
                  #{tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 修复7：关联标签推荐栏 */}
        {!todoMode && activeTagId && linkedTags.length > 0 && (
          <div className="linked-tags-bar">
            <div className="linked-tags-label">拥有这个标签的数据还链接了：</div>
            <div className="linked-tags-list">
              {linkedTags.map(({ tag, count }) => (
                <button
                  key={tag.id}
                  className={`linked-tag-chip ${activeTagId === tag.id ? 'active' : ''}`}
                  style={tag.color ? { borderColor: tag.color } : undefined}
                  onClick={() => handleSwitchTag(tag.id)}
                >
                  #{tag.name} ({count})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 模式切换 */}
        <div className="search-mode-tabs">
          <button
            className={`search-mode-tab ${!todoMode ? 'active' : ''}`}
            onClick={() => { setTodoMode(false); setTodoResults([]); }}
          >
            笔记搜索
          </button>
          <button
            className={`search-mode-tab ${todoMode ? 'active' : ''}`}
            onClick={() => { setTodoMode(true); setResults([]); }}
          >
            待办搜索
          </button>
        </div>

        {/* 待办搜索筛选 */}
        {todoMode ? (
          <div className="filter-bar">
            <button
              className={`filter-chip ${todoTimeFilter === 'future' ? 'active' : ''}`}
              onClick={() => setTodoTimeFilter('future')}
            >
              <span>未来待办</span>
            </button>
            <button
              className={`filter-chip ${todoTimeFilter === 'expired' ? 'active' : ''}`}
              onClick={() => setTodoTimeFilter('expired')}
            >
              <span>已过期</span>
            </button>
            <button
              className={`filter-chip ${todoTimeFilter === 'expiredOverMonth' ? 'active' : ''}`}
              onClick={() => setTodoTimeFilter('expiredOverMonth')}
            >
              <span>回收站(30天+)</span>
            </button>
          </div>
        ) : (
          /* 笔记筛选栏 */
          <div className="filter-bar">
            <button
              className={`filter-chip ${filterStarred !== undefined ? 'active' : ''}`}
              onClick={toggleStarFilter}
            >
              <span>{filterStarred === false ? <StarOutlineIcon /> : <StarFilledIcon />}</span>
              <span>{filterStarred === false ? '未星标' : filterStarred ? '已星标' : '全部'}</span>
            </button>

            <button
              className={`filter-chip ${filterHasAttachment !== undefined ? 'active' : ''}`}
              onClick={toggleAttachmentFilter}
            >
              <span>{filterHasAttachment === false ? <PaperclipOffIcon /> : <PaperclipIcon />}</span>
              <span>{filterHasAttachment === false ? '无附件' : filterHasAttachment ? '有附件' : '附件'}</span>
            </button>

            {/* v2.10.0: 时间范围筛选（点击展开） */}
            <button
              className={`filter-chip ${timeFilter.preset ? 'active' : ''}`}
              onClick={() => setShowTimePanel(v => !v)}
            >
              <span><ClockIcon /></span>
              <span>{timeRangeLabel(timeFilter)}</span>
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
        )}

        {/* v2.10.0: 时间范围筛选面板（近1/3/7天 / 自定义日期；选择会被缓存） */}
        {!todoMode && showTimePanel && (
          <div className="time-filter-panel glass">
            <div className="time-filter-presets">
              {TIME_RANGE_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`time-filter-chip ${timeFilter.preset === p.key ? 'active' : ''}`}
                  onClick={() => handleTimePresetClick(p.key)}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`time-filter-chip ${timeFilter.preset === 'custom' ? 'active' : ''}`}
                onClick={() => applyTimeFilter({ ...timeFilter, preset: 'custom' })}
              >
                自由选择
              </button>
              {timeFilter.preset && (
                <button className="time-filter-clear" onClick={() => applyTimeFilter({})}>
                  清除
                </button>
              )}
            </div>
            {timeFilter.preset === 'custom' && (
              <div className="time-filter-custom">
                <input
                  type="date"
                  className="time-filter-date"
                  value={timeFilter.from || ''}
                  onChange={e => handleCustomDateChange('from', e.target.value)}
                />
                <span className="time-filter-sep">至</span>
                <input
                  type="date"
                  className="time-filter-date"
                  value={timeFilter.to || ''}
                  onChange={e => handleCustomDateChange('to', e.target.value)}
                />
              </div>
            )}
            <div className="time-filter-hint">按「修改时间」筛选（编辑 / 星标 / 复制过的都算）</div>
          </div>
        )}

        {/* 保存为智能标签 */}
        {!todoMode && (keyword || selectedTagIds.length > 0 || filterStarred !== undefined || filterHasAttachment !== undefined) && (
          <button
            className="save-smart-tag-btn"
            onClick={() => setShowSaveSmartTag(true)}
          >
            保存为智能标签
          </button>
        )}

        {/* 搜索结果 */}
        <div className="search-results">
          {isSearching ? (
            <div className="search-loading">
              <div className="loading-spinner small" />
            </div>
          ) : todoMode ? (
            /* 待办搜索结果 */
            todoResults.length > 0 ? (
              todoResults.map(todo => (
                <div
                  key={todo.id}
                  className="result-item glass todo-search-result"
                >
                  <div className="result-content">
                    <span className={`todo-status-badge ${todo.status}`}>●</span>
                    {todo.title}
                  </div>
                  <div className="result-meta">
                    {todo.folderDate && (
                      <span className="meta-time">{todo.folderDate}</span>
                    )}
                    {todo.deletedAt && (
                      <span className="meta-deleted">已删除</span>
                    )}
                  </div>
                </div>
              ))
            ) : keyword ? (
              <div className="empty-results">
                <span className="empty-icon"><SearchIcon /></span>
                <p className="empty-text">没有找到相关待办</p>
              </div>
            ) : (
              <div className="search-hint">
                <span className="hint-icon"><LightbulbIcon /></span>
                <p>输入关键词搜索待办</p>
                <p className="hint-sub">可筛选未来/已过期/回收站</p>
              </div>
            )
          ) : results.length > 0 ? (
            results.map(entry => (
              <div
                key={entry.id}
                className="result-item glass"
                onClick={() => handleCopy(entry)}
                onMouseDown={() => handlePressStart(entry)}
                onMouseUp={() => handlePressEnd(entry.id)}
                onMouseLeave={() => handlePressEnd(entry.id)}
                onTouchStart={() => handlePressStart(entry)}
                onTouchEnd={() => handlePressEnd(entry.id)}
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
          ) : keyword || selectedTagIds.length > 0 || filterStarred !== undefined || filterHasAttachment !== undefined || timeFilter.preset ? (
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
      {toastMsg && (
        <div className="toast glass">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 长按菜单 */}
      {showMenu && menuEntry && (
        <QuickMenu
          entry={menuEntry}
          onClose={() => setShowMenu(false)}
          onToggleStar={() => {
            // 简单调用 store
            const { toggleStar } = useEntryStore.getState();
            toggleStar(menuEntry.id);
            setShowMenu(false);
          }}
          onViewLinks={() => {
            setShowMenu(false);
            navigate(`/links/${menuEntry.id}`);
          }}
          onEditTags={() => {
            setShowMenu(false);
            setTagSelectorEntry(menuEntry);
            setShowTagSelector(true);
          }}
          onAIChat={(entryId) => {
            setShowMenu(false);
            navigate(`/chat?entryId=${entryId}&from=/search`);
          }}
          onEditInfo={(entry) => {
            // 与随机页长按菜单行为一致：跳转条目编辑页
            setShowMenu(false);
            navigate(`/entry/${entry.id}/edit`);
          }}
          onToast={showToastMessage}
        />
      )}

      {/* 标签选择器 — v2.6.3: 与随机页/录入页保持一致的就地打标签 */}
      {showTagSelector && tagSelectorEntry && (
        <div className="home-tag-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="home-tag-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={tagSelectorEntry.tags?.map(t => t.id) || []}
              onSelectionChange={async (tagIds) => {
                try {
                  const db = await getDatabase();
                  const currentTags = tagSelectorEntry.tags?.map(t => t.id) || [];
                  const toAdd = tagIds.filter(id => !currentTags.includes(id));
                  const toRemove = currentTags.filter(id => !tagIds.includes(id));
                  for (const tagId of toAdd) {
                    await db.addTagToEntry(tagSelectorEntry.id, tagId);
                  }
                  for (const tagId of toRemove) {
                    await db.removeTagFromEntry(tagSelectorEntry.id, tagId);
                  }
                  const updatedEntry = {
                    ...tagSelectorEntry,
                    tags: tagIds.map(id => tags.find(t => t.id === id)).filter(Boolean) as Tag[],
                  };
                  setTagSelectorEntry(updatedEntry);
                  setResults(prev => prev.map(e => e.id === updatedEntry.id ? updatedEntry : e));
                } catch (err) {
                  console.error('[SearchPage] 保存标签失败:', err);
                }
                setShowTagSelector(false);
              }}
              onClose={() => setShowTagSelector(false)}
              entryId={tagSelectorEntry.id}
              entryContent={tagSelectorEntry.content}
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
                onClick={() => setShowTagSelector(false)}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存为智能标签弹窗 */}
      {showSaveSmartTag && (
        <div className="confirm-overlay" onClick={() => setShowSaveSmartTag(false)}>
          <div className="confirm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3>保存为智能标签</h3>
            <p>当前搜索条件将被保存为一个智能标签</p>
            <input
              type="text"
              className="smart-tag-input"
              placeholder="智能标签名称..."
              value={smartTagName}
              onChange={e => setSmartTagName(e.target.value)}
              autoFocus
            />
            <div className="confirm-actions">
              <button onClick={() => setShowSaveSmartTag(false)}>取消</button>
              <button
                className="primary"
                onClick={handleSaveSmartTag}
                disabled={!smartTagName.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
