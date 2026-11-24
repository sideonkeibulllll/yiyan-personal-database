/**
 * 作品内页面浏览记录（v4.0.0）
 *
 * 目录页是打包时生成的静态 html，它自己不知道用户看过什么。
 * 所以由宿主记最近访问的页面，渲染目录页时再注入一条「继续上次」。
 *
 * 存的量很小：每个作品最多 8 条，只用来回显最近两页。
 */
const KEY = 'yiyan_work_recent_v1';
const MAX_PER_WORK = 8;

export interface RecentPage {
  path: string;
  at: number;
}

type Store = Record<string, RecentPage[]>;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* 存不进去不影响浏览 */
  }
}

/** 最近访问的页面，最新的在前 */
export function listRecentPages(work: string): RecentPage[] {
  const list = loadStore()[work];
  if (!Array.isArray(list)) return [];
  return list.filter(item => item && typeof item.path === 'string' && typeof item.at === 'number');
}

/** 记一次访问：去重后提到最前 */
export function rememberPage(work: string, path: string): void {
  const target = (path || '').trim();
  if (!work || !target) return;
  const store = loadStore();
  const list = (store[work] ?? []).filter(item => item.path !== target);
  list.unshift({ path: target, at: Date.now() });
  store[work] = list.slice(0, MAX_PER_WORK);
  saveStore(store);
}

/** 作品被删除时清掉痕迹 */
export function forgetWorkRecent(work: string): void {
  const store = loadStore();
  if (!(work in store)) return;
  delete store[work];
  saveStore(store);
}
