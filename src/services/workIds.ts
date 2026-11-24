/**
 * 作品包 id ↔ 作品名 映射（v3.9.0）
 *
 * 单独抽出来是为了打破循环依赖：
 * `workBundle` / `workCatalog` 需要读它判断「同一 id 是升级」，
 * `workLibrary.deleteWork` 需要删它（否则删掉作品后 id 还挂着，
 * 再导入同名包会被当成升级目标，甚至给新作品挤出 `-2`）。
 */
const KEY = 'yiyan_mod_ids_v1';

export interface WorkIdEntry {
  work: string;
  version: string;
  at: number;
}

export type WorkIdMap = Record<string, WorkIdEntry>;

export function getWorkIdMap(): WorkIdMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as WorkIdMap;
  } catch {
    return {};
  }
}

export function saveWorkIdMap(map: WorkIdMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 存不进去不影响本次导入 */
  }
}

export function setWorkId(id: string, work: string, version: string): void {
  const map = getWorkIdMap();
  map[id] = { work, version, at: Date.now() };
  saveWorkIdMap(map);
}

/** 某个作品装的是哪个 id（没有就 null） */
export function findWorkId(work: string): string | null {
  const map = getWorkIdMap();
  for (const [id, entry] of Object.entries(map)) {
    if (entry?.work === work) return id;
  }
  return null;
}

/** 作品被删除 / 改名时，把挂在它身上的 id 记录一并清掉 */
export function forgetWorkIdByWork(work: string): void {
  const map = getWorkIdMap();
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (entry?.work === work) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) saveWorkIdMap(map);
}
