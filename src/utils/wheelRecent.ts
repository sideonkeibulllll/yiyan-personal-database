/**
 * 转盘「最近使用顺序」（MRU，纯 localStorage 工具，v2.14.0）
 *
 * 语义：**只有「转动」才算使用**（「换」到某个盘、进入转盘页都不算）。
 * 规则（与 App 内「切换转盘」菜单 / 桌面转盘小组件的「换」共用同一顺序）：
 *  - 转过的盘插到队首；已存在则提前（去重）
 *  - 上限 5 条，溢出踢掉队尾（不保留）
 *  - 新盘（从未转过）不在列表中，由调用方按 updatedAt 兜底追加
 *
 * 存储：localStorage `yiyan_wheel_recent_v1` = string[]（wheelId，最新在前）
 *  ⚠️ 纯 localStorage —— 与 wheelDatabase 一样不进云备份。
 *  ⚠️ 不import任何 store / Capacitor，可在 Node 中直接单测。
 */

const RECENT_KEY = 'yiyan_wheel_recent_v1';

/** MRU 上限（用户决策：只能装 5 个元素，多余的踢出去） */
export const WHEEL_RECENT_MAX = 5;

/** 读取 MRU 列表（容错：坏数据回退空数组；去重、截断到上限） */
export function getWheelRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v !== 'string' || !v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= WHEEL_RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 纯函数版本：把 id 插到队首（去重 + 截断），返回新列表。
 * 供单测与内部复用；不做持久化。
 */
export function pushWheelRecentPure(list: string[], id: string): string[] {
  if (!id) return [...list].slice(0, WHEEL_RECENT_MAX);
  const next = [id, ...list.filter(x => x !== id)];
  return next.slice(0, WHEEL_RECENT_MAX);
}

/** 记录一次「转动」（插队首 + 去重 + 踢尾），返回更新后的列表 */
export function pushWheelRecent(id: string): string[] {
  const next = pushWheelRecentPure(getWheelRecent(), id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch (err) {
    console.error('[wheelRecent] 写入失败:', err);
  }
  return next;
}

/** 从 MRU 移除某个 id（删除转盘时调用，保持列表干净） */
export function removeWheelRecent(id: string): string[] {
  const next = getWheelRecent().filter(x => x !== id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 忽略 */
  }
  return next;
}

/**
 * 按「最近使用顺序」重排转盘列表：
 *  - MRU 中的盘按 MRU 顺序排在前面（最新用过的最上）
 *  - 其余盘保持传入顺序（调用方通常已按 updatedAt 倒序）追加在后
 *  - MRU 中已不存在的 id 自动忽略
 */
export function sortWheelsByRecent<T extends { id: string }>(wheels: T[], recent: string[] = getWheelRecent()): T[] {
  if (recent.length === 0) return [...wheels];
  const byId = new Map(wheels.map(w => [w.id, w]));
  const head: T[] = [];
  const used = new Set<string>();
  for (const id of recent) {
    const w = byId.get(id);
    if (w && !used.has(id)) {
      head.push(w);
      used.add(id);
    }
  }
  const tail = wheels.filter(w => !used.has(w.id));
  return [...head, ...tail];
}
