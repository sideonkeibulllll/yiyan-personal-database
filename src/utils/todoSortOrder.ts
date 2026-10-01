/**
 * 待办手动排序持久化（localStorage）
 *
 * 设计：
 * - 按 folderDate 分组存储手动排序的 id 数组
 * - 未手动排序过的日期 → 回退按时间排序（现状）
 * - 手动排序过的日期 → 优先按手动顺序；不在列表中的新待办追加到末尾
 *
 * 存储键：`yiyan_todo_sort_v1` → { [folderDate: string]: string[] }
 */

const STORAGE_KEY = 'yiyan_todo_sort_v1';

type SortMap = Record<string, string[]>;

function readAll(): SortMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as SortMap : {};
  } catch {
    return {};
  }
}

function writeAll(map: SortMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略写入失败（隐私模式/配额） */
  }
}

/** 读取某日期的手动排序 id 列表（无则返回空数组） */
export function getSortOrder(folderDate: string): string[] {
  const map = readAll();
  const list = map[folderDate];
  return Array.isArray(list) ? list : [];
}

/** 保存某日期的手动排序 id 列表 */
export function setSortOrder(folderDate: string, ids: string[]): void {
  const map = readAll();
  map[folderDate] = ids;
  writeAll(map);
}

/** 清除某日期的手动排序（恢复按时间排序） */
export function clearSortOrder(folderDate: string): void {
  const map = readAll();
  if (map[folderDate]) {
    delete map[folderDate];
    writeAll(map);
  }
}

/**
 * 把手动排序应用到待办列表
 * - 已手动排序的 id 按记录顺序靠前
 * - 未记录的（新增）待办按原文顺序追加到末尾
 */
export function applySortOrder<T extends { id: string }>(folderDate: string, list: T[]): T[] {
  const order = getSortOrder(folderDate);
  if (order.length === 0) return list;

  const indexMap = new Map<string, number>();
  order.forEach((id, i) => indexMap.set(id, i));

  const known: T[] = [];
  const unknown: T[] = [];
  for (const item of list) {
    if (indexMap.has(item.id)) known.push(item);
    else unknown.push(item);
  }
  known.sort((a, b) => indexMap.get(a.id)! - indexMap.get(b.id)!);
  return [...known, ...unknown];
}

/** 从排序后列表反推新的 id 序列（用于拖拽落位后保存） */
export function extractIds(list: { id: string }[]): string[] {
  return list.map(t => t.id);
}
