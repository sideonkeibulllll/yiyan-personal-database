/**
 * 备忘录 Markdown 工具（v2.3.0）
 *
 * - extractHeadings：抽取所有 # 标题（行号 + 层级 + 文字），用于大纲与锚点定位
 * - 标题采用「纯文本锚点」：记录标题文字，重新进入时按文字查找对应行并滚动
 */

export interface MemoHeading {
  /** 行号（0 基） */
  line: number;
  /** 层级 1–6 */
  level: number;
  /** 标题文字（不含 #） */
  text: string;
}

/** 抽取所有标题 */
export function extractHeadings(content: string): MemoHeading[] {
  const lines = content.split('\n');
  const out: MemoHeading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过代码块内部的伪标题
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** 从正文推断标题（取第一个 # 标题，没有则用首行） */
export function deriveTitle(content: string): string {
  const headings = extractHeadings(content);
  if (headings.length > 0) return headings[0].text.slice(0, 30);
  const first = content.split('\n').find(l => l.trim());
  return first ? first.trim().slice(0, 30) : '未命名';
}

/**
 * 在纯文本（textarea）中，找出光标所在的标题。
 * 规则：向上找最近的 # 标题行；若光标就在标题行上，返回该标题。
 */
export function findHeadingAtCursor(content: string, selectionStart: number): string | null {
  const before = content.slice(0, selectionStart);
  const lineIndex = before.split('\n').length - 1;
  const headings = extractHeadings(content);
  let found: MemoHeading | null = null;
  for (const h of headings) {
    if (h.line <= lineIndex) found = h;
    else break;
  }
  return found ? found.text : null;
}

/** 计算某一行的起始字符偏移（0 基行号）。用于「跳上一个/下一个标题」。 */
export function offsetOfLine(content: string, line: number): number {
  const lines = content.split('\n');
  const clamped = Math.max(0, Math.min(line, Math.max(lines.length - 1, 0)));
  let offset = 0;
  for (let i = 0; i < clamped; i++) offset += lines[i].length + 1;
  return offset;
}

/** 计算某个标题在正文中的字符偏移（用于 textarea 光标定位） */
export function offsetOfHeading(content: string, anchorText: string): number | null {
  const headings = extractHeadings(content);
  const hit = headings.find(h => h.text === anchorText);
  if (!hit) return null;
  return offsetOfLine(content, hit.line);
}

/** 简易 Markdown 渲染（预览用，独立于 utils/markdown.ts） */
export function renderMemoMarkdown(src: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (text: string): string => {
    let r = escape(text);
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    r = r.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" />');
    r = r.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    r = r.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    r = r.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return r;
  };

  const lines = src.split('\n');
  const html: string[] = [];
  let inFence = false;
  let fenceBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) { html.push(`</${listType}>`); listType = null; }
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) { closeList(); inFence = true; fenceBuf = []; }
      else { inFence = false; html.push(`<pre><code>${escape(fenceBuf.join('\n'))}</code></pre>`); }
      continue;
    }
    if (inFence) { fenceBuf.push(line); continue; }

    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      closeList();
      const lv = h[1].length;
      html.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      closeList();
      html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      html.push('<hr />');
      continue;
    }
    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (!line.trim()) { closeList(); html.push('<p class="memo-p-empty"></p>'); continue; }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inFence && fenceBuf.length) {
    html.push(`<pre><code>${escape(fenceBuf.join('\n'))}</code></pre>`);
  }
  return html.join('\n');
}

/** 顶部快捷字符栏的插入定义 */
export interface FormatAction {
  label: string;
  /** 插入文本（{s} 代表选中内容占位） */
  snippet: string;
  /** 光标最终偏移（相对插入文本起点；-1 表示放末尾） */
  caret?: number;
  /**
   * 特殊动作标记：不走「插入文本」流程，由父组件接管。
   * - `image`：唤起系统图片选择器，压缩后存 IndexedDB 并插入 `![](local:<id>)`
   */
  kind?: 'image';
}

export const FORMAT_ACTIONS: FormatAction[] = [
  // v2.7.0：H1/H2/H3 合并为单个 # —— 点击只插入一个 "#"，不加空格
  //（markdown 语义上的「# + 空格」由主人自己敲，不做任何判定/递增逻辑）
  { label: '#', snippet: '#' },
  { label: 'B', snippet: '****', caret: 2 },
  { label: 'I', snippet: '**', caret: 1 },
  { label: 'S', snippet: '~~~~', caret: 2 },
  { label: '`', snippet: '``', caret: 1 },
  { label: '>', snippet: '> ' },
  { label: '-', snippet: '- ' },
  { label: '1.', snippet: '1. ' },
  { label: '[]', snippet: '- [ ] ' },
  { label: '链接', snippet: '[](url)', caret: 1 },
  // 图片：唤起系统单图选择器（不再插入 ![](url)，要写 URL 直接关掉选择器手写即可）
  { label: '图片', snippet: '', kind: 'image' },
  { label: '表格', snippet: '| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n' },
  { label: '---', snippet: '\n---\n' },
  { label: '代码', snippet: '```\n\n```', caret: 4 },
];
