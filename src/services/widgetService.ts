/**
 * 桌面橱窗 · 服务门面（v2.13.2）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  对外契约（所有外部引用必须从本文件走，禁止绕过门面直连插件或内部函数）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 被引用的位置与用途：
 *  - App.tsx      → syncAll() / initTodoAutoSync()
 *                   启动后台同步 + 注册「待办变动即时同步」订阅
 *  - WidgetPanel  → getWidgetStatus() / syncAll(true) / refreshWidgetViews()
 *
 * 两类橱窗数据（均写入原生 SharedPreferences，由 Provider 渲染）：
 *  - 记忆卡片计划（v2.16.0：今天 10 条候选）：setPlan / getPlan（今天已排则跳过重排）
 *  - 待办快照（三视图：today / timed / untimed，各 1 大 + 5 小）：setTodo / getTodo
 *    v2.13.2：三视图预生成 + 待办变动防抖 2.5s 即时推送（切后台立即 flush）
 *
 * 模块边界：
 *  - 依赖：registerPlugin('YiyanWidget')、entryStore、database、
 *          utils/widgetPlan、utils/exposurePool、utils/notifyPlan（标题口径）
 *  - 原生实现：android/app/src/main/java/com/yiyan/memorydb/widget/WidgetBridgePlugin.kt
 *    （JSON 结构与键名与其对齐；改结构必须两边同步）
 *
 * 数据流：
 *  打开 App → 生成「今天」的 10 条展示计划（加权选卡 + 曝光去重）
 *  → YiyanWidget.setPlan() 写入 SharedPreferences
 *  → 原生 Provider 渲染今日候选（点「换一张」在 10 条里循环，不依赖 App 常驻）
 *  → 点击走 deep link（com.yiyan.memorydb://entry/<id>）打开卡片浏览页
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEntryStore } from '@/stores/entryStore';
import { useTodoStore } from '@/stores/todoStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { resolveTimeRange } from '@/utils/timeRangeFilter';
import { isFilterActive } from '@/utils/entryFilterState';
import { makeReunionTitle, toDayKey } from '@/utils/notifyPlan';
import { getSortOrder } from '@/utils/todoSortOrder';
import {
  WIDGET_PLAN_COUNT,
  assemblePlan,
  assembleTodoSnapshot,
  isValidPlan,
  isValidTodoSnapshot,
  makeTodoNote,
  makeWidgetBody,
  orderTimedForWidget,
  orderTodosForWidget,
  orderUntimedForWidget,
  shouldResync,
  startOfDayTs,
  toTimeText,
  toTimedRangeText,
} from '@/utils/widgetPlan';
import type { TodoSnapshot, WidgetPlan, WidgetPlanItem } from '@/utils/widgetPlan';
import { appendExposure, recentlyExposedIds } from '@/utils/exposurePool';
import type { ExposureItem } from '@/utils/exposurePool';
import type { Entry, Todo } from '@/types';

/* ═══════════════ 原生桥（与 WidgetBridgePlugin.kt 对齐） ═══════════════ */

interface YiyanWidgetPlugin {
  /** 写入展示计划（JSON 字符串），触发全部橱窗刷新 + 展示游标复位 */
  setPlan(options: { plan: string }): Promise<void>;
  /** 读取当前计划（无则 plan 为 null） */
  getPlan(): Promise<{ plan: string | null }>;
  /** 写入待办快照（JSON 字符串），触发待办橱窗刷新 */
  setTodo(options: { snapshot: string }): Promise<void>;
  /** 读取待办快照（无则 snapshot 为 null） */
  getTodo(): Promise<{ snapshot: string | null }>;
  /** 查询桌面上的橱窗实例数量 */
  getStatus(): Promise<{ baseCount: number; refreshCount: number; todoCount: number }>;
  /**
   * 写入各组件背景样式（JSON 字符串，键见 WidgetStyleTarget），触发全部橱窗重绘（v2.15.0）。
   * v2.16.0 追加 nikoClock：niko 挂件是否在底层叠一个数字时钟。
   */
  setStyles(options: { styles: string; nikoClock?: boolean }): Promise<void>;
  /** 触发全部橱窗立即重绘（不改数据） */
  refreshAll(): Promise<void>;
}

const YiyanWidget = registerPlugin<YiyanWidgetPlugin>('YiyanWidget');

/* ═══════════════ 对外接口 ═══════════════ */

/** 当前平台是否支持桌面橱窗（仅 Android 原生；Web / Electron 走降级提示） */
export function isWidgetSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/** 一次同步执行的结果报告 */
export interface WidgetSyncReport {
  ok: boolean;
  message: string;
  /** 本次生成的计划条数（跳过时为 0） */
  scheduled: number;
}

