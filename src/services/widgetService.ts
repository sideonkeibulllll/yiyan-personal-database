/**
 * 桌面橱窗 · 服务门面（v2.13.0）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  对外契约（所有外部引用必须从本文件走，禁止绕过门面直连插件或内部函数）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 被引用的位置与用途：
 *  - App.tsx      → syncAll()           启动后台同步（数据就绪后延迟触发）
 *  - WidgetPanel  → getWidgetStatus() / syncAll(true) / refreshWidgetViews()
 *
 * 两类橱窗数据（均写入原生 SharedPreferences，由 Provider 渲染）：
 *  - 记忆卡片计划（14 天）：setPlan / getPlan（余量充足时跳过重排）
 *  - 待办快照（1 大 + 5 小）：setTodo / getTodo（每次打开 App 都刷新）
 *
 * 模块边界：
 *  - 依赖：registerPlugin('YiyanWidget')、entryStore、database、
 *          utils/widgetPlan、utils/exposurePool、utils/notifyPlan（标题口径）
 *  - 原生实现：android/app/src/main/java/com/yiyan/memorydb/widget/WidgetBridgePlugin.kt
 *    （JSON 结构与键名与其对齐；改结构必须两边同步）
 *
 * 数据流：
 *  打开 App → 生成 14 天展示计划（加权选卡 + 曝光去重）
 *  → YiyanWidget.setPlan() 写入 SharedPreferences
 *  → 原生 Provider 按天换卡（不依赖 App 常驻）
 *  → 点击走 deep link（com.yiyan.memorydb://entry/<id>）打开卡片浏览页
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEntryStore } from '@/stores/entryStore';
import { useTodoStore } from '@/stores/todoStore';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { weightedRandomSelect } from '@/services/random';
import { makeReunionTitle, toDayKey } from '@/utils/notifyPlan';
import { getSortOrder } from '@/utils/todoSortOrder';
import {
  assemblePlan,
  assembleTodoSnapshot,
  isValidPlan,
  isValidTodoSnapshot,
  makeTodoNote,
  makeWidgetBody,
  orderTodosForWidget,
  planDayStarts,
  shouldResync,
  toTimeText,
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
  /** 本次生成的计划天数（余量充足跳过时为 0） */
  scheduled: number;
}

/**
 * 同步展示计划：生成/续排未来 14 天，写入原生。
 *
 * - 默认增量：计划余量充足（≥ WIDGET_RESYNC_THRESHOLD 天）时跳过；
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
      return { ok: true, message: '计划仍有余量', scheduled: 0 };
    }

    // 2. 候选池（store 优先、数据库兜底）+ 曝光去重
    const entries = await loadPoolEntries();
    if (entries.length === 0) {
      return { ok: false, message: '抽屉里还没有卡片，先存一条吧', scheduled: 0 };
    }
    const exposed = recentlyExposedIds(now);
    let pool = entries.filter(e => !exposed.has(e.id));
    if (pool.length === 0) pool = entries;

    // 3. 每天一张；选卡复用加权随机（本轮不重复，池子不足时循环复用）
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
    for (const dayStart of planDayStarts(now)) {
      const picked = pickFor();
      if (!picked) break;
      items.push({
        at: dayStart,
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

    return { ok: true, message: `已安排未来 ${items.length} 天的橱窗`, scheduled: items.length };
  } catch (e) {
    console.warn('[widget] 同步失败:', e);
    return { ok: false, message: '同步失败，请稍后重试', scheduled: 0 };
  }
}

/**
 * 同步待办快照（1 大 + 5 小，v2.13.1）：
 * - 每次打开 App 都写（待办变化频繁，不做余量跳过）
 * - 候选 = 今天文件夹 ∪ 「今日处理」标记的 pending 待办
 * - 排序：用户手动拖拽排序优先；否则到期近优先 → 创建先后
 */
export async function syncTodoSnapshot(): Promise<WidgetSyncReport> {
  if (!isWidgetSupported()) {
    return { ok: false, message: '桌面橱窗仅在安卓端可用', scheduled: 0 };
  }
  try {
    const todos = await loadTodoPool();
    const now = Date.now();
    const todayKey = toDayKey(now);
    const candidates = todos.filter(
      t => t.status === 'pending' && !t.deletedAt && (t.folderDate === todayKey || t.isToday),
    );
    const ordered = orderTodosForWidget(candidates, getSortOrder(todayKey));
    const items = ordered.map(t => ({
      id: t.id,
      title: t.title,
      note: makeTodoNote(t.note),
      timeText: toTimeText(t.endTime, now),
    }));
    const snapshot = assembleTodoSnapshot(todayKey, now, candidates.length, items);
    await YiyanWidget.setTodo({ snapshot: JSON.stringify(snapshot) });
    return { ok: true, message: `今日待办 ${candidates.length} 条`, scheduled: items.length };
  } catch (e) {
    console.warn('[widget] 待办快照同步失败:', e);
    return { ok: false, message: '待办同步失败', scheduled: 0 };
  }
}

/**
 * 一键同步两类橱窗数据：待办快照（每次都刷新）+ 记忆卡片计划（余量判断）。
 * App 启动与面板「立即同步」均走这里。
 */
export async function syncAll(force = false): Promise<WidgetSyncReport> {
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
