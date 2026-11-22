/**
 * 作品资产库（v3.8.0）：元数据 / 封面 / 版本快照 / 作品应用数据
 *
 * 一个 IndexedDB（yiyan_file_assets）四个 store，跟文件本体（Filesystem files/）分开：
 * 文件是文件，文件的「状态」是状态，别把封面塞进文件柜喵。
 *
 * - meta     ：置顶 / pinOrder / lastOpenedAt
 * - covers   ：封面 dataURL（html 首次预览 3s 后自动截图）
 * - versions ：版本快照（每文件滚动保留 20 份）
 * - appdata  ：作品内的 localStorage 数据（存储垫片回写，按文件名分库）
 *
 * 重命名/删除统一走 workLibrary 的 migrateFileAssets / purgeFileAssets。
 */

const DB_NAME = 'yiyan_file_assets';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_COVERS = 'covers';
const STORE_VERSIONS = 'versions';
const STORE_APPDATA = 'appdata';

/** 每个文件保留的快照上限 */
export const VERSION_KEEP = 20;

export interface FileMeta {
  name: string;
  pinned?: boolean;
  /** 置顶排序（小的在前；pin 时取 Date.now()，上移/下移时交换） */
  pinOrder?: number;
  /** 上次打开/预览时间（默认区按它倒序） */
  lastOpenedAt?: number;
}

export interface FileVersion {
  id?: number;
  name: string;
  ts: number;
  text: string;
  size: number;
  reason: 'save' | 'ai' | 'system';
}

export interface FileAppData {
  name: string;
  data: Record<string, string>;
  updatedAt: number;
}

export interface FileCover {
  name: string;
  dataURL: string;
  ts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(STORE_COVERS)) db.createObjectStore(STORE_COVERS, { keyPath: 'name' });
      if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
        const store = db.createObjectStore(STORE_VERSIONS, { keyPath: 'id', autoIncrement: true });
        store.createIndex('byName', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_APPDATA)) db.createObjectStore(STORE_APPDATA, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDB();
  const store = db.transaction(storeName, mode).objectStore(storeName);
  return fn(store);
}

// ===== 元数据 =====

export async function getMetaMap(): Promise<Record<string, FileMeta>> {
  return withStore(STORE_META, 'readonly', async store => {
    const all = await reqResult(store.getAll() as IDBRequest<FileMeta[]>);
    const map: Record<string, FileMeta> = {};
    for (const item of all) map[item.name] = item;
    return map;
  });
}

export async function getFileMeta(name: string): Promise<FileMeta | null> {
  return withStore(STORE_META, 'readonly', store => reqResult(store.get(name) as IDBRequest<FileMeta | undefined>)).then(v => v ?? null);
}

export async function updateFileMeta(name: string, patch: Partial<Omit<FileMeta, 'name'>>): Promise<FileMeta> {
  return withStore(STORE_META, 'readwrite', async store => {
    const cur = (await reqResult(store.get(name) as IDBRequest<FileMeta | undefined>)) ?? { name };
    const next: FileMeta = { ...cur, ...patch, name };
    await reqResult(store.put(next));
    return next;
  });
}

export function touchFileOpened(name: string): Promise<FileMeta> {
  return updateFileMeta(name, { lastOpenedAt: Date.now() });
}

// ===== 封面 =====

export async function getCoverMap(): Promise<Record<string, string>> {
  return withStore(STORE_COVERS, 'readonly', async store => {
    const all = await reqResult(store.getAll() as IDBRequest<FileCover[]>);
    const map: Record<string, string> = {};
    for (const item of all) map[item.name] = item.dataURL;
    return map;
  });
}

export function getCover(name: string): Promise<FileCover | null> {
  return withStore(STORE_COVERS, 'readonly', store => reqResult(store.get(name) as IDBRequest<FileCover | undefined>)).then(v => v ?? null);
}

export function setCover(name: string, dataURL: string): Promise<void> {
  return withStore(STORE_COVERS, 'readwrite', async store => {
    await reqResult(store.put({ name, dataURL, ts: Date.now() } satisfies FileCover));
  });
}

export function deleteCover(name: string): Promise<void> {
  return withStore(STORE_COVERS, 'readwrite', store => reqResult(store.delete(name)).then(() => undefined));
}

// ===== 版本快照 =====

/**
 * 覆盖前把「旧内容」存成快照。
 * name 是 `<作品名>/<相对路径>`（v3.8.0 起快照按文件粒度）。
 * 与最新一份内容相同时跳过（无意义的保存不留垃圾）。
 */
