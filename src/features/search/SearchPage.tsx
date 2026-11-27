/**
 * 搜索页面
 *
 * 结构：探照灯。
 * 顶部没有「框」，只有一条 40px 的输入线：字号 22、底部一根 1px 的线，
 * 聚焦时线变成珊瑚色，其余元素（模式、推荐词、筛选）淡到 0.35，只剩这条线是焦点。
 * 结果是按时间分组的竖线时间轴：今天 / 本周 / 更早，每条一个点（命中关键词实心）。
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { getDatabase } from '@/services/database';
import { QuickMenu } from '@/features/random/QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import { TIME_RANGE_PRESETS, resolveTimeRange, timeRangeLabel, sanitizeTimeRangeState } from '@/utils/timeRangeFilter';
import type { TimeRangePreset, TimeRangeState } from '@/utils/timeRangeFilter';
import type { Entry, Todo, TodoSearchTimeFilter, Tag } from '@/types';
import './SearchPage.css';

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6"/>
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
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const PaperclipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>
);

const PaperclipOffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    <path d="m2 2 20 20"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
  </svg>
);

/** v2.12.0: 浏览卡片入口右箭头 */
const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6"/>
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

/* === 结果按时间分堆（今天 / 本周 / 更早），堆内保持原顺序 === */
interface TimeGroup {
  key: string;
  label: string;
  items: Entry[];
}

