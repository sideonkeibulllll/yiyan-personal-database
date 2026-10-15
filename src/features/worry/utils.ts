/**
 * 「怕了么」工具函数与常量
 */
import type { WorryNormalizedProbs, WorryOutcomeType } from '@/types';

/** 翻卡顺序（与参考视频一致：最坏 → 最好 → 普通） */
export const FLIP_ORDER: WorryOutcomeType[] = ['worst', 'best', 'normal'];

/** 概率条展示顺序（最坏 → 普通 → 最好） */
export const PROB_ORDER: WorryOutcomeType[] = ['worst', 'normal', 'best'];

/** 结局类型对应文案 */
export const OUTCOME_LABEL: Record<WorryOutcomeType, string> = {
  worst: '最坏结果',
  normal: '普通结果',
  best: '最好结果',
};

/** 数字夹取到 [min, max] 并取整 */
export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 最大余数法归一化：
 * 把任意三个 0–100 的概率按比例换算成整数百分比，
 * 保证三数之和**恰好**为 100（不会出现 101/99 的取整误差）。
 */
export function normalizeProbs(raw: { worst: number; normal: number; best: number }): WorryNormalizedProbs {
  const entries: { key: WorryOutcomeType; value: number }[] = [
    { key: 'worst', value: Math.max(0, raw.worst) },
    { key: 'normal', value: Math.max(0, raw.normal) },
    { key: 'best', value: Math.max(0, raw.best) },
  ];
  const sum = entries.reduce((acc, e) => acc + e.value, 0);

  // 全 0 兜底：均分（正常流程 UI 会阻止这种情况）
  if (sum <= 0) {
    return { worst: 33, normal: 34, best: 33 };
  }

  const scaled = entries.map(e => {
    const exact = (e.value / sum) * 100;
    const floor = Math.floor(exact);
    return { key: e.key, floor, frac: exact - floor };
  });

  let remaining = 100 - scaled.reduce((acc, s) => acc + s.floor, 0);
  // 余数大的优先进位
  const byFrac = [...scaled].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < byFrac.length && remaining > 0; i++) {
    byFrac[i].floor += 1;
    remaining -= 1;
  }

  const result: WorryNormalizedProbs = { worst: 0, normal: 0, best: 0 };
  for (const s of scaled) result[s.key] = s.floor;
  return result;
}
