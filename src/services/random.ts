/**
 * 随机算法服务
 * 加权随机选择
 */
import type { Entry } from '@/types';

/**
 * 计算条目权重
 * 基础权重 = 1
 * 星标 +1（2倍）
 * 5天内使用 +1（2倍）
 * 星标 + 近期使用 = 4倍
 */
export function calculateWeight(entry: Entry, now: number = Date.now()): number {
  let weight = 1;

  if (entry.isStarred) {
    weight += 1;
  }

  if (entry.lastUsedAt && now - entry.lastUsedAt < 5 * 24 * 60 * 60 * 1000) {
    weight += 1;
  }

  return weight;
}

/**
 * 加权随机选择
 */
export function weightedRandomSelect(entries: Entry[], now: number = Date.now()): Entry | null {
  if (entries.length === 0) return null;

  const weights = entries.map(entry => calculateWeight(entry, now));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let random = Math.random() * totalWeight;

  for (let i = 0; i < entries.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return entries[i];
    }
  }

  return entries[entries.length - 1];
}

/**
 * 根据筛选条件过滤条目
 */
export function filterEntries(
  entries: Entry[],
  options?: {
    tagIds?: string[];
    isStarred?: boolean;
  }
): Entry[] {
  let filtered = [...entries];

  if (options?.tagIds && options.tagIds.length > 0) {
    filtered = filtered.filter(entry =>
      entry.tags?.some(tag => options.tagIds!.includes(tag.id))
    );
  }

  if (options?.isStarred !== undefined) {
    filtered = filtered.filter(entry => entry.isStarred === options.isStarred);
  }

  return filtered;
}
