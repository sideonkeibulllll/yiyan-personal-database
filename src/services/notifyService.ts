/**
 * 记忆来信 · 主动触达服务（唯一门面，v2.12.0）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  对外契约（所有外部引用必须从本文件走，禁止绕过门面直连插件或内部函数）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 被引用的位置与用途：
 *  - App.tsx          → ensureScheduled()   启动补缺续排（数据就绪后延迟触发）
 *                       subscribeTap()     点击通知 → 跳卡片浏览页
 *  - NotifyPanel.tsx  → isNotifySupported() / getNotifyPermission() / requestNotifyPermission()
 *                       applySettings()    配置变更（全清重排）
 *                       testFireOnce()     「立即试一发」
 *                       cancelAll()        关闭开关时清空排程
 *                       getExactAlarmSetting() / openExactAlarmSetting()  精确闹钟引导
 *
 * 模块边界：
 *  - 只依赖：@capacitor/local-notifications、settingsStore、entryStore、database、utils/notifyPlan
 *  - UI 层只通过 settingsStore.updateNotifyConfig 写配置；排程全在本模块内完成
 *  - 未来扩展（AI 写信、时间胶囊、待办提醒）在本文件追加导出，常量统一进「模块常量」区
 *
 * 排程模型（与 utils/notifyPlan.ts 的约定）：
 *  - 预排未来 NOTIFY_PLAN_DAYS 天；日常打开 App 走「补缺」（只补没有排程的天）
 *  - 配置变更（开关 / 窗口 / 条数）走 applySettings → 全清重排
 *  - 选卡：复用随机页的加权随机（星标 / 近期使用加权）；
 *    并避开「共享曝光池」（utils/exposurePool.ts）中最近露面的卡
 *    —— 该池与桌面橱窗（widgetService）共用，防止同一张卡在两个渠道被反复推
 *  - 通知标题的天数按「投递时刻」计算（排程时已知），因此不存在快照误差
 */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEntryStore } from '@/stores/entryStore';
import { getDatabase } from '@/services/database';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { resolveTimeRange } from '@/utils/timeRangeFilter';
import { isFilterActive } from '@/utils/entryFilterState';
import {
  computeMissingDays,
  makeNotificationId,
  makeReunionTitle,
  pickSlotsForDay,
  toDayKey,
} from '@/utils/notifyPlan';
// 共享曝光池（v2.13.0）：与桌面橱窗共用，防止同一张卡在两个渠道被反复推
import { appendExposure, migrateLegacyNotifyHistory, recentlyExposedIds } from '@/utils/exposurePool';
import type { ExposureItem } from '@/utils/exposurePool';
import type { Entry, NotifySettings } from '@/types';

/* ═══════════════ 模块常量（集中声明；调用方禁止重复定义） ═══════════════ */

/** Android 通知渠道 id（「记忆来信」专用，用户可在系统里单独调它的打扰级别） */
export const NOTIFY_CHANNEL_ID = 'yiyan_reunion';

/** 通知正文最大字数（超出以「…」截断；真机显示效果不佳时在此调整） */
const BODY_MAX = 50;

/* ═══════════════ 对外类型 ═══════════════ */

/** 通知权限状态（'unsupported' = 当前平台不支持，如 Web / Electron） */
export type NotifyPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** 一次排程执行的结果报告 */
export interface ScheduleReport {
  /** 本次新排的通知条数 */
  scheduled: number;
  /** 可投递的卡片池大小 */
  poolSize: number;
  /**
   * v2.14.0：筛选条件把候选池筛空了（有卡，但没有一张符合筛选）。
   * 调用方据此给出明确提示，而不是「静默降级为全量投递」。
   */
  poolFilteredEmpty?: boolean;
}

/* ═══════════════ 平台判断 ═══════════════ */

/** 当前平台是否支持本地通知（仅 Android 原生；Web / Electron 走降级提示） */
export function isNotifySupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/* ═══════════════ 权限 ═══════════════ */