/**
 * 同步展示计划（v2.16.0）：生成「今天」的 10 条候选，写入原生。
 *
 * - 每次重排生成 WIDGET_PLAN_COUNT 条，全部今天生效（默认显示第 1 条，「换一张」循环）；
 * - 默认增量：计划是「今天」生成的则跳过（与每日自动备份同口径，每天只排一次）；
 * - force=true（面板「立即同步」）时无条件重排。
 */
export async function syncWidgetPlan(force = false): Promise<WidgetSyncReport> {
  if (!isWidgetSupported()) {
    return { ok: false, message: '桌面橱窗仅在安卓端可用', scheduled: 0 };
  }
  try {
    // 1. 读现有计划 → 判断是否需要重排
    let existing: WidgetPlan | null = null;
    try {
      const res = await YiyanWidget.getPlan();
      if (res?.plan) {
        const parsed = JSON.parse(res.plan);
        if (isValidPlan(parsed)) existing = parsed;
      }
    } catch {
      existing = null;
    }
    const now = Date.now();
    if (!force && !shouldResync(existing, now)) {
      return { ok: true, message: '今日计划已排好', scheduled: 0 };
    }

    // 2. 候选池（store 优先、数据库兜底）+ 筛选 + 曝光去重
    const filteredPool = await loadFilteredPool();
    if (filteredPool === null) {
      return { ok: false, message: '筛选范围内没有卡片，橱窗暂不换卡', scheduled: 0 };
    }
    const entries = filteredPool;
    if (entries.length === 0) {
      return { ok: false, message: '抽屉里还没有卡片，先存一条吧', scheduled: 0 };
    }
    const exposed = recentlyExposedIds(now);
    let pool = entries.filter(e => !exposed.has(e.id));
    if (pool.length === 0) pool = entries;

    // 3. 今天 10 条候选；选卡复用加权随机（本轮不重复，池子不足时循环复用）
    // v3.1.0：at 按每天自动刷新次数均分全天 → 到点原生 baseIndex 自动推进
    const dayStart = startOfDayTs(now);
    const dayMs = 86_400_000;
    const refreshCount = useSettingsStore.getState().settings.widget.dailyAutoRefresh ?? 3;
    const usedThisRun = new Set<string>();
    const pickFor = (): Entry | null => {
      let candidates = pool.filter(e => !usedThisRun.has(e.id));
      if (candidates.length === 0) {
        usedThisRun.clear();
        candidates = pool;
      }
      if (candidates.length === 0) return null;
      const picked = weightedRandomSelect(candidates);
      if (picked) usedThisRun.add(picked.id);
      return picked;
    };

    const items: WidgetPlanItem[] = [];
    for (let i = 0; i < WIDGET_PLAN_COUNT; i++) {
      const picked = pickFor();
      if (!picked) break;
      // 均分全天 N 段，第 i 条落在第 floor(i*N/10) 段的中点时刻
      const slot = Math.floor(i * refreshCount / WIDGET_PLAN_COUNT);
      const fraction = (slot + 0.5) / refreshCount;
      const at = dayStart + Math.floor(fraction * dayMs);
      items.push({
        at,
        entryId: picked.id,
        title: makeReunionTitle(picked.createdAt, dayStart),
        body: makeWidgetBody(picked.content, picked.attachments?.length ?? 0),
      });
    }
    if (items.length === 0) {
      return { ok: false, message: '组装计划失败，请重试', scheduled: 0 };
    }

    // 4. 写原生 + 记共享曝光池
    const plan = assemblePlan(now, items);
    await YiyanWidget.setPlan({ plan: JSON.stringify(plan) });
    const exposure: ExposureItem[] = items.map(it => ({ id: it.entryId, at: it.at, source: 'widget' }));
    appendExposure(exposure);

    return { ok: true, message: `已安排今日 ${items.length} 张橱窗`, scheduled: items.length };
  } catch (e) {
    console.warn('[widget] 同步失败:', e);
    return { ok: false, message: '同步失败，请稍后重试', scheduled: 0 };
  }
}

/**
 * 同步待办快照（v2.13.2：三视图，各 1 大 + 5 小）：
 * - 每次打开 App 都写；App 内待办变动由 initTodoAutoSync 防抖触发（不做余量跳过）
 * - today 视图：今天文件夹 ∪ 「今日处理」；个人拖拽排序优先 → 到期近 → 创建先后
 * - timed 视图：主页 timed 卡口径（进行中 → 未来，见 widgetPlan.orderTimedForWidget）
 * - untimed 视图：主页 untimed 卡口径（无时间、创建最早在前）
 */
