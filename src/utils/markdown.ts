/**
 * 轻量 Markdown 渲染器
 * 支持：加粗、斜体、列表、代码块、行内代码、链接、标题、引用、分隔线
 * 不引入第三方依赖，纯手写
 */

/** 转义 HTML 特殊字符 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, ch => map[ch]);
}

/** 处理行内格式：加粗、斜体、行内代码、链接 */
function renderInline(text: string): string {
  let result = escapeHtml(text);

  // 行内代码 `code`
  result = result.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // 链接 [text](url) — 只允许 http/https
  result = result.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );

  // 加粗 **text**
  result = result.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

  // 斜体 *text* (避免和加粗冲突，只处理单个*)
  result = result.replace(/(^|[^*])\*([^\**][^\*]*?)\*(?!\*)/g, '$1<em>$2</em>');

  return result;
}

/** 渲染单行 */
function renderLine(line: string): string {
  // 标题
  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const content = renderInline(headingMatch[2]);
    return `<h${level} class="md-heading md-h${level}">${content}</h${level}>`;
  }

  // 引用
  if (line.startsWith('> ')) {
    const content = renderInline(line.slice(2));
    return `<blockquote class="md-quote">${content}</blockquote>`;
  }

  // 分隔线
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
    return '<hr class="md-hr" />';
  }

  // 无序列表项
  if (/^[-*+]\s+/.test(line)) {
    const content = renderInline(line.replace(/^[-*+]\s+/, ''));
    return `<li class="md-list-item">${content}</li>`;
  }

  // 有序列表项
  if (/^\d+\.\s+/.test(line)) {
    const content = renderInline(line.replace(/^\d+\.\s+/, ''));
    return `<li class="md-list-item md-ordered">${content}</li>`;
  }

  // 普通段落
  const content = renderInline(line);
  if (content.trim()) {
    return `<p class="md-paragraph">${content}</p>`;
  }
  return '';
}

/** 渲染完整 Markdown 为 HTML 字符串 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const blocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      const code = escapeHtml(codeLines.join('\n'));
      const langLabel = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : '';
      blocks.push(`<pre class="md-code-block">${langLabel}<code>${code}</code></pre>`);
      continue;
    }

    // 连续列表项合并为 ul/ol
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const isOrdered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^[-*+]\s+/.test(lines[i]) || /^\d+\.\s+/.test(lines[i]))) {
        items.push(renderLine(lines[i]));
        i++;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      blocks.push(`<${tag} class="md-list">${items.join('')}</${tag}>`);
      continue;
    }

    // 连续引用合并
    if (line.startsWith('> ')) {
      const quotes: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quotes.push(renderLine(lines[i]));
        i++;
      }
      blocks.push(`<div class="md-quote-group">${quotes.join('')}</div>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 普通行
    blocks.push(renderLine(line));
    i++;
  }

  return blocks.join('\n');
}