function groupEntriesByTime(list: Entry[]): TimeGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const today: Entry[] = [];
  const week: Entry[] = [];
  const older: Entry[] = [];
  for (const e of list) {
    if (e.createdAt >= startOfToday) today.push(e);
    else if (e.createdAt >= startOfWeek) week.push(e);
    else older.push(e);
  }
  return [
    { key: 'today', label: '今天', items: today },
    { key: 'week', label: '本周', items: week },
    { key: 'older', label: '更早', items: older },
  ].filter(g => g.items.length > 0);
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

  // 输入行是否聚焦 —— 聚焦时页面其它东西退到 0.35
  const [inputFocused, setInputFocused] = useState(false);

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

  // 有可保存的搜索条件时，右上角才出现「存为标签」
  const canSaveSmartTag = !todoMode
    && (!!keyword || selectedTagIds.length > 0 || filterStarred !== undefined || filterHasAttachment !== undefined);

  const hasAnyCondition = !!keyword
    || selectedTagIds.length > 0
    || filterStarred !== undefined
    || filterHasAttachment !== undefined
    || !!timeFilter.preset;

  const keywordLower = keyword.trim().toLowerCase();
  const groups = groupEntriesByTime(results);

  return (
    <div className={`sp-page${inputFocused ? ' is-focus' : ''}`}>
      {/* 44px 顶条：返回 / 标题 / 一个动作位 */}
      <header className="sp-bar">
        <button className="sp-bar-btn" onClick={() => navigate(-1)} aria-label="返回">
          <ChevronLeftIcon />
        </button>
        <span className="sp-bar-title">搜索</span>
        {canSaveSmartTag ? (
          <button className="sp-bar-action" onClick={() => setShowSaveSmartTag(true)}>存为标签</button>
        ) : (
          <span className="sp-bar-slot" aria-hidden />
        )}
      </header>

      {/* 一条线，不是一只框 */}
      <div className="sp-searchrow">
        <span className="sp-searchrow-icon"><SearchIcon /></span>
        <input
          ref={inputRef}
          type="text"
          className="sp-input"
          placeholder={todoMode ? '搜待办' : '搜记忆正文，也可以搜标签'}
          value={keyword}
          onChange={e => {
            setKeyword(e.target.value);
            if (!todoMode) handleTagSearch(e.target.value);
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        {keyword && (
          <button
            className="sp-clear"
            aria-label="清空"
            onClick={() => { setKeyword(''); setMatchedTags([]); setTagSearchMode(false); }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="sp-body">
        {/* 模式：两个词，选中的那条带一根短线 */}
        <div className="sp-modes sp-dim">
          <button
            className={`sp-mode${!todoMode ? ' is-on' : ''}`}
            onClick={() => { setTodoMode(false); setTodoResults([]); }}
          >
            笔记
          </button>
          <button
            className={`sp-mode${todoMode ? ' is-on' : ''}`}
            onClick={() => { setTodoMode(true); setResults([]); }}
          >
            待办
          </button>
        </div>

        {/* 修复7：标签搜索匹配结果 —— 一行可滑的胶囊 */}
        {!todoMode && tagSearchMode && matchedTags.length > 0 && (
          <div className="sp-suggest sp-dim">
            <span className="sp-suggest-label">标签</span>
            <div className="sp-pillrow">
              {matchedTags.map(tag => (
                <button
                  key={tag.id}
                  className={`sp-pill${activeTagId === tag.id ? ' is-on' : ''}`}
                  style={tag.color ? { color: tag.color } : undefined}
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
          <div className="sp-suggest sp-dim">
            <span className="sp-suggest-label">常一起出现</span>
            <div className="sp-pillrow">
              {linkedTags.map(({ tag, count }) => (
                <button
                  key={tag.id}
                  className={`sp-pill${activeTagId === tag.id ? ' is-on' : ''}`}
                  style={tag.color ? { color: tag.color } : undefined}
                  onClick={() => handleSwitchTag(tag.id)}
                >
                  #{tag.name} <i>{count}</i>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 筛选：一排安静的胶囊，输入时退场 */}
        {todoMode ? (
          <div className="sp-chips sp-dim">
            <button
              className={`sp-chip${todoTimeFilter === 'future' ? ' is-on' : ''}`}
              onClick={() => setTodoTimeFilter('future')}
            >
              未来待办
            </button>
            <button
              className={`sp-chip${todoTimeFilter === 'expired' ? ' is-on' : ''}`}
              onClick={() => setTodoTimeFilter('expired')}
            >
              已过期
            </button>
            <button
              className={`sp-chip${todoTimeFilter === 'expiredOverMonth' ? ' is-on' : ''}`}
              onClick={() => setTodoTimeFilter('expiredOverMonth')}
            >
              回收站 30 天+
            </button>
          </div>
        ) : (
          <div className="sp-chips sp-dim">
            <button
              className={`sp-chip${filterStarred !== undefined ? ' is-on' : ''}`}
              onClick={toggleStarFilter}
            >
              <span className="sp-chip-icon">{filterStarred === false ? <StarOutlineIcon /> : <StarFilledIcon />}</span>
              <span>{filterStarred === false ? '未星标' : filterStarred ? '已星标' : '全部'}</span>
            </button>

            <button
              className={`sp-chip${filterHasAttachment !== undefined ? ' is-on' : ''}`}
              onClick={toggleAttachmentFilter}
            >
              <span className="sp-chip-icon">{filterHasAttachment === false ? <PaperclipOffIcon /> : <PaperclipIcon />}</span>
              <span>{filterHasAttachment === false ? '无附件' : filterHasAttachment ? '有附件' : '附件'}</span>
            </button>

            {/* v2.10.0: 时间范围筛选（点击展开） */}
            <button
              className={`sp-chip${timeFilter.preset ? ' is-on' : ''}`}
              onClick={() => setShowTimePanel(v => !v)}
            >
              <span className="sp-chip-icon"><ClockIcon /></span>
              <span>{timeRangeLabel(timeFilter)}</span>
            </button>

            {tags.map(tag => (
              <button
                key={tag.id}
                className={`sp-chip${selectedTagIds.includes(tag.id) ? ' is-on' : ''}`}
                onClick={() => toggleTagFilter(tag.id)}
              >
                #{tag.name}
              </button>
            ))}
          </div>
        )}

        {/* v2.10.0: 时间范围筛选面板（近1/3/7天 / 自定义日期；选择会被缓存） */}
        {!todoMode && showTimePanel && (
          <div className="sp-timepanel">
            <div className="sp-pillrow">
              {TIME_RANGE_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`sp-pill${timeFilter.preset === p.key ? ' is-on' : ''}`}
                  onClick={() => handleTimePresetClick(p.key)}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`sp-pill${timeFilter.preset === 'custom' ? ' is-on' : ''}`}
                onClick={() => applyTimeFilter({ ...timeFilter, preset: 'custom' })}
              >
                自由选择
              </button>
              {timeFilter.preset && (
                <button className="sp-pill-clear" onClick={() => applyTimeFilter({})}>
                  清除
                </button>
              )}
            </div>
            {timeFilter.preset === 'custom' && (
              <div className="sp-daterow">
                <input
                  type="date"
                  className="sp-date"
                  value={timeFilter.from || ''}
                  onChange={e => handleCustomDateChange('from', e.target.value)}
                />
                <span className="sp-date-sep">至</span>
                <input
                  type="date"
                  className="sp-date"
                  value={timeFilter.to || ''}
                  onChange={e => handleCustomDateChange('to', e.target.value)}
                />
              </div>
            )}
            <div className="sp-timehint">按「修改时间」筛选（编辑 / 星标 / 复制过的都算）</div>
          </div>
        )}

        {/* 结果：竖线时间轴 */}
        <div className="sp-results">
          {isSearching ? (
            <div className="sp-loading"><div className="sp-spinner" /></div>
          ) : todoMode ? (
            todoResults.length > 0 ? (
              <div className="sp-timeline">
                {todoResults.map(todo => (
                  <div key={todo.id} className="sp-row sp-row--todo">
                    <span className={`sp-dot${todo.status === 'done' ? ' is-done' : ''}`} />
                    <div className="sp-row-main">
                      <div className="sp-row-title">{todo.title}</div>
                      <div className="sp-row-meta">
                        {todo.folderDate && <span className="sp-row-time">{todo.folderDate}</span>}
                        {todo.deletedAt && <span className="sp-deleted">已删除</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : keyword ? (
              <div className="s-empty">
                <b>没找到「{keyword}」</b>
                <span>换个词，或者切到「笔记」看看。</span>
              </div>
            ) : (
              <div className="sp-hint">
                <b>输入关键词，找一条待办</b>
                <span>可按未来 / 过期 / 回收站筛。</span>
              </div>
            )
          ) : results.length > 0 ? (
            <div className="sp-timeline">
              {groups.map(group => (
                <section key={group.key} className="sp-group">
                  <h2 className="sp-group-title">{group.label}</h2>
                  {group.items.map((entry, i) => {
                    const nl = entry.content.indexOf('\n');
                    const title = nl === -1 ? entry.content : entry.content.slice(0, nl);
                    const summary = nl === -1 ? '' : entry.content.slice(nl + 1).trim();
                    const hit = keywordLower.length > 0 && entry.content.toLowerCase().includes(keywordLower);
                    return (
                      <div
                        key={entry.id}
                        className="sp-row sp-item"
                        style={{ animationDelay: `${Math.min(i, 6) * 35}ms` }}
                        onClick={() => handleCopy(entry)}
                        onMouseDown={() => handlePressStart(entry)}
                        onMouseUp={() => handlePressEnd(entry.id)}
                        onMouseLeave={() => handlePressEnd(entry.id)}
                        onTouchStart={() => handlePressStart(entry)}
                        onTouchEnd={() => handlePressEnd(entry.id)}
                      >
                        <span className={`sp-dot${hit ? ' is-hit' : ''}`} />
                        <div className="sp-row-main">
                          <div className="sp-row-title">{title}</div>
                          {summary && <p className="sp-row-sum">{summary}</p>}
                          <div className="sp-row-meta">
                            {entry.isStarred && <span className="sp-row-star"><StarFilledIcon /></span>}
                            {entry.tags && entry.tags.length > 0 && (
                              <span className="sp-row-tagcount">{entry.tags.length} 标签</span>
                            )}
                            <span className="sp-row-time">
                              {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                        </div>
                        {/* v2.12.0: 直达卡片浏览页（不触发复制/长按） */}
                        <button
                          className="sp-open"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/entry/${entry.id}`);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onMouseUp={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                          title="浏览卡片"
                          aria-label="浏览卡片"
                        >
                          <ChevronRightIcon />
                        </button>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : hasAnyCondition ? (
            <div className="s-empty">
              <b>{keyword ? `没找到「${keyword}」` : '这些条件下一片空白'}</b>
              <span>换个词，或者把筛选放宽一点。</span>
            </div>
          ) : (
            <div className="sp-hint">
              <b>搜记忆正文，也可以搜标签</b>
              <span>点一条结果，内容就复制了；长按有更多动作。</span>
            </div>
          )}
        </div>
      </div>

      {/* 轻提示 */}
      {toastMsg && (
        <div className="sp-toast">
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
        <div className="sp-dialog-overlay" onClick={() => setShowSaveSmartTag(false)}>
          <div className="sp-dialog" onClick={e => e.stopPropagation()}>
            <h3>存为智能标签</h3>
            <p>当前的搜索条件会变成一个标签，以后点一下就回到这里。</p>
            <input
              type="text"
              className="sp-dialog-input"
              placeholder="给它起个名字"
              value={smartTagName}
              onChange={e => setSmartTagName(e.target.value)}
              autoFocus
            />
            <div className="sp-dialog-actions">
              <button className="sp-dialog-btn" onClick={() => setShowSaveSmartTag(false)}>取消</button>
              <button
                className="sp-dialog-btn sp-dialog-btn--primary"
                onClick={handleSaveSmartTag}
                disabled={!smartTagName.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
