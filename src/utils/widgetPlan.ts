/**
 * 桌面橱窗 · 展示计划（纯函数模块，v2.13.0）
 *
 * ⚠️ 本文件不做任何 Capacitor / DOM / localStorage 访问 —— 只做「计算」。
 *    因此可以在 Node 中直接单元测试（见 _scratch_yiyan/widget_plan_test.mjs）。
 *    被 services/widgetService.ts 引用；模块外请勿绕开门面使用。
 *
 * 与原生侧的契约（android/.../widget/WidgetShared.kt 依赖此 JSON 结构）：
 *   WidgetPlan = { version: 1, generatedAt: number, items: WidgetPlanItem[] }
 *   WidgetPlanItem = { at: number, entryId: string, title: string, body: string }
 *   —— 修改结构时必须同步 Kotlin 侧解析逻辑。
 */
/** 计划覆盖天数（生成一次管 N 天） */
export const WIDGET_PLAN_DAYS = 14;

/** 剩余有效天数低于此值 → 触发重新生成 */
export const WIDGET_RESYNC_THRESHOLD = 7;

/** 单条摘要最大字数（软限制；v2.13.2 放宽到 3000——9×6 满屏约需 600~900 字，任意尺寸都铺得满） */
export const WIDGET_BODY_MAX = 3000;

/** 一条展示计划项（title/body 为快照文本，原生直接渲染，不查数据库） */
export interface WidgetPlanItem {
  /** 生效时刻（展示日的本地 00:00） */
  at: number;
  entryId: string;
  /** 「X 天前的记忆来信」（按生效日计算，零快照误差） */
  title: string;
  /** 卡片内容摘要（保留换行，超长截断加「…」） */
  body: string;
}

/** 完整展示计划 */
export interface WidgetPlan {
  version: 1;
  generatedAt: number;
  items: WidgetPlanItem[];
}

/** 生成从今天起的 N 个「当天 00:00」时间戳（本地时区，升序） */
export function planDayStarts(now: number, days: number = WIDGET_PLAN_DAYS): number[] {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(d.getTime());
  }
  return out;
}

/** 计划剩余有效天数（生效时间在未来的项数） */
export function remainingDays(plan: WidgetPlan | null, now: number): number {
  if (!plan || !Array.isArray(plan.items)) return 0;
  return plan.items.filter(it => it.at > now).length;
}

/** 是否需要重新生成计划（无计划 / 结构非法 / 余量不足） */
export function shouldResync(plan: WidgetPlan | null, now: number): boolean {
  if (!isValidPlan(plan)) return true;
  return remainingDays(plan, now) < WIDGET_RESYNC_THRESHOLD;
}

/** 计划结构校验（JS 与调试共用） */
export function isValidPlan(v: unknown): v is WidgetPlan {
  if (!v || typeof v !== 'object') return false;
  const p = v as WidgetPlan;
  return (
    p.version === 1 &&
    typeof p.generatedAt === 'number' &&
    Array.isArray(p.items) &&
    p.items.length > 0 &&
    p.items.every(
      it =>
        !!it &&
        typeof it.at === 'number' &&
        typeof it.entryId === 'string' &&
        typeof it.title === 'string' &&
        typeof it.body === 'string',
    )
  );
}

/** 组装计划（items 按 at 升序归一） */
export function assemblePlan(generatedAt: number, items: WidgetPlanItem[]): WidgetPlan {
  return { version: 1, generatedAt, items: [...items].sort((a, b) => a.at - b.at) };
}

/**
 * 生成摘要正文：
 * - 保留换行（原生 TextView 多行渲染，按尺寸 maxLines 截断）
 * - 压掉 3 行以上连续空行
 * - 超过 WIDGET_BODY_MAX 截断加「…」（大尺寸布局也放得下；标准布局由原生 truncate）
 * - 纯图片卡 / 空白卡走兜底文案
 */
