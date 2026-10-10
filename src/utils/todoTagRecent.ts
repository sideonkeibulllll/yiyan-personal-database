/**
 * 待办标签「最近点击」记录（v2.10.0）
 *
 * 纯 localStorage 存储（与拖拽排序 yiyan_todo_sort_v1 的既有做法一致，不动数据库）。
 * 用途：待办编辑页的标签列表按「最近点击」排序 —— 刚点过的标签浮到最前，
 * 没点过的按创建时间降序（与原来的默认顺序一致）。
 *
 * 设计取舍：
 * - 点击时只「记录」，列表顺序在下次进入编辑页时生效。
 *   这样编辑过程中连续点选多个标签时，chip 位置不会跳来跳去（防止误触）。
 */

const RECENT_KEY = 'yiyan_todo_tag_recent_v1';

type RecentMap = Record<string, number>;

function loadRecentMap(): RecentMap {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const map: RecentMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v)) map[k] = v;
      }
      return map;
    }
  } catch {
    /* 忽略存储异常 */
  }
  return {};
}

/** 记录一次标签点击（选中/取消选中都算「用过」） */
export function markTodoTagClicked(tagId: string): void {
  if (!tagId) return;
  try {
    const map = loadRecentMap();
    map[tagId] = Date.now();
    localStorage.setItem(RECENT_KEY, JSON.stringify(map));
  } catch {
    /* 忽略存储失败 */
  }
}

/** 清除某标签的最近记录（删除标签时调用，避免冷键堆积） */
export function clearTodoTagRecent(tagId: string): void {
  try {
    const map = loadRecentMap();
    if (map[tagId] !== undefined) {
      delete map[tagId];
      localStorage.setItem(RECENT_KEY, JSON.stringify(map));
    }
  } catch {
    /* 忽略存储失败 */
  }
}

/**
 * 按「最近点击」排序：
 * - sortKey = 最近点击时间 ?? 创建时间，降序
 * - 刚点过的标签浮到最前；没点过的按创建时间（与默认顺序一致）
 */
export function sortTodoTagsByRecent<T extends { id: string; createdAt: number }>(tags: T[]): T[] {
  const recent = loadRecentMap();
  return [...tags].sort((a, b) => {
    const aKey = recent[a.id] || a.createdAt;
    const bKey = recent[b.id] || b.createdAt;
    return bKey - aKey || b.createdAt - a.createdAt;
  });
}
