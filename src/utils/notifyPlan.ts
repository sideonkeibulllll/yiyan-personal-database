/**
 * 记忆来信 · 排程计划（纯函数模块）
 *
 * ⚠️ 本文件不做任何 Capacitor / DOM / localStorage 访问 —— 只做「计算」。
 *    因此可以在 Node 中直接单元测试（见 _scratch_yiyan/verify 脚本）。
 *    被 services/notifyService.ts 引用；模块外请勿绕开门面直接使用。
 */
import type { NotifySettings } from '@/types';

/** 排程前瞻天数：每次预排未来 N 天 */
export const NOTIFY_PLAN_DAYS = 7;

/** 生成投递计划时用到的配置子集（从 NotifySettings 抽取，避免整包依赖） */
export type PlanConfig = Pick<NotifySettings, 'windowStart' | 'windowEnd' | 'dailyCount'>;

/** 本地时区日期键 YYYY-MM-DD */
export function toDayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 在 [startMinute, endMinute) 内生成 count 个不重复的随机分钟。
 *
 * 采用「分桶」而不是独立随机：把窗口均分成 count 段、每段随机一个分钟，
 * 天然保证不重复，且分布均匀（独立随机在小窗口下容易撞车）。
 *
 * @param rand 可注入的随机源（单元测试用）
 */
export function pickMinutesInWindow(
  startMinute: number,
  endMinute: number,
  count: number,
  rand: () => number = Math.random,
): number[] {
  const span = endMinute - startMinute;
  if (span <= 0 || count <= 0) return [];
  const n = Math.min(count, span);
  const bucket = Math.floor(span / n);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = startMinute + bucket * i;
    const hi = Math.min(lo + bucket - 1, endMinute - 1);
    result.push(lo + Math.floor(rand() * (hi - lo + 1)));
  }
  return result;
}

/**
 * 生成「某一天」的投递时刻列表（窗口内随机，升序）。
 *
 * - 已过去的时刻会被过滤（插件对早于当前时间的排程会直接报错丢弃）；
 *   缓冲 1 分钟，避免「排完之后恰好过期」。
 * - 今天窗口已过 / 剩余不足时可能返回空数组（该天不投递）。
 *
 * @param dayStart 当天 00:00 的时间戳（本地时区）
 * @param now      当前时间戳
 * @param rand     可注入的随机源（单元测试用）
 */
export function pickSlotsForDay(
  dayStart: number,
  cfg: PlanConfig,
  now: number,
  rand: () => number = Math.random,
): number[] {
  const minutes = pickMinutesInWindow(
    cfg.windowStart * 60,
    cfg.windowEnd * 60,
    cfg.dailyCount,
    rand,
  );
  const floor = now + 60_000;
  return minutes
    .map(m => dayStart + m * 60_000)
    .filter(at => at >= floor)
    .sort((a, b) => a - b);
}

/**
 * 计算「需要补齐的日期」列表（从今天起、前瞻 days 天）。
 *
 * 补缺策略（与 notifyService 的约定）：
 * - 只按「天」判断：该天已有 ≥1 条待投递通知即视为已排，不再补；
 * - 配置变更（开关 / 窗口 / 条数）走「全清重排」路径，不走补缺；
 * - 「今天」也会列入候选，由 pickSlotsForDay 自然过滤掉已过去的窗口。
 *
 * @param pendingDays 已排程的日期键集合（来自 getPending() 的 extra.dayKey）
 */
export function computeMissingDays(
  now: number,
  pendingDays: Set<string>,
  days: number = NOTIFY_PLAN_DAYS,
): { dayStart: number; dayKey: string }[] {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const result: { dayStart: number; dayKey: string }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const dayStart = d.getTime();
    const dayKey = toDayKey(dayStart);
    if (pendingDays.has(dayKey)) continue;
    result.push({ dayStart, dayKey });
  }
  return result;
}

/**
 * 生成通知 id（Android 侧为 32-bit int）。
 *
 * 用 entryId + dayKey + 序号做稳定哈希（djb2）：
 * 同一（卡, 日, 序号）组合重复计算得到同一 id，便于 cancel 与防重复排程；
 * 不同组合的碰撞概率极低（约 1/2^31）。
 */
export function makeNotificationId(entryId: string, dayKey: string, slotIndex: number): number {
  const s = `${entryId}@${dayKey}#${slotIndex}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // 归一到正整数域，避开 0（部分系统对 id=0 不友好）
  return (Math.abs(h) % 2147483646) + 1;
}

/** 距今已有多少天（用于通知标题「X 天前的记忆来信」，向下取整、最小 0） */
export function daysSince(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / 86_400_000));
}
