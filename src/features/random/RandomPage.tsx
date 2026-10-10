/**
 * 随机浏览页面
 * 卡片堆叠流式排列，自动填屏 + 分页刷新
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { getDatabase } from '@/services/database';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { resolveTimeRange, timeRangeLabel } from '@/utils/timeRangeFilter';
import { sanitizeEntryFilter } from '@/utils/entryFilterState';
import type { EntryFilterState } from '@/utils/entryFilterState';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from './QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import { EntryFilterPanel } from '@/components/EntryFilterPanel/EntryFilterPanel';
import { ImageViewer } from '@/components/ImageViewer';
import { readThumbAsSrc } from '@/services/attachmentService';
import { hasLocalOriginal, addMissingOriginal } from '@/services/syncService';
import type { Entry } from '@/types';
import './RandomPage.css';

/** 卡片间距 (px) */
const CARD_GAP = 12;

/** 计算折叠文本：截取到第 limit 字所在行的行尾，避免半截行 */
function getCollapsedText(content: string, limit: number): string {
  const nl = content.indexOf('\n', limit);
  if (nl !== -1) return content.slice(0, nl);
  return content.slice(0, limit) + '…';
}

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const FunnelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <path d="m3 3 9 9-3 3 9 9"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
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

const InboxIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const PaperclipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

