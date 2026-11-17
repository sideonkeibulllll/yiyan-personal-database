/**
 * Chat 后台流式运行时（v3.6.4）
 *
 * 问题：对话的流式请求写在 ChatPage 组件里。用户切走（去文件库/待办/设置）时
 * 组件卸载，虽然 fetch 不会自动断，但界面收不到任何更新 —— 回来时看到的是
 * 「半截回复」，很容易以为回复被中断了，于是不敢离开。
 *
 * 方案：把「有没有一条流在跑」放到模块级单例里，页面只订阅它：
 * - 离开页面：流继续跑，落库照旧（写库调度器不依赖组件）
 * - 回到页面：立刻知道「还在生成」，显示提示并禁止在同一会话里重复发送
 * - 流结束：广播一次，挂载中的页面自动重读会话，把最终内容刷出来
 *
 * 刻意不接管流本身（不做全局 store）—— ChatPage 的 agent loop 状态太多，
 * 搬出去风险远大于收益；这里只解决「用户感知」和「重复发送」两件事。
 */

export interface ActiveChatStream {
  /** 正在生成回复的会话 id */
  sessionId: string;
  /** 开始时间（毫秒） */
  startedAt: number;
  /** 让用户能在这里按停（和输入区的停止按钮同一个 abort） */
  abort: () => void;
}

type Listener = (stream: ActiveChatStream | null) => void;

let active: ActiveChatStream | null = null;
const listeners = new Set<Listener>();

export function getActiveChatStream(): ActiveChatStream | null {
  return active;
}

export function setActiveChatStream(next: ActiveChatStream | null): void {
  active = next;
  listeners.forEach(listener => {
    try { listener(active); } catch { /* 单个订阅者出错不影响别人 */ }
  });
}

/** 订阅流状态变化；返回取消订阅函数 */
export function subscribeChatStream(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