/** 查询通知权限状态 */
export async function getNotifyPermission(): Promise<NotifyPermission> {
  if (!isNotifySupported()) return 'unsupported';
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') return 'granted';
    if (status.display === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

/** 请求通知权限（应在用户手势中调用，如开关点击） */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!isNotifySupported()) return false;
  try {
    const status = await LocalNotifications.requestPermissions();
    return status.display === 'granted';
  } catch {
    return false;
  }
}

/** 查询「精确闹钟」系统设置（Android 12+；无此权限时排程自动降级为不精确，不阻塞投递） */
export async function getExactAlarmSetting(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isNotifySupported()) return 'unsupported';
  try {
    const s = await LocalNotifications.checkExactNotificationSetting();
    return s.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** 跳转系统「精确闹钟」授权页（可选操作） */
export async function openExactAlarmSetting(): Promise<void> {
  if (!isNotifySupported()) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch {
    /* 用户取消或系统不支持 —— 忽略 */
  }
}

/* ═══════════════ 排程 ═══════════════ */

/**
 * 日常续排：补缺式（只补「未来 NOTIFY_PLAN_DAYS 天内没有排程的天」，
 * 不重排已有排程，避免一天收到多条）。
 * 由 App 启动后台任务调用；未开启 / 未授权时静默返回。
 */
export async function ensureScheduled(): Promise<void> {
  if (!isNotifySupported()) return;
  const cfg = useSettingsStore.getState().settings.notify;
  if (!cfg?.enabled) return;
  const perm = await getNotifyPermission();
  if (perm !== 'granted') return;
  try {
    await scheduleUpcoming(cfg, false);
  } catch (e) {
    console.warn('[notify] 续排失败:', e);
  }
}

/**
 * 应用配置变更：全清已有排程后重排（窗口 / 条数 / 开关变化时调用）。
 * 开启但无权限时返回引导文案，由面板展示。
 */
export async function applySettings(): Promise<{ ok: boolean; message: string }> {
  if (!isNotifySupported()) {
    return { ok: false, message: '当前设备不支持记忆来信（仅安卓端）' };
  }
  const cfg = useSettingsStore.getState().settings.notify;

  if (!cfg?.enabled) {
    await cancelAll();
    return { ok: true, message: '已关闭，排程已清空' };
  }

  let perm = await getNotifyPermission();
  if (perm === 'prompt') {
    const granted = await requestNotifyPermission();
    if (!granted) perm = 'denied';
    else perm = 'granted';
  }
  if (perm !== 'granted') {
    return { ok: false, message: '需要通知权限才能投递，请先在系统设置中允许' };
  }

  try {
    const report = await scheduleUpcoming(cfg, true);
    if (report.poolFilteredEmpty) {
      return { ok: false, message: '「来信候选范围」筛得太窄了，没有一张卡符合条件' };
    }
    if (report.scheduled === 0) {
      return { ok: true, message: '已开启；今天的时间窗口已过，明天开始投递' };
    }
    return { ok: true, message: `已安排未来几天的来信（${report.scheduled} 条）` };
  } catch (e) {
    console.warn('[notify] 重排失败:', e);
    return { ok: false, message: '排程失败，请稍后重试' };
  }
}

/**
 * 立即试一发：3 秒后投递一张随机卡（不写入投递历史，预览用）。
 */
export async function testFireOnce(): Promise<{ ok: boolean; message: string }> {
  if (!isNotifySupported()) {
    return { ok: false, message: '当前设备不支持记忆来信（仅安卓端）' };
  }
  let perm = await getNotifyPermission();
  if (perm === 'prompt') {
    const granted = await requestNotifyPermission();
    perm = granted ? 'granted' : 'denied';
  }
  if (perm !== 'granted') {
    return { ok: false, message: '需要通知权限，请先在系统设置中允许' };
  }

  const pool = await loadFilteredPool();
  if (pool === null) {
    return { ok: false, message: '「来信候选范围」里没有符合条件的卡，先放宽筛选' };
  }
  if (pool.length === 0) {
    return { ok: false, message: '抽屉里还没有卡片，先存一条再来试' };
  }
  const picked = weightedRandomSelect(pool);
  if (!picked) return { ok: false, message: '抽取失败，请重试' };

  try {
    await ensureChannel();
    const at = Date.now() + 3000;
    await LocalNotifications.schedule({
      notifications: [buildNotification(picked, at, toDayKey(at), 0)],
    });
    return { ok: true, message: '3 秒后见——留意通知栏' };
  } catch (e) {
    console.warn('[notify] 试发失败:', e);
    return { ok: false, message: '投递失败，请检查系统通知设置' };
  }
}

/** 清空全部待投递的通知（关闭开关 / 重置时调用） */
export async function cancelAll(): Promise<void> {
  if (!isNotifySupported()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const list = pending.notifications || [];
    if (list.length > 0) {
      await LocalNotifications.cancel({
        notifications: list.map(n => ({ id: n.id })),
      });
    }
  } catch (e) {
    console.warn('[notify] 清空排程失败:', e);
  }
}

/**
 * 订阅「点击通知」事件：回调收到目标卡片 id。
 * 冷启动亦可靠（框架在 onCreate 即把启动意图递给插件，事件保留至监听注册）。
 * 返回取消订阅函数（组件卸载时调用）。
 */
export async function subscribeTap(handler: (entryId: string) => void): Promise<() => void> {
  if (!isNotifySupported()) return () => {};
  try {
    const handle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action) => {
        try {
          const extra = (action?.notification as { extra?: unknown } | undefined)?.extra as
            | { entryId?: unknown }
            | undefined;
          const entryId = extra?.entryId;
          if (typeof entryId === 'string' && entryId) handler(entryId);
        } catch {
          /* 载荷异常时忽略 */
        }
      },
    );
    return () => {
      void handle.remove();
    };
  } catch (e) {
    console.warn('[notify] 订阅点击事件失败:', e);
    return () => {};
  }
}

