/**
 * 聊天区选区守卫（v4.2.6）
 *
 * 现象（安卓 WebView）：
 *   长按选词是正常的（只有那一个词）。但拖动手柄扩选的过程中，选区会突然
 *   变成「从对话第一句开始」的整轮内容 —— 表现是拖动中途系统不再弹「复制」，
 *   此时点复制就是几万字全文。
 *
 * 原因：
 *   手柄拖到段落间隙/消息间隙时，浏览器要把屏幕坐标换算成 DOM 位置，而
 *   .chat-messages 整块原本是可选根，换算结果就落到了容器边界 offset 0
 *   （= 第一条消息之前）。锚点被拉到那里，整个对话自然都被圈进来。
 *
 * 处理：
 *   1. CSS（ChatPage.css）把容器与气泡间距设为不可选 —— 这是根因修复，
 *      容器不再是可选根，坐标换算不会再落到容器边界；
 *   2. 本文件是兜底：万一选区端点还是落到了容器本身、或长度逼近整轮，
 *      立刻回滚到上一次正常选区，绝不让整轮进入剪贴板。
 */

/** 长度逼近整轮时判定为「跑飞」的下限（字） */
const RUNAWAY_MIN_CHARS = 4000;
/** 相对整轮文本的占比阈值 */
const RUNAWAY_RATIO = 0.95;

export function installChatSelectionGuard(container: HTMLElement): () => void {
  /** 上一次「正常」的选区（长度合理、端点落在正文里） */
  let lastGood: Range | null = null;
  /** 正在回滚，忽略本次 selectionchange，避免自己触发自己 */
  let fixing = false;

  // 整轮文本长度对 selectionchange 来说太贵（拖动时一秒几十次），做秒级缓存
  let cachedTotal = 0;
  let cachedAt = 0;
  const totalLength = () => {
    const now = Date.now();
    if (now - cachedAt > 1000) {
      cachedTotal = container.textContent?.length ?? 0;
      cachedAt = now;
    }
    return cachedTotal;
  };

  const handle = () => {
    if (fixing) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const insideStart = container.contains(range.startContainer);
    const insideEnd = container.contains(range.endContainer);
    if (!insideStart && !insideEnd) return;

    // ① 端点落在容器元素本身：正是「从第一句开始」的那个病
    const poisoned =
      range.startContainer === container || range.endContainer === container;

    // ② 长度逼近整轮：拖太远/滚动导致端点跑飞
    const len = sel.toString().length;
    const total = totalLength();
    const runaway =
      total > 0 && len > Math.max(RUNAWAY_MIN_CHARS, total * RUNAWAY_RATIO);

    if (poisoned || runaway) {
      fixing = true;
      try {
        sel.removeAllRanges();
        if (
          lastGood &&
          container.contains(lastGood.startContainer) &&
          container.contains(lastGood.endContainer)
        ) {
          sel.addRange(lastGood);
        }
      } finally {
        // 让本次 selectionchange 派发完再解除，否则会被自己的修改再次触发
        window.setTimeout(() => {
          fixing = false;
        }, 0);
      }
      return;
    }

    lastGood = range.cloneRange();
  };

  document.addEventListener('selectionchange', handle);
  return () => document.removeEventListener('selectionchange', handle);
}
