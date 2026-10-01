/**
 * 转盘音效与震动（v2.3.0）
 *
 * 用 Web Audio API 现场合成音效，不依赖任何 mp3 资源文件：
 * - 旋转开始：短促"嗒"声（方波，快速衰减）
 * - 出结果：上扬"叮"声（正弦 + 泛音，衰减更长）
 *
 * 震动走 @capacitor/haptics（原生）或 navigator.vibrate（Web 降级），
 * 任何一步失败都静默忽略，绝不影响主流程。
 */
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

let _ctx: AudioContext | null = null;

/** 惰性创建 AudioContext（必须在用户手势后创建，否则被浏览器挂起） */
function getCtx(): AudioContext | null {
  try {
    if (!_ctx) {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      _ctx = new Ctor();
    }
    const ctx = _ctx;
    if (!ctx) return null;
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 播放一个简单的合成音 */
function beep(freq: number, durationMs: number, type: OscillatorType, gainPeak: number) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch { /* 忽略 */ }
}

/** 震动（原生优先，Web 降级） */
async function vibrate(style: 'light' | 'heavy') {
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: style === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light });
    } else if (navigator.vibrate) {
      navigator.vibrate(style === 'heavy' ? 40 : 12);
    }
  } catch { /* 忽略 */ }
}

/** 开始旋转：轻震动 + 短嘀声 */
export async function playSpinStart(): Promise<void> {
  beep(880, 90, 'square', 0.10);
  await vibrate('light');
}

/** 出结果：重震动 + 上扬双音 */
export async function playSpinEnd(): Promise<void> {
  beep(1046, 140, 'sine', 0.16);
  setTimeout(() => beep(1568, 260, 'sine', 0.13), 90);
  await vibrate('heavy');
}

/** 轻点反馈（添加/删除选项等） */
export async function playTap(): Promise<void> {
  beep(660, 50, 'square', 0.06);
  if (Capacitor.isNativePlatform()) {
    try { await Haptics.notification({ type: NotificationType.Success }); } catch { /* 忽略 */ }
  }
}