/* ═══════════════ 内部实现 ═══════════════ */

/**
 * 候选池 · 加「来信候选筛选」（v2.14.0）
 *
 * 语义与随机页筛选完全一致（services/random.filterEntries）：
 * 标签（任一命中）/ 星标三态 / 时间（按修改时间闭区间）。
 * ⚠️ 筛选后池空 → 返回 null（调用方给出明确提示，而不是静默退化为全量投递）。
 */
async function loadFilteredPool(): Promise<Entry[] | null> {
  const all = await loadPoolEntries();
  if (all.length === 0) return [];
  const cfg = useSettingsStore.getState().settings.notify;
  if (!cfg?.filter || !isFilterActive(cfg.filter)) return all;
  const filtered = filterEntries(all, {
    tagIds: cfg.filter.tagIds.length > 0 ? cfg.filter.tagIds : undefined,
    isStarred: cfg.filter.starred,
    ...resolveTimeRange(cfg.filter.timeRange),
  });
  return filtered.length > 0 ? filtered : null;
}

/** 候选卡片池：优先用 store 已加载的条目；为空时从数据库全量兜底 */
async function loadPoolEntries(): Promise<Entry[]> {
  const fromStore = useEntryStore.getState().entries;
  if (fromStore.length > 0) return fromStore;
  try {
    const db = await getDatabase();
    return await db.getAllEntries();
  } catch {
    return [];
  }
}

/** 创建通知渠道（幂等：同 id 重复创建无副作用） */
async function ensureChannel(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: NOTIFY_CHANNEL_ID,
      name: '记忆来信',
      description: '被冷落的记忆，自己来敲门',
      // 3 = 默认级别：有声音 + 状态栏可见，但不弹横幅（克制，用户可在系统里调高）
      importance: 3,
      visibility: 1,
    });
  } catch {
    /* 渠道已存在或系统不支持时忽略 */
  }
}