export function makeWidgetBody(content: string, attachmentCount: number = 0): string {
  const raw = (content || '').replace(/\r\n/g, '\n').trim();
  if (!raw) {
    return attachmentCount > 0 ? '（一张图片记忆，点开看看）' : '（一条空白的记忆）';
  }
  const compact = raw.replace(/\n{3,}/g, '\n\n');
  return compact.length > WIDGET_BODY_MAX ? `${compact.slice(0, WIDGET_BODY_MAX)}…` : compact;
}

/* ═══════════════ 待办快照（v2.13.2：三视图，1 大 + 5 小直铺） ═══════════════ */

/** 每视图快照条数上限（第一条放大 hero，其余 5 条小列表直铺；「写死 5 条」口径） */
export const TODO_SNAPSHOT_MAX = 6;

/** 视图 id（与原生 todo_view_<id> 的循环顺序对齐：今天 → 有期 → 无期） */
export type TodoViewId = 'today' | 'timed' | 'untimed';

/** 待办快照 · 单条 */
export interface TodoSnapshotItem {
  id: string;
  title: string;
  /** 备注摘要（大卡第二行；可为空串） */
  note: string;
  /** 时间文案（「今天 18:00」等；可为空串） */
  timeText: string;
}

/** 单视图数据（快照内三份：today / timed / untimed） */
export interface TodoView {
  /** 该视图总条数（截断前） */
  total: number;
  items: TodoSnapshotItem[];
}

/** 待办快照 v2（结构与原生 WidgetShared.readTodoSnapshot 对齐，改结构必须两边同步） */
export interface TodoSnapshot {
  version: 2;
  generatedAt: number;
  /** 生成日（YYYY-MM-DD，本地时区）——原生跨天检测：不等于今天即显示「打开应用」态 */
  dateKey: string;
  views: Record<TodoViewId, TodoView>;
}