export async function syncTodoSnapshot(): Promise<WidgetSyncReport> {
  if (!isWidgetSupported()) {
    return { ok: false, message: '桌面橱窗仅在安卓端可用', scheduled: 0 };
  }
  try {
    const todos = await loadTodoPool();
    const now = Date.now();
    const todayKey = toDayKey(now);

    // 今天视图（个人排序优先，沿用 v2.13.1 口径）
    const todayCand = todos.filter(
      t => t.status === 'pending' && !t.deletedAt && (t.folderDate === todayKey || t.isToday),
    );
    const todayOrdered = orderTodosForWidget(todayCand, getSortOrder(todayKey));
    const todayItems = todayOrdered.map(t => ({
      id: t.id,
      title: t.title,
      note: makeTodoNote(t.note),
      timeText: toTimeText(t.endTime, now),
    }));

    // 有期视图（主页 timed 卡口径，完整列表）
    const timedOrdered = orderTimedForWidget(todos, now);
    const timedItems = timedOrdered.map(t => ({
      id: t.id,
      title: t.title,
      note: makeTodoNote(t.note),
      timeText: toTimedRangeText(t.startTime, t.endTime, now),
    }));

    // 无期视图（主页 untimed 卡口径，完整列表）
    const untimedOrdered = orderUntimedForWidget(todos);
    const untimedItems = untimedOrdered.map(t => ({
      id: t.id,
      title: t.title,
      note: makeTodoNote(t.note),
      timeText: '',
    }));

    const snapshot = assembleTodoSnapshot(todayKey, now, {
      today: { total: todayCand.length, items: todayItems },
      timed: { total: timedOrdered.length, items: timedItems },
      untimed: { total: untimedOrdered.length, items: untimedItems },
    });
    await YiyanWidget.setTodo({ snapshot: JSON.stringify(snapshot) });
    return {
      ok: true,
      message: `待办快照：今天 ${todayCand.length} · 有期 ${timedOrdered.length} · 无期 ${untimedOrdered.length}`,
      scheduled: todayItems.length + timedItems.length + untimedItems.length,
    };
  } catch (e) {
    console.warn('[widget] 待办快照同步失败:', e);
    return { ok: false, message: '待办同步失败', scheduled: 0 };
  }
}

/* ═══════════════ 待办变动即时同步（v2.13.2） ═══════════════ */

/** 防抖延迟（ms）：连续操作合并为一次写入 */
const AUTO_SYNC_DEBOUNCE_MS = 2500;

