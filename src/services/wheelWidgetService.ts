/**
 * 转盘小组件 · 服务门面（v2.14.0）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  对外契约（所有外部引用必须从本文件走，禁止绕过门面直连插件或内部函数）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 被引用的位置与用途：
 *  - App.tsx       → syncWheelWidgets() / consumePendingSpinResult()
 *                    启动后台同步盘序 + 补写原生「转动」的结果
 *  - WheelPage.tsx → syncWheelWidgets()（转动 / 增删盘后同步盘序）
 *
 * 数据流：
 *  打开 App / 转动过盘 → 组装盘序（MRU 在前 + 其余按 updatedAt）
 *   → YiyanWidget.setWheelPlan() 写入 SharedPreferences
 *   → 原生「换」按盘序切换、「转动」从选项快照加权抽选（不依赖 App 常驻）
 *   → 转动结果写 prefs `wheel_pending_result_json`
 *   → App 下次启动 consumePendingSpinResult() 补写 history + MRU
 *
 * 模块边界：
 *  - 依赖：registerPlugin('YiyanWidget')、wheelDatabase、utils/wheelRecent、
 *          utils/wheelWidgetPlan
 *  - 原生实现：android/app/src/main/java/com/yiyan/memorydb/widget/WheelWidget.kt
 *    （JSON 结构与键名与其对齐；改结构必须两边同步）
 *  - 复用：与记忆卡片 / 待办橱窗共用同一个原生桥 YiyanWidget（WidgetBridgePlugin.kt）
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getAllWheels, saveWheel, getWheel } from '@/services/wheelDatabase';
import { getWheelRecent, pushWheelRecent, sortWheelsByRecent } from '@/utils/wheelRecent';
import {
  assembleWheelPlan,
  isValidWheelPlan,
  isValidPendingResult,
} from '@/utils/wheelWidgetPlan';
import type { WheelWidgetPlan, WheelPendingResult } from '@/utils/wheelWidgetPlan';
import type { WheelHistoryItem } from '@/types';

/* ═══════════════ 原生桥（与 WidgetBridgePlugin.kt 对齐） ═══════════════ */

interface YiyanWidgetPlugin {
  /** 写入展示计划（JSON 字符串），触发全部橱窗刷新 + 展示游标复位 */
  setPlan(options: { plan: string }): Promise<void>;
  getPlan(): Promise<{ plan: string | null }>;
  setTodo(options: { snapshot: string }): Promise<void>;
  getTodo(): Promise<{ snapshot: string | null }>;
  /** 写入转盘计划（JSON 字符串），触发转盘橱窗刷新 */
  setWheelPlan(options: { plan: string }): Promise<void>;
  getWheelPlan(): Promise<{ plan: string | null }>;
  /** 读取并清空「原生转动结果」（App 补写 history 用；无则 pending 为 null） */
  takeWheelResult(): Promise<{ pending: string | null }>;
  getStatus(): Promise<{ baseCount: number; refreshCount: number; todoCount: number; wheelCount: number }>;
  refreshAll(): Promise<void>;
}

const YiyanWidget = registerPlugin<YiyanWidgetPlugin>('YiyanWidget');

/** 原生桥是否可能缺失该新方法（旧版 APK 降级为 no-op，不崩） */
function hasWheelBridge(): boolean {
  return typeof (YiyanWidget as unknown as { setWheelPlan?: unknown })?.setWheelPlan === 'function';
}

/* ═══════════════ 对外接口 ═══════════════ */

/** 当前平台是否支持转盘小组件（仅 Android 原生） */
export function isWheelWidgetSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/** 同步结果报告 */
export interface WheelSyncReport {
  ok: boolean;
  message: string;
  /** 下发的盘数量 */
  wheels: number;
}

/**
 * 同步转盘盘序到原生（App 启动 / 转动 / 增删盘后调用）：
 * - 盘序 = MRU（最近转动过的在前，最多 5）+ 其余按 updatedAt 倒序
 * - 每盘附带选项快照（原生据此加权抽选，不依赖 App 常驻）
 */
export async function syncWheelWidgets(): Promise<WheelSyncReport> {
  if (!isWheelWidgetSupported()) {
    return { ok: false, message: '转盘小组件仅在安卓端可用', wheels: 0 };
  }
  if (!hasWheelBridge()) {
    return { ok: false, message: '当前版本暂不支持转盘小组件', wheels: 0 };
  }
  try {
    const all = await getAllWheels();
    if (all.length === 0) {
      return { ok: false, message: '还没有转盘', wheels: 0 };
    }
    const ordered = sortWheelsByRecent(all, getWheelRecent());
    const plan = assembleWheelPlan(ordered, Date.now());
    await YiyanWidget.setWheelPlan({ plan: JSON.stringify(plan) });
    return { ok: true, message: `已同步 ${plan.wheels.length} 个转盘`, wheels: plan.wheels.length };
  } catch (e) {
    console.warn('[wheelWidget] 同步失败:', e);
    return { ok: false, message: '转盘同步失败', wheels: 0 };
  }
}

/** 读取当前已下发的转盘计划（设置面板 / 调试用） */
export async function getWheelWidgetPlan(): Promise<WheelWidgetPlan | null> {
  if (!isWheelWidgetSupported() || !hasWheelBridge()) return null;
  try {
    const res = await YiyanWidget.getWheelPlan();
    if (!res?.plan) return null;
    const parsed = JSON.parse(res.plan);
    return isValidWheelPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 消费原生「转动」结果（App 启动时调用一次）：
 * 原生转动写 prefs → 此处取出 → 补写该盘的 history（保留 5 条）+ MRU → 清空。
 * 返回是否消费到了结果（调用方据此决定是否刷新界面）。
 */
export async function consumePendingSpinResult(): Promise<boolean> {
  if (!isWheelWidgetSupported() || !hasWheelBridge()) return false;
  try {
    const res = await YiyanWidget.takeWheelResult();
    if (!res?.pending) return false;
    const parsed = JSON.parse(res.pending);
    if (!isValidPendingResult(parsed)) return false;
    const r: WheelPendingResult = parsed;

    const wheel = await getWheel(r.wheelId);
    if (!wheel) return true; // 盘已删，结果作废

    const item: WheelHistoryItem = { text: r.text, time: r.at, index: r.index };
    const nextHistory = [item, ...wheel.history].slice(0, 5);
    await saveWheel({ ...wheel, history: nextHistory });
    // 转动才算使用 → 记 MRU
    pushWheelRecent(wheel.id);
    // 盘序可能变化 → 回写一次
    void syncWheelWidgets();
    return true;
  } catch (e) {
    console.warn('[wheelWidget] 消费转动结果失败:', e);
    return false;
  }
}
