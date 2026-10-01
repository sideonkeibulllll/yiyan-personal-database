/**
 * 转盘数据服务（v2.3.1）
 *
 * 设计要点：
 * - **一个转盘 = 一条记录**：选项与历史都以 JSON 内嵌在同一份数据里，
 *   读写永远只涉及 1 条，不产生"一个选项一条记录"的碎片化存储。
 * - 落盘用 localStorage（Web / Android WebView / Electron 三端都可用且持久），
 *   键名 `yiyan_wheels_v1`，整体是一个 Wheel[] 数组。
 *   —— 早期版本曾直接操作 SQLite 底层连接，但 Web 端（localStorage 实现）
 *      没有 `.db` 属性，导致浏览器下转盘完全打不开；改为此方案后三端一致。
 *
 * 云端备份：如需把转盘纳入 D1 备份，可在此追加导出/导入方法，数据结构本身已是纯 JSON。
 */
import type { Wheel, WheelOption } from '@/types';

const STORAGE_KEY = 'yiyan_wheels_v1';
const LAST_ID_KEY = 'yiyan_wheel_last_id';

/** 内置默认选项 */
export const DEFAULT_WHEEL_OPTIONS: WheelOption[] = [
  { name: '吃饭', weight: 1 },
  { name: '看电影', weight: 1 },
  { name: '散步', weight: 1 },
  { name: '看书', weight: 1 },
];

function genId(): string {
  return `wheel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取全部转盘（容错：坏数据回退空数组） */
function readAll(): Wheel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w: any) => w && typeof w.id === 'string')
      .map((w: any): Wheel => ({
        id: w.id,
        name: String(w.name ?? '转盘'),
        options: Array.isArray(w.options) ? w.options : [],
        history: Array.isArray(w.history) ? w.history : [],
        soundEnabled: w.soundEnabled !== false,
        removeAfterSpin: w.removeAfterSpin === true,
        createdAt: Number(w.createdAt) || Date.now(),
        updatedAt: Number(w.updatedAt) || Date.now(),
        isDeleted: w.isDeleted || 0,
      }));
  } catch {
    return [];
  }
}

function writeAll(wheels: Wheel[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wheels));
  } catch (err) {
    console.error('[wheelDatabase] 写入失败:', err);
  }
}

/** 获取全部转盘（按更新时间倒序） */
export async function getAllWheels(): Promise<Wheel[]> {
  return readAll()
    .filter(w => !w.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按 id 获取单个转盘 */
export async function getWheel(id: string): Promise<Wheel | null> {
  return readAll().find(w => w.id === id && !w.isDeleted) || null;
}

/** 新建转盘 */
export async function createWheel(name: string, options?: WheelOption[]): Promise<Wheel> {
  const now = Date.now();
  const opts = options && options.length > 0
    ? options.map(o => ({ ...o }))
    : DEFAULT_WHEEL_OPTIONS.map(o => ({ ...o }));
  const wheel: Wheel = {
    id: genId(),
    name,
    options: opts,
    history: [],
    soundEnabled: true,
    createdAt: now,
    updatedAt: now,
    isDeleted: 0,
  };
  const all = readAll();
  all.push(wheel);
  writeAll(all);
  return wheel;
}

/** 保存转盘（整条覆盖） */
export async function saveWheel(wheel: Wheel): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(w => w.id === wheel.id);
  const next = { ...wheel, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  writeAll(all);
}

/** 软删除转盘 */
export async function deleteWheel(id: string): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(w => w.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], isDeleted: 1, updatedAt: Date.now() };
    writeAll(all);
  }
}

/** 复制转盘 */
export async function duplicateWheel(id: string): Promise<Wheel | null> {
  const src = await getWheel(id);
  if (!src) return null;
  return await createWheel(`${src.name} 副本`, src.options.map(o => ({ ...o })));
}

/**
 * 获取"上次使用的转盘"；没有则用最近一个；再没有则创建默认盘。
 * 首页「决定转盘」按钮直接进这里返回的盘。
 */
export async function getLastOrCreateWheel(): Promise<Wheel> {
  const wheels = await getAllWheels();
  if (wheels.length > 0) {
    const lastId = localStorage.getItem(LAST_ID_KEY);
    if (lastId) {
      const found = wheels.find(w => w.id === lastId);
      if (found) return found;
    }
    return wheels[0];
  }
  const created = await createWheel('今天吃什么');
  setLastWheelId(created.id);
  return created;
}

/** 记录"上次使用的转盘" */
export function setLastWheelId(id: string): void {
  try { localStorage.setItem(LAST_ID_KEY, id); } catch { /* 忽略 */ }
}
