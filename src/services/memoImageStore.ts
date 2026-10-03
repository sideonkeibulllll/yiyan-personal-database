/**
 * 备忘录图片本地存储（IndexedDB）—— v2.7.0
 *
 * 为什么不用 localStorage / dataURL：
 *  - localStorage 只有 ~5MB，备忘录正文存 dataURL 很快撑爆；
 *  - 图片引用可能上千张，必须走 IndexedDB（配额按磁盘剩余走，通常几百 MB 起）。
 *
 * 正文里只写 `![alt](local:<id>)`，进页面时把 id 解析成 blob URL 渲染。
 *
 * ⚠️ blob URL 是页面级资源：只在本次运行内有效，
 * 因此这里维护 urlCache（id → blob URL），把越用越多的 URL 复用起来，
 * 避免同一张图重复 createObjectURL 造成内存泄漏。
 */

const DB_NAME = 'yiyan_memo_images';
const DB_VERSION = 1;
const STORE = 'images';

export interface MemoImageRecord {
  id: string;
  blob: Blob;
  createdAt: number;
}

/** id → blob URL 缓存（页面级） */
const urlCache = new Map<string, string>();
/** id → 解析中的 Promise（防止并发重复解析） */
const pending = new Map<string, Promise<string | null>>();

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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // 打开失败时不要永久缓存 rejected promise，否则后续永远拿不到
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/** 直接拿到缓存的 blob URL（同步，供渲染函数同步取用） */
export function getCachedImageUrl(id: string): string | undefined {
  return urlCache.get(id);
}

/** 生成一个短 id（时间戳 + 随机） */
function genImageId(): string {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 保存一张图片，返回它的 id */
export async function putImage(blob: Blob): Promise<string> {
  const id = genImageId();
  await tx('readwrite', store => store.put({ id, blob, createdAt: Date.now() } as MemoImageRecord));
  return id;
}

/** 取原图 blob */
export async function getImage(id: string): Promise<Blob | null> {
  try {
    const rec = await tx<MemoImageRecord | undefined>('readonly', store => store.get(id));
    return rec?.blob ?? null;
  } catch {
    return null;
  }
}

/** 删除一张图片（用于清理被正文移除的引用） */
export async function deleteImage(id: string): Promise<void> {
  try {
    await tx('readwrite', store => store.delete(id));
  } catch { /* 忽略 */ }
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/**
 * 确保某个 id 的 blob URL 已就绪（异步）。
 * 已缓存则直接返回；否则从 IndexedDB 取 blob 并 createObjectURL。
 */
export function ensureImageUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(id);
  if (inflight) return inflight;

  const task = getImage(id).then(blob => {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }).finally(() => {
    pending.delete(id);
  }) as Promise<string | null>;

  pending.set(id, task);
  return task;
}

/** 从正文里抽出所有 local: 图片 id（去重） */
export function extractLocalImageIds(content: string): string[] {
  const ids = new Set<string>();
  const re = /!\[[^\]]*\]\(local:([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) ids.add(m[1]);
  return [...ids];
}

/** 列出 IndexedDB 里所有图片 id（getAllKeys 是一次读取，比逐条 get 快得多） */
export async function getAllImageIds(): Promise<string[]> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', store => store.getAllKeys());
    return keys.map(k => String(k));
  } catch {
    return [];
  }
}

/**
 * 清理「没有被任何备忘录正文引用」的本地图片（孤儿图）。
 *
 * ⚠️ `usedIds` 必须来自**所有备忘录文档**的引用合集（外加当前正在编辑的正文），
 * 只传当前文档的话会把其它文档正在用的图片删掉。
 *
 * @returns 实际删除的数量
 */
export async function pruneUnusedImages(usedIds: Iterable<string>): Promise<number> {
  const used = new Set(usedIds);
  const all = await getAllImageIds();
  const orphans = all.filter(id => !used.has(id));
  if (orphans.length === 0) return 0;
  await Promise.all(orphans.map(id => deleteImage(id)));
  return orphans.length;
}

/**
 * 释放所有缓存的 blob URL。
 *
 * 在离开备忘录页时调用 —— blob URL 是页面级资源，不主动 revoke 的话
 * 会随着浏览的图片越来越多而一直累积（内存只增不减）。
 * 刻意**不做使用中淘汰**：一旦 revoke 掉正在渲染的图片，画面会直接变空白。
 */
export function releaseAllImageUrls(): void {
  urlCache.forEach(url => URL.revokeObjectURL(url));
  urlCache.clear();
  pending.clear();
}

/* ------------------------------------------------------------------ *
 * 图片压缩
 * ------------------------------------------------------------------ */

export interface CompressOptions {
  /** 最长边上限（px） */
  maxSize?: number;
  /** JPEG 质量 0–1 */
  quality?: number;
}

/**
 * 压缩图片：按最长边等比缩放，统一转 JPEG（白底，避免 PNG 透明变黑）。
 * - 已经比 maxSize 小、且体积不大（< 300KB）的图直接原样返回，避免无谓重编码。
 * - 动图（image/gif）不压缩（重编码会丢掉动画）。
 */
export async function compressImage(file: Blob, opts: CompressOptions = {}): Promise<Blob> {
  const { maxSize = 1600, quality = 0.82 } = opts;

  // 动图 / 非位图：原样返回
  if (!/^image\/(jpeg|png|webp|bmp)$/i.test(file.type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // 解码失败就当原图用
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const needResize = longest > maxSize;
  const smallEnough = file.size <= 300 * 1024;

  if (!needResize && smallEnough) {
    bitmap.close?.();
    return file;
  }

  const ratio = needResize ? maxSize / longest : 1;
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close?.(); return file; }

  // 白底，避免透明 PNG 转 JPEG 后出现黑块
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const out = await new Promise<Blob | null>(res =>
    canvas.toBlob(res, 'image/jpeg', quality)
  );
  if (!out) return file;

  // 压缩后反而更大（比如小尺寸 PNG）→ 用原图
  return out.size < file.size ? out : file;
}