/** 通知正文：卡片内容原文，超出截断加「…」；纯图片卡走兜底文案 */
function makeBody(entry: Entry): string {
  const text = (entry.content || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return entry.attachments && entry.attachments.length > 0
      ? '（一张图片记忆，点开看看）'
      : '（一条空白的记忆）';
  }
  return text.length > BODY_MAX ? `${text.slice(0, BODY_MAX)}…` : text;
}

/** 构建单条通知（schedule.at 必须为未来时间，否则插件会直接丢弃） */
function buildNotification(
  entry: Entry,
  at: number,
  dayKey: string,
  slotIndex: number,
): LocalNotificationSchema {
  return {
    id: makeNotificationId(entry.id, dayKey, slotIndex),
    title: makeReunionTitle(entry.createdAt, at),
    body: makeBody(entry),
    schedule: { at: new Date(at), allowWhileIdle: true },
    channelId: NOTIFY_CHANNEL_ID,
    extra: { kind: 'reunion', entryId: entry.id, dayKey },
  };
}

/**
 * 排程核心：按「补缺」或「全清重排」两种模式，安排未来几天的投递。
 */
async function scheduleUpcoming(
  cfg: NotifySettings,
  replaceAll: boolean,
): Promise<ScheduleReport> {
  const empty: ScheduleReport = { scheduled: 0, poolSize: 0 };

  const pendingRes = await LocalNotifications.getPending();
  const pending = pendingRes.notifications || [];

  if (replaceAll && pending.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.map(n => ({ id: n.id })) });
  }

  // 已排程的日期集合（按天粒度补缺）
  const pendingDays = new Set<string>();
  if (!replaceAll) {
    for (const n of pending) {
      const dayKey = (n.extra as { dayKey?: unknown } | undefined)?.dayKey;
      if (typeof dayKey === 'string' && dayKey) pendingDays.add(dayKey);
    }
  }

  const now = Date.now();
  const missingDays = computeMissingDays(now, pendingDays);

  // 候选池（v2.14.0：含「来信候选筛选」；筛空 → 明确回报，不静默退化）
  const filteredPool = await loadFilteredPool();
  if (filteredPool === null) {
    return { ...empty, poolFilteredEmpty: true };
  }
  const entries = filteredPool;
  if (entries.length === 0) return empty;

  // 去重：避开曝光池中最近露面的卡（与桌面橱窗共享；池子不足时放宽为全量）
  migrateLegacyNotifyHistory();
  const recentlyExposed = recentlyExposedIds(now);
  let pool = entries.filter(e => !recentlyExposed.has(e.id));
  if (pool.length === 0) pool = entries;

  // 选卡：复用加权随机；本轮内不重复（卡池不足时循环复用整池）
  const usedThisRun = new Set<string>();
  const pickFor = (): Entry | null => {
    let candidates = pool.filter(e => !usedThisRun.has(e.id));
    if (candidates.length === 0) {
      usedThisRun.clear();
      candidates = pool;
    }
    if (candidates.length === 0) return null;
    const picked = weightedRandomSelect(candidates);
    if (picked) usedThisRun.add(picked.id);
    return picked;
  };

  const notifications: LocalNotificationSchema[] = [];
  const newExposure: ExposureItem[] = [];
  for (const day of missingDays) {
    const slots = pickSlotsForDay(day.dayStart, cfg, now);
    for (let i = 0; i < slots.length; i++) {
      const entry = pickFor();
      if (!entry) break;
      notifications.push(buildNotification(entry, slots[i], day.dayKey, i));
      newExposure.push({ id: entry.id, at: slots[i], source: 'notify' });
    }
  }

  if (notifications.length === 0) return empty;

  await ensureChannel();
  await LocalNotifications.schedule({ notifications });
  appendExposure(newExposure);

  return { scheduled: notifications.length, poolSize: pool.length };
}
