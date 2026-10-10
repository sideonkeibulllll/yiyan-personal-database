/**
 * 共享曝光池（v2.13.0）
 *
 * 「记忆来信」（通知）与「桌面橱窗」（小组件）共用：
 * 记录近期已安排露面的卡片，两个渠道选卡时都先避开，防止同一张卡被反复推到眼前。
 *
 * ⚠️ 归属声明：本模块是纯数据工具（localStorage 读写 + 纯函数），
 * 不依赖 UI / Capacitor；被 services/notifyService.ts 与 services/widgetService.ts 引用。
 * 键名、上限、去重窗口等常量集中在本文件，调用方禁止重复定义。
 */
/** 曝光池 localStorage 键 */
const POOL_KEY = 'yiyan_exposure_pool_v1';

/** 旧版通知历史键（v2.12.0 及以前；一次性迁移进曝光池后删除） */
const LEGACY_NOTIFY_KEY = 'yiyan_notify_history_v1';

/** 保留条数上限 */
const POOL_LIMIT = 80;

/** 去重窗口：最近 N 天内「已安排露面」的卡不再被选中 */
export const EXPOSURE_DEDUP_DAYS = 14;

/** 曝光来源渠道 */
export type ExposureSource = 'notify' | 'widget';

/** 一条曝光记录（at = 计划露面时间，可能在未来） */
export interface ExposureItem {
  id: string;
  at: number;
  source: ExposureSource;
}

export function loadExposurePool(): ExposureItem[] {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x: unknown): x is ExposureItem =>
        !!x &&
        typeof (x as ExposureItem).id === 'string' &&
        typeof (x as ExposureItem).at === 'number' &&
        ((x as ExposureItem).source === 'notify' || (x as ExposureItem).source === 'widget'),
    );
  } catch {
    return [];
  }
}

/** 追加曝光记录（自动裁剪到上限内） */
export function appendExposure(items: ExposureItem[]): void {
  if (!items.length) return;
  try {
    const pool = loadExposurePool();
    const next = [...pool, ...items].slice(-POOL_LIMIT);
    localStorage.setItem(POOL_KEY, JSON.stringify(next));
  } catch {
    /* 存储失败忽略 */
  }
}

/** 最近 inDays 天内已安排露面的卡片 id 集合（去重窗口见 EXPOSURE_DEDUP_DAYS） */
export function recentlyExposedIds(now: number, days = EXPOSURE_DEDUP_DAYS): Set<string> {
  const cutoff = now - days * 86_400_000;
  return new Set(loadExposurePool().filter(x => x.at >= cutoff).map(x => x.id));
}

/**
 * 一次性迁移：旧版通知历史（yiyan_notify_history_v1）→ 曝光池。
 * 幂等：迁移后删除旧键；无旧键时零开销。
 */
export function migrateLegacyNotifyHistory(): void {
  try {
    const raw = localStorage.getItem(LEGACY_NOTIFY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      const items: ExposureItem[] = arr
        .filter((x: unknown) => !!x && typeof (x as { id?: unknown }).id === 'string' && typeof (x as { at?: unknown }).at === 'number')
        .map((x: { id: string; at: number }) => ({ id: x.id, at: x.at, source: 'notify' as const }));
      appendExposure(items);
    }
    localStorage.removeItem(LEGACY_NOTIFY_KEY);
  } catch {
    /* 迁移失败不阻塞主流程（旧键保留，下次再试） */
  }
}