export async function snapshotVersion(name: string, oldText: string, reason: FileVersion['reason']): Promise<void> {
  await withStore(STORE_VERSIONS, 'readwrite', async store => {
    const idx = store.index('byName');
    const existing = await reqResult(idx.getAll(IDBKeyRange.only(name)) as IDBRequest<FileVersion[]>);
    const sorted = existing.sort((a, b) => b.ts - a.ts);
    if (sorted.length > 0 && sorted[0].text === oldText) return;
    await reqResult(store.add({ name, ts: Date.now(), text: oldText, size: oldText.length, reason } satisfies FileVersion));
    // 滚动淘汰：只留最近 VERSION_KEEP 份
    if (sorted.length >= VERSION_KEEP) {
      for (const v of sorted.slice(VERSION_KEEP - 1)) {
        if (v.id != null) await reqResult(store.delete(v.id));
      }
    }
  });
}

export async function listVersions(name: string): Promise<FileVersion[]> {
  return withStore(STORE_VERSIONS, 'readonly', async store => {
    const all = await reqResult(store.index('byName').getAll(IDBKeyRange.only(name)) as IDBRequest<FileVersion[]>);
    return all.sort((a, b) => b.ts - a.ts);
  });
}

export function getVersion(id: number): Promise<FileVersion | null> {
  return withStore(STORE_VERSIONS, 'readonly', store => reqResult(store.get(id) as IDBRequest<FileVersion | undefined>)).then(v => v ?? null);
}

export function deleteVersion(id: number): Promise<void> {
  return withStore(STORE_VERSIONS, 'readwrite', store => reqResult(store.delete(id)).then(() => undefined));
}

// ===== 作品应用数据（存储垫片回写） =====

export function getAppData(name: string): Promise<Record<string, string>> {
  return withStore(STORE_APPDATA, 'readonly', store => reqResult(store.get(name) as IDBRequest<FileAppData | undefined>))
    .then(v => v?.data ?? {});
}

export function saveAppData(name: string, data: Record<string, string>): Promise<void> {
  return withStore(STORE_APPDATA, 'readwrite', async store => {
    await reqResult(store.put({ name, data, updatedAt: Date.now() } satisfies FileAppData));
  });
}

export function clearAppData(name: string): Promise<void> {
  return withStore(STORE_APPDATA, 'readwrite', store => reqResult(store.delete(name)).then(() => undefined));
}

export async function appDataStats(name: string): Promise<{ keys: number; bytes: number }> {
  const data = await getAppData(name);
  const keys = Object.keys(data).length;
  let bytes = 0;
  for (const [k, v] of Object.entries(data)) bytes += k.length + (v?.length ?? 0);
  return { keys, bytes };
}

// ===== 生命周期：重命名迁移 / 删除清理 =====

/** 重命名：把四库的键从 from 挪到 to（versions 含 from 前缀键一并搬） */
export async function migrateFileAssets(from: string, to: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_META, STORE_COVERS, STORE_VERSIONS, STORE_APPDATA], 'readwrite');
    t.onerror = () => reject(t.error);
    t.oncomplete = () => resolve();

    for (const storeName of [STORE_META, STORE_COVERS, STORE_APPDATA]) {
      const store = t.objectStore(storeName);
      const getReq = store.get(from);
      getReq.onsuccess = () => {
        const val = getReq.result as { name: string } | undefined;
        if (val) {
          store.put({ ...val, name: to });
          store.delete(from);
        }
      };
    }
    const vStore = t.objectStore(STORE_VERSIONS);
    const idx = vStore.index('byName');
    const cursorReq = idx.openCursor(IDBKeyRange.lowerBound(from));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const v = cursor.value as FileVersion;
      if (v.name === from || v.name.startsWith(from + '/')) {
        const nextName = v.name === from ? to : to + v.name.slice(from.length);
        vStore.put({ ...v, name: nextName });
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

/** 平铺时代的老快照键（文件名）改写成新键（作品名/入口） */
export async function migrateVersionKeys(fromKey: string, toKey: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_VERSIONS], 'readwrite');
    t.onerror = () => reject(t.error);
    t.oncomplete = () => resolve();
    const vStore = t.objectStore(STORE_VERSIONS);
    const idx = vStore.index('byName');
    const cursorReq = idx.openCursor(IDBKeyRange.only(fromKey));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const v = cursor.value as FileVersion;
      vStore.put({ ...v, name: toKey });
      cursor.delete();
      cursor.continue();
    };
  });
}

/** 删除作品时清干净四库（versions 含 name 前缀键） */
export async function purgeFileAssets(name: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORE_META, STORE_COVERS, STORE_VERSIONS, STORE_APPDATA], 'readwrite');
    t.onerror = () => reject(t.error);
    t.oncomplete = () => resolve();
    t.objectStore(STORE_META).delete(name);
    t.objectStore(STORE_COVERS).delete(name);
    t.objectStore(STORE_APPDATA).delete(name);
    const idx = t.objectStore(STORE_VERSIONS).index('byName');
    const cursorReq = idx.openCursor(IDBKeyRange.lowerBound(name));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const v = cursor.value as FileVersion;
      if (v.name === name || v.name.startsWith(name + '/')) cursor.delete();
      cursor.continue();
    };
  });
}