/** 时间文案：「今天 18:00」「明天 9:00」「10-15 18:00」（无 endTime → 空串） */
export function toTimeText(endTime: number | undefined | null, now: number): string {
  if (!endTime) return '';
  const d = new Date(endTime);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOfDay = (ts: number): number => {
    const x = new Date(ts);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const dayDiff = Math.round((startOfDay(endTime) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${hm}`;
  if (dayDiff === 1) return `明天 ${hm}`;
  if (dayDiff === -1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

/**
 * 有期视图 · 时段文案（主页 timed 卡同款信息密度）：
 * - 同天且今天 → 「14:00-16:00」；明天 → 「明天 9:00-11:00」；更远 → 「10-15 14:00-16:00」
 * - 跨天时段 → 两端都带日期「10-15 23:00-10-16 1:00」
 */
export function toTimedRangeText(
  startTime: number | undefined | null,
  endTime: number | undefined | null,
  now: number,
): string {
  if (!startTime || !endTime) return '';
  const fmtHM = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const startOfDay = (ts: number): number => {
    const x = new Date(ts);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const fmtMD = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
  };
  if (startOfDay(startTime) !== startOfDay(endTime)) {
    return `${fmtMD(startTime)} ${fmtHM(startTime)}-${fmtMD(endTime)} ${fmtHM(endTime)}`;
  }
  const range = `${fmtHM(startTime)}-${fmtHM(endTime)}`;
  const dayDiff = Math.round((startOfDay(startTime) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return range;
  if (dayDiff === 1) return `明天 ${range}`;
  return `${fmtMD(startTime)} ${range}`;
}

/**
 * 待办排序（「个人排序优先」）：
 * - 基序：有 endTime 的按快到期的优先；无 endTime 的按创建时间先后
 * - 用户手动排序（拖拽记录）中的 id 按记录顺序提到前面，其余保持基序追加在后
 */
export function orderTodosForWidget<
  T extends { id: string; endTime?: number; createdAt: number },
>(candidates: T[], manualOrder: string[]): T[] {
  const base = [...candidates].sort((a, b) => {
    const ae = a.endTime;
    const be = b.endTime;
    if (ae !== undefined && be !== undefined) return ae - be;
    if (ae !== undefined) return -1;
    if (be !== undefined) return 1;
    return a.createdAt - b.createdAt;
  });
  if (manualOrder.length === 0) return base;
  const idx = new Map(manualOrder.map((id, i) => [id, i]));
  const known: T[] = [];
  const unknown: T[] = [];
  for (const t of base) {
    if (idx.has(t.id)) known.push(t);
    else unknown.push(t);
  }
  known.sort((a, b) => idx.get(a.id)! - idx.get(b.id)!);
  return [...known, ...unknown];
}

/** 三视图排序共用的最小待办形状（与 types/index.ts 的 Todo 结构对齐的子集） */
export interface WidgetTodoLike {
  id: string;
  title: string;
  status?: string;
  deletedAt?: number;
  startTime?: number;
  endTime?: number;
  createdAt: number;
}

/**
 * 有期视图（口径逐行对照主页 timed 卡，完整列表版）：
 * - 候选：pending 未删除、有起止时间、且未过期（endTime > now）
 * - 排序：进行中（start ≤ now ≤ end）按结束近的优先 → 未来按开始早的优先（同开始 → 时长短优先）
 */
export function orderTimedForWidget<T extends WidgetTodoLike>(todos: T[], now: number): T[] {
  const candidates = todos.filter(
    t =>
      t.status === 'pending' &&
      !t.deletedAt &&
      typeof t.startTime === 'number' &&
      typeof t.endTime === 'number' &&
      t.endTime > now,
  );
  const inPeriod = candidates
    .filter(t => t.startTime! <= now && t.endTime! >= now)
    .sort((a, b) => a.endTime! - b.endTime!);
  const future = candidates
    .filter(t => t.startTime! > now)
    .sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime! - b.startTime!;
      return a.endTime! - a.startTime! - (b.endTime! - b.startTime!);
    });
  return [...inPeriod, ...future];
}

/**
 * 无期视图（口径逐行对照主页 untimed 卡，完整列表版）：
 * - 候选：pending 未删除、无起止时间
 * - 排序：创建时间最早的在前
 */
export function orderUntimedForWidget<T extends WidgetTodoLike>(todos: T[]): T[] {
  return todos
    .filter(t => t.status === 'pending' && !t.deletedAt && !t.startTime && !t.endTime)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 备注摘要（大卡第二行；压空白 + 截断 30 字） */
export function makeTodoNote(note: string | undefined): string {
  const raw = (note || '').replace(/\s+/g, ' ').trim();
  const MAX = 30;
  return raw.length > MAX ? `${raw.slice(0, MAX)}…` : raw;
}

/** 组装待办快照（各视图 items 需已按展示顺序排好；本函数只做裁剪与包装） */
export function assembleTodoSnapshot(
  dateKey: string,
  generatedAt: number,
  views: Record<TodoViewId, { total: number; items: TodoSnapshotItem[] }>,
): TodoSnapshot {
  const clip = (v: { total: number; items: TodoSnapshotItem[] }): TodoView => ({
    total: v.total,
    items: v.items.slice(0, TODO_SNAPSHOT_MAX),
  });
  return {
    version: 2,
    generatedAt,
    dateKey,
    views: {
      today: clip(views.today),
      timed: clip(views.timed),
      untimed: clip(views.untimed),
    },
  };
}

/** 待办快照结构校验（原生侧渲染前的防御） */
export function isValidTodoSnapshot(v: unknown): v is TodoSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as TodoSnapshot;
  if (s.version !== 2 || typeof s.generatedAt !== 'number' || typeof s.dateKey !== 'string') return false;
  const views = s.views as Record<string, TodoView> | undefined;
  if (!views || typeof views !== 'object') return false;
  return (['today', 'timed', 'untimed'] as const).every(k => {
    const view = views[k];
    return (
      !!view &&
      typeof view === 'object' &&
      typeof view.total === 'number' &&
      Array.isArray(view.items) &&
      view.items.every(it => !!it && typeof it.id === 'string' && typeof it.title === 'string')
    );
  });
}
