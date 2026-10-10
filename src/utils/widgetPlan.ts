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

/** 单条摘要最大字数（软限制） */
export const WIDGET_BODY_MAX = 240;

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

/* ═══════════════ 待办快照（v2.13.1：待办橱窗，1 大 + 5 小） ═══════════════ */

/** 待办快照最大条数（第一条放大展示） */
export const TODO_SNAPSHOT_MAX = 6;

/** 待办快照 · 单条 */
export interface TodoSnapshotItem {
  id: string;
  title: string;
  /** 备注摘要（大卡第二行；可为空串） */
  note: string;
  /** 时间文案（「今天 18:00」等；可为空串） */
  timeText: string;
}

/** 待办快照（结构与原生 WidgetShared.readTodoSnapshot 对齐，改结构必须两边同步） */
export interface TodoSnapshot {
  version: 1;
  generatedAt: number;
  /** 生成日（YYYY-MM-DD，本地时区）——原生跨天检测：不等于今天即显示「打开应用」态 */
  dateKey: string;
  /** 今日待办总数（含未展示的） */
  total: number;
  items: TodoSnapshotItem[];
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

/** 备注摘要（大卡第二行；压空白 + 截断 30 字） */
export function makeTodoNote(note: string | undefined): string {
  const raw = (note || '').replace(/\s+/g, ' ').trim();
  const MAX = 30;
  return raw.length > MAX ? `${raw.slice(0, MAX)}…` : raw;
}

/** 组装待办快照（items 需已按展示顺序排好；本函数只做裁剪与包装） */
export function assembleTodoSnapshot(
  dateKey: string,
  generatedAt: number,
  total: number,
  items: TodoSnapshotItem[],
): TodoSnapshot {
  return {
    version: 1,
    generatedAt,
    dateKey,
    total,
    items: items.slice(0, TODO_SNAPSHOT_MAX),
  };
}

/** 待办快照结构校验（原生侧渲染前的防御） */
export function isValidTodoSnapshot(v: unknown): v is TodoSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as TodoSnapshot;
  return (
    s.version === 1 &&
    typeof s.generatedAt === 'number' &&
    typeof s.dateKey === 'string' &&
    typeof s.total === 'number' &&
    Array.isArray(s.items) &&
    s.items.every(
      it => !!it && typeof (it as TodoSnapshotItem).id === 'string' && typeof (it as TodoSnapshotItem).title === 'string',
    )
  );
}
