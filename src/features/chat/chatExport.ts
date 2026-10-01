/**
 * 对话导出为图片（html2canvas 截取实际 DOM）
 *
 * 调用方负责处理导出前后的 UI 状态（loading、选中模式等）。
 */
import html2canvas from 'html2canvas';

/**
 * 将容器内选中的消息导出为图片（移动端优先系统分享，否则下载）。
 * 数据来源为容器内 .chat-message[data-msg-id] 节点。
 */
export async function exportMessagesToImage(container: HTMLElement, selectedIds: Set<string>): Promise<void> {
  // 收集选中的消息 DOM 节点
  const allMsgEls = Array.from(container.querySelectorAll<HTMLElement>('.chat-message'));
  const selectedEls = allMsgEls.filter(el => selectedIds.has(el.dataset.msgId || ''));
  if (selectedEls.length === 0) {
    alert('未找到选中的消息');
    return;
  }

  // 构造一个临时容器，克隆选中的消息节点，用于截图
  // 这样可以避免截取整个滚动区域，且只包含选中内容
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${container.offsetWidth}px;
    padding: 24px;
    background: var(--color-bg-primary, #131416);
    box-sizing: border-box;
  `;
  // 顶部标题
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; gap: 8px;
    padding-bottom: 14px; margin-bottom: 20px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 12px; color: #868e96;
    font-family: 'Inter', 'Noto Sans SC', sans-serif;
  `;
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  header.innerHTML = `
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f76707;"></span>
    <span style="font-weight:600;color:#adb5bd;">记忆库 · AI 对话</span>
    <span style="margin-left:auto;font-size:11px;color:#495057;">${dateStr}</span>
  `;
  wrapper.appendChild(header);

  // 克隆每条选中的消息（移除选中圆圈等装饰）
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:20px;';
  for (const el of selectedEls) {
    const clone = el.cloneNode(true) as HTMLElement;
    // 移除选中圆圈
    clone.querySelectorAll('.msg-select-checkbox').forEach(n => n.remove());
    // 移除时间戳（可选，保留也行）
    list.appendChild(clone);
  }
  wrapper.appendChild(list);

  // 底部水印
  const footer = document.createElement('div');
  footer.style.cssText = `
    margin-top: 24px; padding-top: 14px;
    border-top: 1px solid rgba(255,255,255,0.08);
    text-align: right; font-size: 11px; color: #495057;
    font-family: 'Inter', 'Noto Sans SC', sans-serif;
  `;
  footer.textContent = '由 记忆库 导出';
  wrapper.appendChild(footer);

  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper, {
      backgroundColor: '#131416',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const dataUrl = canvas.toDataURL('image/png');

    const filename = `对话_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.png`;

    // 移动端优先系统分享，否则下载
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: 'image/png' });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
    };
    let shared = false;
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: '记忆库 · AI 对话', text: '记忆库 · AI 对话' });
        shared = true;
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // 用户取消分享，不下载
          shared = true;
        }
      }
    }
    if (!shared) {
      // 回退下载
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } finally {
    document.body.removeChild(wrapper);
  }
}