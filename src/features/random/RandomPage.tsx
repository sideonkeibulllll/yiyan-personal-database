/**
 * 随机浏览页面
 *
 * 结构：一叠牌。
 * 视口里只摊开一张主卡，主卡下沿露出下一两张卡的薄边；
 * 抽卡时主卡向上飞出，下一张从牌堆里顶上来。
 * 筛选从右上角一颗圆钮进入底部抽屉（EntryFilterPanel）。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { getDatabase } from '@/services/database';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { resolveTimeRange } from '@/utils/timeRangeFilter';
import { sanitizeEntryFilter } from '@/utils/entryFilterState';
import type { EntryFilterState } from '@/utils/entryFilterState';
import { QuickMenu } from './QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import { EntryFilterPanel } from '@/components/EntryFilterPanel/EntryFilterPanel';
import { ImageViewer } from '@/components/ImageViewer';
import { readThumbAsSrc } from '@/services/attachmentService';
import { hasLocalOriginal, addMissingOriginal } from '@/services/syncService';
import type { Entry } from '@/types';
import './RandomPage.css';

/** 计算折叠文本：截取到第 limit 字所在行的行尾，避免半截行 */
function getCollapsedText(content: string, limit: number): string {
  const nl = content.indexOf('\n', limit);
  if (nl !== -1) return content.slice(0, nl);
  return content.slice(0, limit) + '…';
}

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const FunnelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5h16l-6.4 7.6V19l-3.2 1.6v-8L4 5Z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
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
  // 卡片堆叠定位锚点（刷新后复位）
  const cardsStackRef = useRef<HTMLDivElement>(null);
  // 上次抽取的 id 列表，用于避免连续两屏重复
  const lastIdsRef = useRef<Set<string>>(new Set());

  // 牌堆：当前摊开的是第几张（0 起），以及「正在飞出去」的中间态
  const [cardIndex, setCardIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const drawTimerRef = useRef<ReturnType<typeof setTimeout>>();

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
    // 内部锚点 + 页面级滚动双重复位，确保任何一层滚动了都能回到顶部
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

  // v3.5.0: 当前是否处于筛选状态（右上角筛选按钮标橙提示；v3.5.0 起不再显示上方标签块）
  const hasActiveFilter = filter.tagIds.length > 0 || filter.starred !== undefined || !!filter.timeRange.preset;

  // 清理长按计时器
  useEffect(() => {
    return () => {
      longPressTimersRef.current.forEach(timer => clearTimeout(timer));
      longPressTimersRef.current.clear();
    };
  }, []);

  // 清理抽卡计时器
  useEffect(() => {
    return () => {
      if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
    };
  }, []);

  // 牌堆换了一批（刷新 / 筛选 / 直达）→ 重新从第一张摊开。
  // 只认 id 顺序：星标、编辑这类「同批内容变了」的更新不该让牌跳回第一张。
  const deckKey = currentEntries.map(e => e.id).join('|');
  useEffect(() => {
    if (drawTimerRef.current) {
      clearTimeout(drawTimerRef.current);
      drawTimerRef.current = undefined;
    }
    setCardIndex(0);
    setLeaving(false);
  }, [deckKey]);

  // 安全下标：批次被替换时可能短暂越界
  const safeIndex = currentEntries.length > 0
    ? Math.min(cardIndex, currentEntries.length - 1)
    : 0;
  const currentEntry = currentEntries[safeIndex];
  const remainingCards = Math.max(0, currentEntries.length - safeIndex - 1);

  // 抽下一张：主卡飞出去，260ms 后下一张顶上来；最后一张抽完就换一批
  const handleDraw = useCallback(() => {
    if (drawTimerRef.current) return;
    if (currentEntries.length === 0) return;
    const isLast = safeIndex + 1 >= currentEntries.length;
    setLeaving(true);
    drawTimerRef.current = setTimeout(() => {
      drawTimerRef.current = undefined;
      setLeaving(false);
      if (isLast) {
        setCardIndex(0);
        handleRefresh();
      } else {
        setCardIndex(safeIndex + 1);
      }
    }, 260);
  }, [safeIndex, currentEntries.length, handleRefresh]);

  if (isLoading) {
    return (
      <div className="rp-page">
        <div className="rp-loading">
          <div className="rp-spinner" />
        </div>
      </div>
    );
  }

  // 卡面右上角的小记号：只用一个点 + 一个词说清「这张是什么」
  const markLabel = currentEntry
    ? (currentEntry.isStarred
      ? '星标'
      : currentEntry.tags && currentEntry.tags.length > 0
        ? `#${currentEntry.tags[0].name}`
        : currentEntry.attachments && currentEntry.attachments.length > 0
          ? `${currentEntry.attachments.length} 张图`
          : '记忆')
    : '';

  return (
    <div className="rp-page">
      {/* 页头：这叠牌的身份 + 唯一一颗筛选钮 */}
      <header className="rp-mast">
        <div className="rp-mast-id">
          <span className="rp-mast-eyebrow">随机抽取</span>
          <span className="rp-mast-sub">
            {currentEntries.length > 0
              ? `抽屉里 ${currentEntries.length} 张`
              : '抽屉'}
          </span>
        </div>
        <button
          className={`rp-filter ${hasActiveFilter ? 'on' : ''}`}
          onClick={() => setShowFilter(true)}
          aria-label="筛选牌堆"
          title="筛选"
        >
          <FunnelIcon />
          {hasActiveFilter && <i className="rp-filter-mark" />}
        </button>
      </header>

      <main className="rp-stage">
        {currentEntry ? (
          <div className="rp-deck cards-stack" ref={cardsStackRef} data-no-swipe>
            {/* 牌堆下沿：还剩下的牌露出的薄边 */}
            {remainingCards > 1 && <div className="rp-under rp-under-2" aria-hidden />}
            {remainingCards > 0 && <div className="rp-under rp-under-1" aria-hidden />}

            {(() => {
              const entry = currentEntry;
              const needsCollapse = collapseLen > 0 && entry.content.length > collapseLen;
              const isExpanded = expandedIds.has(entry.id);
              const isClamped = needsCollapse && !isExpanded;
              const thumbs = thumbSrcsByEntry[entry.id] || [];
              return (
                <div
                  key={entry.id}
                  className={[
                    'rp-card',
                    leaving ? 'is-leaving' : '',
                    pressedId === entry.id ? 'is-pressed' : '',
                    focusHighlightId === entry.id ? 'is-focus' : '',
                    isClamped ? 'is-clamped' : '',
                    isExpanded ? 'is-expanded' : '',
                  ].filter(Boolean).join(' ')}
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
                  {/* 右上角小记号：6px 点 + 一句小字 */}
                  <div className="rp-card-mark">
                    <span className="rp-mark">
                      <i className={entry.isStarred ? 'is-accent' : ''} />
                      {markLabel}
                    </span>
                  </div>

                  {/* 正文：最多 8 行，超出从底部淡出 */}
                  <div className="rp-card-body">
                    <div className="rp-text">
                      {isClamped ? getCollapsedText(entry.content, collapseLen) : entry.content}
                    </div>

                    {/* 图片附件展示 - inline 模式：纵向堆叠在文本下方 */}
                    {attachmentMode === 'inline' && thumbs.length > 0 && (
                      <div
                        className="rp-attachments"
                        onClick={stopPropagation}
                        onMouseDown={stopPropagation}
                        onMouseUp={stopPropagation}
                        onTouchStart={stopPropagation}
                        onTouchEnd={stopPropagation}
                      >
                        {thumbs.map((src, idx) => (
                          <img
                            key={idx}
                            src={src}
                            alt={`附件 ${idx + 1}`}
                            className="rp-attachment"
                            loading="lazy"
                            onClick={() => openViewer(entry.id, idx)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 卡脚：左边时间，中间标签/附件，右边浏览入口 */}
                  <div className="rp-card-foot">
                    <span className="rp-time">
                      {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                    </span>

                    {entry.tags && entry.tags.length > 0 && (
                      <span className="rp-foot-tags">
                        {entry.tags.slice(0, 2).map(tag => (
                          <span key={tag.id} className="rp-foot-tag">#{tag.name}</span>
                        ))}
                        {entry.tags.length > 2 && (
                          <span className="rp-foot-tag rp-foot-tag--more">+{entry.tags.length - 2}</span>
                        )}
                      </span>
                    )}

                    {/* 图片附件展示 - badge 模式：仅显示附件数量徽标 */}
                    {attachmentMode === 'badge'
                      && entry.attachments
                      && entry.attachments.length > 0 && (
                      <span
                        className="rp-foot-badge"
                        onClick={(e) => {
                          e.stopPropagation();
                          openViewer(entry.id, 0);
                        }}
                        onTouchStart={(e) => e.stopPropagation()}
                      >
                        <PaperclipIcon /> ×{entry.attachments.length}
                      </span>
                    )}

                    {needsCollapse && (
                      <button
                        className="rp-expand"
                        onClick={(e) => { e.stopPropagation(); handleToggleExpand(entry.id); }}
                        onMouseDown={stopPropagation}
                        onMouseUp={stopPropagation}
                        onTouchStart={stopPropagation}
                        onTouchEnd={stopPropagation}
                      >
                        {isExpanded ? '收起' : '展开'}
                      </button>
                    )}

                    {/* v2.12.0: 直达卡片浏览页（不触发卡片复制/长按） */}
                    <button
                      className="rp-open"
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
              );
            })()}
          </div>
        ) : (
          <div className="s-empty">
            <b>抽屉里还没有牌</b>
            <span>
              {hasActiveFilter
                ? '当前筛选下没有可抽的记忆，放宽一点再看看。'
                : '写下第一条记忆，它就会出现在这叠牌里。'}
            </span>
            <div className="rp-empty-actions">
              {hasActiveFilter && (
                <button className="rp-ghost" onClick={() => setShowFilter(true)}>改筛选</button>
              )}
              <button className="rp-cta" onClick={() => navigate('/')}>去写一条</button>
            </div>
          </div>
        )}
      </main>

      {/* 拇指区：左边抽卡，右边第几张 */}
      {currentEntries.length > 0 && (
        <div className="rp-dock">
          <button className="rp-draw" onClick={handleDraw} aria-label="抽下一张">
            <RefreshIcon />
            <span>抽下一张</span>
          </button>
          <span className="rp-dock-count">
            第 {safeIndex + 1} / 共 {currentEntries.length} 张
          </span>
        </div>
      )}

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
        <div className="rp-toast">
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}
