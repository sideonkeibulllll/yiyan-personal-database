/**
 * 备忘录数据变更广播事件（轻量模块，避免引入 chatBridge 的重依赖）。
 *
 * 备忘录是纯 localStorage 存储，AI 通过 chat 的备忘录 MCP 改动后，
 * 广播此事件让 MemoPage 等刷新列表。
 */
export const MEMOS_CHANGED_EVENT = 'yiyan:memos-changed';

export function broadcastMemosChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(MEMOS_CHANGED_EVENT));
  } catch { /* 忽略 */ }
}