/** 待办指纹（id/status/标题/备注/时间/日期/标记/删除 全量拼接哈希，顺序无关） */
function todoSignature(todos: Todo[]): string {
  let h = 5381;
  for (const t of todos) {
    const s = `${t.id}|${t.status}|${t.title}|${t.note ?? ''}|${t.startTime ?? ''}|${t.endTime ?? ''}|${t.folderDate ?? ''}|${t.isToday ? 1 : 0}|${t.deletedAt ?? ''}#`;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return `${todos.length}_${h.toString(36)}`;
}

/** 幂等注册标记（App 重复挂载/热更新时防重复订阅） */
let autoSyncInited = false;

/**
 * 待办变动即时同步（v2.13.2）：
 * 订阅 todoStore → 快照相关字段指纹变化 → 防抖 2.5s 推送最新快照到桌面组件；
 * 页面切到后台（visibilitychange → hidden）时若仍有待处理变动则立即 flush，
 * 保证「在 App 里完成/新增待办 → 切回桌面，组件已是最新」。
 * 仅安卓原生端注册（Web / Electron 直接返回）。幂等：重复调用只注册一次。
 */
export function initTodoAutoSync(): void {
  if (autoSyncInited || !isWidgetSupported()) return;
  autoSyncInited = true;

  let lastSig = todoSignature(useTodoStore.getState().todos);
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    void syncTodoSnapshot();
  };

  useTodoStore.subscribe(state => {
    const sig = todoSignature(state.todos);
    if (sig === lastSig) return;
    lastSig = sig;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, AUTO_SYNC_DEBOUNCE_MS);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/**
 * 下发各组件背景样式到原生（v2.15.0）。
 *
 * 样式存 settings.widget.styles，由「桌面组件样式」面板改动时调用；
 * 同时挂在 syncAll 开头 —— 保证 App 启动 / 「立即同步」都会把当前样式推给原生
 * （原生渲染时按组件切背景层，不需要 App 常驻）。
 */
export async function applyWidgetStyles(): Promise<void> {
  if (!isWidgetSupported()) return;
  try {
    const widget = useSettingsStore.getState().settings.widget;
    await YiyanWidget.setStyles({
      styles: JSON.stringify(widget.styles),
      nikoClock: widget.nikoClock,
    });
  } catch (e) {
    console.warn('[widget] 样式下发失败:', e);
  }
}

/**
 * 一键同步两类橱窗数据：待办快照（每次都刷新）+ 记忆卡片计划（余量判断）。
 * App 启动与面板「立即同步」均走这里。
 */
export async function syncAll(force = false): Promise<WidgetSyncReport> {
  await applyWidgetStyles();
  const todoRes = await syncTodoSnapshot();
  const planRes = await syncWidgetPlan(force);
  const parts: string[] = [todoRes.message];
  if (planRes.ok) {
    parts.push(planRes.scheduled > 0 ? planRes.message : '卡片计划仍有余量');
  } else {
    parts.push(planRes.message);
  }
  return {
    ok: todoRes.ok || planRes.ok,
    message: parts.join(' · '),
    scheduled: planRes.scheduled,
  };
}

/** 面板状态查询：桌面实例数量 + 当前计划 + 待办快照 */
export async function getWidgetStatus(): Promise<{
  baseCount: number;
  refreshCount: number;
  todoCount: number;
  plan: WidgetPlan | null;
  todoSnapshot: TodoSnapshot | null;
}> {
  const empty = { baseCount: 0, refreshCount: 0, todoCount: 0, plan: null, todoSnapshot: null };
  if (!isWidgetSupported()) return empty;
  try {
    const [st, pl, td] = await Promise.all([
      YiyanWidget.getStatus(),
      YiyanWidget.getPlan(),
      YiyanWidget.getTodo(),
    ]);
    let plan: WidgetPlan | null = null;
    if (pl?.plan) {
      try {
        const parsed = JSON.parse(pl.plan);
        if (isValidPlan(parsed)) plan = parsed;
      } catch {
        /* 计划损坏视为无 */
      }
    }
    let todoSnapshot: TodoSnapshot | null = null;
    if (td?.snapshot) {
      try {
        const parsed = JSON.parse(td.snapshot);
        if (isValidTodoSnapshot(parsed)) todoSnapshot = parsed;
      } catch {
        /* 快照损坏视为无 */
      }
    }
    return {
      baseCount: st?.baseCount ?? 0,
      refreshCount: st?.refreshCount ?? 0,
      todoCount: st?.todoCount ?? 0,
      plan,
      todoSnapshot,
    };
  } catch {
    return empty;
  }
}

/** 触发全部橱窗立即重绘（不改计划；面板「立即刷新」用） */
export async function refreshWidgetViews(): Promise<void> {
  if (!isWidgetSupported()) return;
  try {
    await YiyanWidget.refreshAll();
  } catch (e) {
    console.warn('[widget] 刷新失败:', e);
  }
}

/* ═══════════════ 内部实现 ═══════════════ */

/**
 * 候选池 · 加「展示候选筛选」（v2.14.0）
 *
 * 语义与随机页 / 记忆来信筛选完全一致（services/random.filterEntries）：
 * 标签（任一命中）/ 星标三态 / 时间（按修改时间闭区间）。
 * ⚠️ 筛选后池空 → 返回 null（调用方给出明确提示，而不是静默退化为全量投递）。
 */
async function loadFilteredPool(): Promise<Entry[] | null> {
  const all = await loadPoolEntries();
  if (all.length === 0) return all;
  const cfg = useSettingsStore.getState().settings.widget;
  if (!cfg?.filter || !isFilterActive(cfg.filter)) return all;
  const filtered = filterEntries(all, {
    tagIds: cfg.filter.tagIds.length > 0 ? cfg.filter.tagIds : undefined,
    isStarred: cfg.filter.starred,
    ...resolveTimeRange(cfg.filter.timeRange),
  });
  return filtered.length > 0 ? filtered : null;
}

/** 候选卡片池：优先用 store 已加载的条目；为空时从数据库全量兜底 */
async function loadPoolEntries(): Promise<Entry[]> {
  const fromStore = useEntryStore.getState().entries;
  if (fromStore.length > 0) return fromStore;
  try {
    const db = await getDatabase();
    return await db.getAllEntries();
  } catch {
    return [];
  }
}

/** 待办候选池：优先用 store 已加载的待办；为空时从数据库全量兜底 */
async function loadTodoPool(): Promise<Todo[]> {
  const fromStore = useTodoStore.getState().todos;
  if (fromStore.length > 0) return fromStore;
  try {
    const db = await getTodoDatabase();
    return await db.getAllTodos();
  } catch {
    return [];
  }
}
