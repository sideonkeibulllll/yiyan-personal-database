/**
 * 条目筛选状态（标签 / 时间 / 星标）的共享类型与纯函数（v2.14.0）
 *
 * 随机页、记忆来信（设置面板）共用同一份语义，保证两处筛选体验完全一致。
 * ⚠️ 纯函数模块：不做任何 DOM / localStorage / Capacitor 访问，可在 Node 直接单测。
 */
import { sanitizeTimeRangeState } from '@/utils/timeRangeFilter';
import type { TimeRangeState } from '@/utils/timeRangeFilter';

/** 一次筛选的全部条件 */
export interface EntryFilterState {
  /** 选中的标签 id（空数组 = 不限标签） */
  tagIds: string[];
  /**
   * 星标状态：
   * - `undefined` = 全部（不筛）
   * - `true` = 仅已星标
   * - `false` = 仅未星标
   */
  starred?: boolean;
  /** 时间范围（按修改时间；无 preset 表示不限） */
  timeRange: TimeRangeState;
}

/** 空筛选（全不限） */
export const EMPTY_ENTRY_FILTER: EntryFilterState = { tagIds: [], starred: undefined, timeRange: {} };

/**
 * 把任意（可能来自旧版本持久化 / 云端）的数据校验成合法 EntryFilterState。
 * 容错：字段类型不对 → 丢弃该字段；整体非法 → 返回空筛选。
 */
export function sanitizeEntryFilter(parsed: unknown): EntryFilterState {
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_ENTRY_FILTER };
  const obj = parsed as Record<string, unknown>;
  return {
    tagIds: Array.isArray(obj.tagIds)
      ? obj.tagIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    starred: typeof obj.starred === 'boolean' ? obj.starred : undefined,
    timeRange: sanitizeTimeRangeState(obj.timeRange),
  };
}

/** 是否有任何生效中的筛选 */
export function isFilterActive(filter: EntryFilterState): boolean {
  return filter.tagIds.length > 0 || filter.starred !== undefined || !!filter.timeRange.preset;
}

/** 生效筛选的条数（用于徽章计数 / 「已筛选 N 项」文案） */
export function countActiveFilters(filter: EntryFilterState): number {
  let n = filter.tagIds.length;
  if (filter.starred !== undefined) n += 1;
  if (filter.timeRange.preset) n += 1;
  return n;
}

/** 反选标签：全部标签中未被选中的变为选中（空选反选 = 全选） */
export function invertTagIds(allTagIds: string[], selected: string[]): string[] {
  const selectedSet = new Set(selected);
  return allTagIds.filter(id => !selectedSet.has(id));
}
