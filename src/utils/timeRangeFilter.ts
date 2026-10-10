/**
 * 「时间范围」筛选（按修改时间）的共享类型与换算逻辑（v2.10.0）
 *
 * 搜索页 / 随机页共用，保证两处筛选语义完全一致：
 * - 预设：当前时刻往前 N×24 小时（滚动窗口）
 * - 自定义：起始日 00:00:00.000 ~ 结束日 23:59:59.999（本地时区）
 */

/** 时间范围预设 */
export type TimeRangePreset = '1d' | '3d' | '7d' | 'custom';

export interface TimeRangeState {
  preset?: TimeRangePreset;
  /** 自定义起始日（YYYY-MM-DD，含当天 00:00:00） */
  from?: string;
  /** 自定义结束日（YYYY-MM-DD，含当天 23:59:59.999） */
  to?: string;
}

export const TIME_RANGE_PRESETS: { key: TimeRangePreset; label: string }[] = [
  { key: '1d', label: '近1天' },
  { key: '3d', label: '近3天' },
  { key: '7d', label: '近7天' },
];

/** 把任意（可能是旧版本的）持久化数据校验成合法 TimeRangeState */
export function sanitizeTimeRangeState(parsed: unknown): TimeRangeState {
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const preset = obj.preset;
  if (preset !== '1d' && preset !== '3d' && preset !== '7d' && preset !== 'custom') return {};
  return {
    preset,
    from: typeof obj.from === 'string' && obj.from ? obj.from : undefined,
    to: typeof obj.to === 'string' && obj.to ? obj.to : undefined,
  };
}

/**
 * 时间筛选状态 → [modifiedAfter, modifiedBefore] 时间戳（闭区间）。
 * 无选择（无 preset）时返回空对象（不加时间约束）。
 */
export function resolveTimeRange(state: TimeRangeState): { modifiedAfter?: number; modifiedBefore?: number } {
  if (!state.preset) return {};
  if (state.preset === 'custom') {
    const out: { modifiedAfter?: number; modifiedBefore?: number } = {};
    if (state.from) {
      const [y, m, d] = state.from.split('-').map(Number);
      if (y && m && d) out.modifiedAfter = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    }
    if (state.to) {
      const [y, m, d] = state.to.split('-').map(Number);
      if (y && m && d) out.modifiedBefore = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    }
    return out;
  }
  const days = state.preset === '1d' ? 1 : state.preset === '3d' ? 3 : 7;
  return { modifiedAfter: Date.now() - days * 24 * 60 * 60 * 1000 };
}

/** 时间筛选的显示文案（无选择时返回「时间」） */
export function timeRangeLabel(state: TimeRangeState): string {
  if (state.preset === '1d') return '近1天';
  if (state.preset === '3d') return '近3天';
  if (state.preset === '7d') return '近7天';
  if (state.preset === 'custom') return '自定义日期';
  return '时间';
}