/** v2.12.0: 浏览卡片入口右箭头 */
const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function RandomPage() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const toggleStar = useEntryStore(state => state.toggleStar);
  const tags = useTagStore(state => state.tags);
  const settings = useSettingsStore(state => state.settings);
  const cardsPerPage = settings.random?.cardsPerPage ?? 7;
  const attachmentMode = settings.random?.attachmentDisplayMode ?? 'inline';
  const collapseLen = settings.random?.contentCollapseLength ?? 300;

  // 当前展示的一批条目
  const [currentEntries, setCurrentEntries] = useState<Entry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // 已展开全文的卡片 id 集合（长文本折叠）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 卡片堆叠滚动容器（刷新后回顶部）
  const cardsStackRef = useRef<HTMLDivElement>(null);
  // 上次抽取的 id 列表，用于避免连续两屏重复
  const lastIdsRef = useRef<Set<string>>(new Set());

  // v2.12.0: 「直达卡片」——通知点击 / 外部跳转（?focus=<id>）时置顶并短暂高亮
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const [focusHighlightId, setFocusHighlightId] = useState<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // a: 快照持久化 — 保存最近一次刷新的 entry id 列表到 localStorage
  const SNAPSHOT_KEY = '__yiyan_random_snapshot_ids__';
  const SNAPSHOT_ENTRIES_KEY = '__yiyan_random_snapshot_entries__';

  // 从快照恢复
  const restoreSnapshot = useCallback((): Entry[] | null => {
    try {
      const idsJson = localStorage.getItem(SNAPSHOT_KEY);
      const entriesJson = localStorage.getItem(SNAPSHOT_ENTRIES_KEY);
      if (idsJson && entriesJson) {
        const savedEntries: Entry[] = JSON.parse(entriesJson);
        if (Array.isArray(savedEntries) && savedEntries.length > 0) {
          const ids: string[] = JSON.parse(idsJson);
          lastIdsRef.current = new Set(ids);
          return savedEntries;
        }
      }
    } catch { /* ignore */ }
    return null;
  }, []);

  // 保存快照
  const saveSnapshot = useCallback((entriesToSave: Entry[]) => {
    try {
      const ids = entriesToSave.map(e => e.id);
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(ids));
      localStorage.setItem(SNAPSHOT_ENTRIES_KEY, JSON.stringify(entriesToSave));
    } catch { /* ignore */ }
  }, []);

  // 每条 entry 的缩略图 src 数组（与 entry.attachments 顺序一致）
  const [thumbSrcsByEntry, setThumbSrcsByEntry] = useState<Record<string, string[]>>({});
  // 图片查看器状态
  const [viewerState, setViewerState] = useState<{ images: string[]; startIndex: number } | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const [menuEntry, setMenuEntry] = useState<Entry | null>(null);
  // v2.6.3: 轻提示（如「已加入预备」），由 QuickMenu 通过 onToast 触发
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const showToastMessage = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1800);
  }, []);
  const [showFilter, setShowFilter] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSelectorEntry, setTagSelectorEntry] = useState<Entry | null>(null);
  // 快捷菜单的「就此内容谈话」直接跳转 /chat，不再内嵌 AI 面板

  // 每张卡片的长按计时器
  const longPressTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** 长按起点坐标 —— 用来判断手指是否在滑动（即用户其实想滚动列表） */
  const pressStartPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [pressedId, setPressedId] = useState<string | null>(null);

  // 筛选条件（持久化：切到其他页面再回来不丢失，存 localStorage）
  const FILTER_STORAGE_KEY = 'yiyan_random_filter_v1';
  const loadPersistedFilter = (): EntryFilterState => {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return sanitizeEntryFilter(null);
      return sanitizeEntryFilter(JSON.parse(raw));
    } catch {
      return sanitizeEntryFilter(null);
    }
  };
  const [filter, setFilter] = useState<EntryFilterState>(() => loadPersistedFilter());
  const persistFilter = useCallback((next: EntryFilterState) => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ ...next, starred: next.starred ?? null }));
    } catch { /* 忽略存储失败 */ }
  }, []);

  // 抽取一批随机条目
  const getRandomEntries = useCallback(() => {
    const filtered = filterEntries(entries, {
      tagIds: filter.tagIds.length > 0 ? filter.tagIds : undefined,
      isStarred: filter.starred,
      ...resolveTimeRange(filter.timeRange),
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setIsLoading(false);
      return;
    }

    // 排除上一屏出现过的条目（如果过滤后仍足够多）
    const lastIds = lastIdsRef.current;
    let candidates = filtered;
    if (filtered.length > lastIds.size + cardsPerPage) {
      candidates = filtered.filter(e => !lastIds.has(e.id));
    }

    // Fisher-Yates 部分洗牌：只洗前 cardsPerPage 个位置
    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(cardsPerPage, candidates.length);

    for (let i = 0; i < pickCount; i++) {
      const remaining = candidates.filter(e => !usedIds.has(e.id));
      if (remaining.length === 0) break;
      const selected = weightedRandomSelect(remaining);
      if (!selected) break;
      result.push(selected);
      usedIds.add(selected.id);
    }

    // 如果排除后不够，从全量里补
    if (result.length < cardsPerPage && filtered.length > result.length) {
      for (let i = result.length; i < Math.min(cardsPerPage, filtered.length); i++) {
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
    setExpandedIds(new Set());
    // a: 保存快照
    saveSnapshot(result);
    setIsLoading(false);
  }, [entries, filter, cardsPerPage, saveSnapshot]);

  // 初始加载 — a: 优先从快照恢复，避免重新进入页面时内容变换
  useEffect(() => {
    if (entries.length > 0) {
      const restored = restoreSnapshot();
      if (restored && restored.length > 0) {
        // 快照恢复成功，但仍需检查这些条目是否还存在
        const existingIds = new Set(entries.map(e => e.id));
        const stillValid = restored.filter(e => existingIds.has(e.id));
        if (stillValid.length === restored.length) {
          setCurrentEntries(restored);
          setIsLoading(false);
          return;
        }
      }
      // 快照不存在或有部分失效，重新抽取
      getRandomEntries();
    } else {
      setIsLoading(false);
    }
  }, [entries, getRandomEntries, restoreSnapshot]);

  // v2.12.0: ?focus=<id> 直达——把目标卡片置顶并短暂高亮（记忆来信通知的落点）
  // 执行顺序说明：本 effect 声明在「初始加载」之后，同一次提交中先恢复快照、再插入目标卡，
  // 函数式 setState 保证基于前一步结果。卡片已被删除时静默兜底为正常随机展示。
  // 刻意不做「每实例一次」拦截：hash 变化不重挂载组件，同一会话内多次点通知都必须生效；
  // 置顶（去重前插）/清理参数本身幂等，重复执行无副作用。
  useEffect(() => {
    if (!focusId) return;
    if (entries.length === 0) return; // 等数据就绪再消费
    const target = entries.find(e => e.id === focusId);
    // 无论是否找到都清除参数（replace，防刷新重复触发）
    setSearchParams({}, { replace: true });
    if (!target) return;

    setCurrentEntries(prev => {
      const rest = prev.filter(e => e.id !== target.id);
      return [target, ...rest];
    });
    setFocusHighlightId(target.id);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusHighlightId(null), 2600);
    cardsStackRef.current?.scrollTo?.({ top: 0 });
  }, [focusId, entries, setSearchParams]);

  // 加载当前批次的缩略图
  useEffect(() => {
    let cancelled = false;
    const loadThumbs = async () => {
      const entriesWithAtts = currentEntries.filter(
        e => e.attachments && e.attachments.length > 0
      );
      if (entriesWithAtts.length === 0) {
        setThumbSrcsByEntry({});
        return;
      }
      const map: Record<string, string[]> = {};
      await Promise.all(entriesWithAtts.map(async (entry) => {
        const srcs = await Promise.all(
          (entry.attachments || []).map(a => readThumbAsSrc(a.thumbPath))
        );
        if (!cancelled) map[entry.id] = srcs.filter(Boolean);
      }));
      if (!cancelled) setThumbSrcsByEntry(map);
    };
    loadThumbs();
    return () => { cancelled = true; };
  }, [currentEntries]);

  // 打开图片查看器
  const openViewer = useCallback((entryId: string, startIndex: number) => {
    const images = thumbSrcsByEntry[entryId] || [];
    if (images.length === 0) return;
    setViewerState({ images, startIndex });

    // 点开大图时，检查本地是否有原图；缺失的加入待拉取队列
    // 队列会在下次同步连接到任意有原图的设备时批量拉取（省电，不时刻保持连接）
    const entry = currentEntries.find(e => e.id === entryId);
    if (entry?.attachments) {
      // 不阻塞 UI，异步检查
      Promise.all(
        entry.attachments.map(async (att) => {
          const has = await hasLocalOriginal(att.filePath);
          if (!has) addMissingOriginal(att.id, att.filePath);
        })
      ).catch(() => { /* ignore */ });
    }
  }, [thumbSrcsByEntry, currentEntries]);

  // 阻止冒泡（避免触发卡片复制/长按）
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  // 复制内容
  const handleCopy = useCallback(async (entry: Entry) => {
    // === 修复 2：记录复制时间戳到全局 ===
    const COPY_KEY = '__yiyan_last_copy_at__';
    const copyMap: Record<string, number> = (window as any)[COPY_KEY] || {};
    copyMap[entry.id] = Date.now();
    (window as any)[COPY_KEY] = copyMap;

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

  const addTodo = useTodoStore(state => state.addTodo);

  // 转为待办
  const handleConvertToTodo = useCallback(async (e: Entry) => {
    const today = new Date();
    const folderDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await addTodo({
      title: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
      folderDate,
      isToday: true,
    });
  }, [addTodo]);

  /**
   * 手指在卡片上移动超过这么多像素，就判定为「用户其实在滚动」而不是长按。
   * 修复：以前卡片只绑了 touchStart / touchEnd —— 滚动时手指始终没离开卡片，
   * touchend 不触发，500ms 的计时器照常走完，于是「滚动」被误判成「长按」弹出悬浮菜单。
   */
  const LONG_PRESS_MOVE_TOLERANCE = 8;

  // 长按开始
  const handlePressStart = useCallback((entryId: string, clientX?: number, clientY?: number) => {
    setPressedId(entryId);
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      pressStartPosRef.current.set(entryId, { x: clientX, y: clientY });
    }
    const timer = setTimeout(() => {
      const entry = currentEntries.find(e => e.id === entryId);
      if (entry) {
        // === 修复 2：记录长按菜单时间戳到全局 ===
        const MENU_KEY = '__yiyan_last_menu_at__';
        const menuMap: Record<string, number> = (window as any)[MENU_KEY] || {};
        menuMap[entryId] = Date.now();
        (window as any)[MENU_KEY] = menuMap;

        setMenuEntry(entry);
        setShowMenu(true);
      }
      setPressedId(null);
      pressStartPosRef.current.delete(entryId);
    }, 500);
    longPressTimersRef.current.set(entryId, timer);
  }, [currentEntries]);

  // 长按结束
  const handlePressEnd = useCallback((entryId: string) => {
    setPressedId(null);
    pressStartPosRef.current.delete(entryId);
    const timer = longPressTimersRef.current.get(entryId);
    if (timer) {
      clearTimeout(timer);
      longPressTimersRef.current.delete(entryId);
    }
  }, []);

  /** 手指移动：超过容差就取消长按（滚动优先于长按） */
  const handlePressMove = useCallback((entryId: string, clientX: number, clientY: number) => {
    const start = pressStartPosRef.current.get(entryId);
    if (!start) return;
    if (Math.hypot(clientX - start.x, clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE) {
      handlePressEnd(entryId);
    }
  }, [handlePressEnd]);

  /**
   * 兜底：只要发生滚动，就立刻取消所有长按计时器。
   * touchmove 在滚动过程中可能被浏览器「吃掉」（passive listener / touch-action），
   * 所以在捕获阶段再监听一次 scroll，双保险。
   */
  useEffect(() => {
    const cancelAll = () => {
      if (longPressTimersRef.current.size === 0) return;
      longPressTimersRef.current.forEach(timer => clearTimeout(timer));
      longPressTimersRef.current.clear();
      pressStartPosRef.current.clear();
      setPressedId(null);
    };
    window.addEventListener('scroll', cancelAll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', cancelAll, true);
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

  // 切换长文本展开/收起
  const handleToggleExpand = useCallback((entryId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  // 下一屏（重新随机抽取，并回到顶部）
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    getRandomEntries();
    // 内部滚动容器 + 页面级滚动双重复位，确保任何一层滚动了都能回到顶部
    cardsStackRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [getRandomEntries]);

  // 应用筛选并重新抽卡（不关面板 —— 供筛选面板内连续操作用：选标签/反选/时间即时生效）
  const applyFilter = useCallback((next: EntryFilterState) => {
    setFilter(next);
    persistFilter(next);
    lastIdsRef.current = new Set();
    setIsLoading(true);

    // 重新获取随机条目
    const filtered = filterEntries(entries, {
      tagIds: next.tagIds.length > 0 ? next.tagIds : undefined,
      isStarred: next.starred,
      ...resolveTimeRange(next.timeRange),
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setIsLoading(false);
      return;
    }

    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(cardsPerPage, filtered.length);

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
    setExpandedIds(new Set());
    cardsStackRef.current?.scrollTo({ top: 0 });
    // a: 保存快照
    saveSnapshot(result);
    setIsLoading(false);
  }, [entries, cardsPerPage, saveSnapshot, persistFilter]);

  // 清除单个筛选条件（徽章上的 × ；不关面板）
  const clearStarred = useCallback(() => {
    applyFilter({ ...filter, starred: undefined });
  }, [applyFilter, filter]);

  const clearTimeRange = useCallback(() => {
    applyFilter({ ...filter, timeRange: {} });
  }, [applyFilter, filter]);

  const removeTag = useCallback((tagId: string) => {
    applyFilter({ ...filter, tagIds: filter.tagIds.filter(id => id !== tagId) });
  }, [applyFilter, filter]);

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

  return (
    <div className="random-page">
      {/* 筛选按钮 - 右上角浮动 */}
      <button className="filter-btn" onClick={() => setShowFilter(true)}>
        <FunnelIcon />
      </button>

      {/* 筛选标签显示 */}
      {(filter.tagIds.length > 0 || filter.starred !== undefined || filter.timeRange.preset) && (
        <div className="active-filters">
          {filter.starred !== undefined && (
            <span className="filter-badge">
              {filter.starred ? <><StarFilledIcon /> 已星标</> : <><StarOutlineIcon /> 未星标</>}
              <button onClick={clearStarred}><CloseIcon /></button>
            </span>
          )}
          {filter.timeRange.preset && (
            <span className="filter-badge">
              {timeRangeLabel(filter.timeRange)}
              <button onClick={clearTimeRange}><CloseIcon /></button>
            </span>
          )}
          {filter.tagIds.map(tagId => {
            const tag = tags.find(t => t.id === tagId);
            return tag ? (
              <span key={tagId} className="filter-badge">
                #{tag.name}
                <button onClick={() => removeTag(tagId)}><CloseIcon /></button>
              </span>
            ) : null;
          })}
        </div>
      )}

      <main className="page-content">
        {currentEntries.length > 0 ? (
          <>
            <div className="cards-stack" ref={cardsStackRef}>
              {currentEntries.map((entry) => {
                const needsCollapse = collapseLen > 0 && entry.content.length > collapseLen;
                const isExpanded = expandedIds.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    className={`card-item ${pressedId === entry.id ? 'pressed' : ''} ${focusHighlightId === entry.id ? 'focus-highlight' : ''}`}
                    onClick={() => handleCopy(entry)}
                    onMouseDown={(e) => handlePressStart(entry.id, e.clientX, e.clientY)}
                    onMouseUp={() => handlePressEnd(entry.id)}
                    onMouseLeave={() => handlePressEnd(entry.id)}
                    onTouchStart={(e) => handlePressStart(entry.id, e.touches[0]?.clientX, e.touches[0]?.clientY)}
                    onTouchMove={(e) => {
                      const t = e.touches[0];
                      if (t) handlePressMove(entry.id, t.clientX, t.clientY);
                    }}
                    onTouchEnd={() => handlePressEnd(entry.id)}
                    onTouchCancel={() => handlePressEnd(entry.id)}
                  >
                    <div className="entry-card glass">
                      <div className="card-content">
                        {needsCollapse && !isExpanded
                          ? getCollapsedText(entry.content, collapseLen)
                          : entry.content}
                      </div>

                      {/* 长文本折叠：展开/收起 */}
                      {needsCollapse && (
                        <button
                          className="card-expand-btn"
                          onClick={(e) => { e.stopPropagation(); handleToggleExpand(entry.id); }}
                          onMouseDown={stopPropagation}
                          onMouseUp={stopPropagation}
                          onTouchStart={stopPropagation}
                          onTouchEnd={stopPropagation}
                        >
                          {isExpanded ? '收起' : '展开'}
                        </button>
                      )}

                      {/* 图片附件展示 - inline 模式：纵向堆叠在文本下方 */}
                      {attachmentMode === 'inline'
                        && entry.attachments
                        && entry.attachments.length > 0
                        && (thumbSrcsByEntry[entry.id] || []).length > 0 && (
                        <div
                          className="card-attachments"
                          onClick={stopPropagation}
                          onMouseDown={stopPropagation}
                          onMouseUp={stopPropagation}
                          onTouchStart={stopPropagation}
                          onTouchEnd={stopPropagation}
                        >
                          {thumbSrcsByEntry[entry.id].map((src, idx) => (
                            <img
                              key={idx}
                              src={src}
                              alt={`附件 ${idx + 1}`}
                              className="card-attachment-img"
                              loading="lazy"
                              onClick={() => openViewer(entry.id, idx)}
                            />
                          ))}
                        </div>
                      )}

                      <div className="card-meta">
                        {entry.isStarred && (
                          <span className="meta-star"><StarFilledIcon /></span>
                        )}
                        {entry.tags && entry.tags.length > 0 && (
                          <div className="meta-tags">
                            {entry.tags.map(tag => (
                              <span key={tag.id} className="meta-tag">#{tag.name}</span>
                            ))}
                          </div>
                        )}
                        {/* 图片附件展示 - badge 模式：仅显示附件数量徽标 */}
                        {attachmentMode === 'badge'
                          && entry.attachments
                          && entry.attachments.length > 0 && (
                          <span
                            className="meta-attachment-badge"
                            onClick={(e) => {
                              e.stopPropagation();
                              openViewer(entry.id, 0);
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                          >
                            <PaperclipIcon /> ×{entry.attachments.length}
                          </span>
                        )}
                        <span className="meta-time">
                          {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                        {/* v2.12.0: 直达卡片浏览页（不触发卡片复制/长按） */}
                        <button
                          className="card-view-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/entry/${entry.id}`);
                          }}
                          onMouseDown={stopPropagation}
                          onMouseUp={stopPropagation}
                          onTouchStart={stopPropagation}
                          onTouchEnd={stopPropagation}
                          title="浏览卡片"
                          aria-label="浏览卡片"
                        >
                          <ChevronRightIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card-actions">
              <button className="nav-btn glass" onClick={handleRefresh}>
                <RefreshIcon />
                <span>刷新下一屏</span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><InboxIcon /></span>
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
          onAIChat={(entryId) => {
            // b.6: QuickMenu 内部直接 navigate 到 /chat，这里不需要做任何事
            setShowMenu(false);
          }}
          onConvertToTodo={handleConvertToTodo}
          onEditInfo={(entry) => {
            setShowMenu(false);
            navigate(`/entry/${entry.id}/edit`);
          }}
          onToast={showToastMessage}
        />
      )}

      {/* 筛选面板（共享组件 EntryFilterPanel，v2.14.0） */}
      {showFilter && (
        <EntryFilterPanel
          value={filter}
          onChange={applyFilter}
          onClose={() => setShowFilter(false)}
        />
      )}

      {/* 标签选择器 — b.1: 与录入界面一致的样式和功能 */}
      {showTagSelector && tagSelectorEntry && (
        <div className="home-tag-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="home-tag-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={tagSelectorEntry.tags?.map(t => t.id) || []}
              onSelectionChange={async (tagIds) => {
                // 保存标签变更到数据库
                try {
                  const db = await getDatabase();
                  // 逐一更新标签关联
                  const currentTags = tagSelectorEntry.tags?.map(t => t.id) || [];
                  const toAdd = tagIds.filter(id => !currentTags.includes(id));
                  const toRemove = currentTags.filter(id => !tagIds.includes(id));
                  for (const tagId of toAdd) {
                    await db.addTagToEntry(tagSelectorEntry.id, tagId);
                  }
                  for (const tagId of toRemove) {
                    await db.removeTagFromEntry(tagSelectorEntry.id, tagId);
                  }
                  // 更新本地状态
                  const updatedEntry = { ...tagSelectorEntry, tags: tagIds.map(id => tags.find(t => t.id === id)).filter(Boolean) as any };
                  setTagSelectorEntry(updatedEntry);
                  setCurrentEntries(prev => prev.map(e => e.id === updatedEntry.id ? updatedEntry : e));
                } catch (err) {
                  console.error('保存标签失败:', err);
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

      {/* 图片查看器 */}
      {viewerState && (
        <ImageViewer
          images={viewerState.images}
          startIndex={viewerState.startIndex}
          onClose={() => setViewerState(null)}
        />
      )}

      {/* 轻提示（v2.6.3） */}
      {toastMsg && (
        <div className="toast glass">
          <span>{toastMsg}</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
