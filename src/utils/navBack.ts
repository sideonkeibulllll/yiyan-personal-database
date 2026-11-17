/**
 * 返回上一页（v3.6.9）
 *
 * 为什么不直接 `navigate(-1)`：深度链接（直接打开 #/files/xxx）没有上一页，
 * 退回会离开应用。React Router 会给每条历史记录打 `idx`，用它可以判断
 * 「有没有真实的上一页」，没有就回落到指定页面。
 *
 * 注意：一律走 -1（pop）而不是 push 目标页 —— 否则「查看页 → 管理器 → 返回」
 * 会又弹回查看页，来回打架喵。
 */
import type { NavigateFunction } from 'react-router-dom';

export function goBack(navigate: NavigateFunction, fallback: string): void {
  const state = window.history.state as { idx?: number } | null;
  const idx = typeof state?.idx === 'number' ? state.idx : 0;
  if (idx > 0) {
    navigate(-1);
  } else {
    navigate(fallback, { replace: true });
  }
}
