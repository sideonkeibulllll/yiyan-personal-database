/**
 * Obsidian 式「实时预览」CodeMirror 6 扩展
 *
 * 核心机制（对齐 Obsidian Live Preview 的业内实现）：
 * 1. 遍历语法树（@codemirror/lang-markdown 提供的 Lezer 树），拿到每个 Markdown 节点的范围；
 * 2. **光标/选区所在的「行」**（active line，即源码行）→ 不做任何隐藏，原样显示 Markdown 语法；
 * 3. **其余所有行** → 用 Decoration.replace() 把语法标记（##、**、`、[](…) 等）隐藏掉，
 *    同时用 Decoration.mark() 给正文本身上样式（大标题、粗体、代码底色…）。
 *    视觉结果就是「已经渲染好的样子」；
 * 4. 光标一移过去，那一行立刻「现出原形」，移开又「化回渲染态」。
 *
 * 与「编辑器 + 预览」双面板方案的本质区别：
 * 这里只有 **一份文档、一个光标**，所以光标偏移 = 真实字符偏移，
 * 「记住上次聚焦的 # 标题」这类锚点定位可以无缝对接。
 *
 * v2.7.0 新增：
 * - 任务列表 `- [ ]` → 真正的可点击勾选框（点击写回 `[x]` / `[ ]`）
 * - 有序列表 → 按出现顺序生成 1. 2. 3. 序号（删掉上面一条后会自动重排）
 * - 无序 / 有序 / 任务 三种列表项分别打 class，项目符号由 CSS 精确控制
 * - 列表嵌套缩进（最多 4 级）
 * - 图片 `local:<id>` → 从 IndexedDB 的 blob URL 缓存里取图渲染
 */
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect } from '@codemirror/state';
import type { EditorState as EditorStateType, Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { getCachedImageUrl } from '@/services/memoImageStore';

/* ------------------------------------------------------------------ *
 * 图片内联预览 Widget
 * ------------------------------------------------------------------ */

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    wrap.appendChild(img);
    return wrap;
  }

  ignoreEvent(): boolean {
    // 让点击穿透到编辑器，便于把光标放到图片行
    return false;
  }
}

/** 本地图片还没解析出 blob URL 时的占位 */
class LocalImagePendingWidget extends WidgetType {
  constructor(readonly id: string, readonly alt: string) {
    super();
  }

  eq(other: LocalImagePendingWidget): boolean {
    return other.id === this.id && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-md-image cm-md-image-pending';
    wrap.textContent = this.alt ? `图片：${this.alt}` : '图片加载中…';
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 文本 / 勾选框 Widget
 * ------------------------------------------------------------------ */

/** 纯文本 widget（有序列表序号用） */
class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) {
    super();
  }

  eq(other: TextWidget): boolean {
    return other.text === this.text && other.cls === this.cls;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 任务勾选框 widget。
 * 点击时把源码里的 `[ ]` ↔ `[x]` 原地替换（都是 3 字符，长度不变，光标不跳）。
 */
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span');
    box.className = `cm-md-task-box${this.checked ? ' is-checked' : ''}`;
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.title = this.checked ? '标记为未完成' : '标记为已完成';

    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    box.addEventListener('mousedown', stop);
    box.addEventListener('touchstart', stop, { passive: false });

    box.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const next = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: next },
      });
    });

    return box;
  }

  /** false = 事件由 widget 自己处理（否则 CM 会把点击吞掉） */
  ignoreEvent(): boolean {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 表格 Widget（v2.7.0）
 * ------------------------------------------------------------------ */

/** 单元格内的简易行内渲染（粗体 / 斜体 / 删除线 / 行内代码） */
function renderCellInline(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

/** 把 GFM 表格源码拆成表头 + 数据行 */
function parseTableSource(raw: string): { headers: string[]; rows: string[][] } {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const splitRow = (line: string): string[] => {
    let s = line;
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitRow(lines[0]);
  // lines[1] 是 |---|---| 分隔行，跳过
  const rows = lines.slice(2).map(splitRow);
  return { headers, rows };
}

/** 整张表替换成一个真正的 <table> */
class TableWidget extends WidgetType {
  constructor(readonly raw: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.raw === this.raw;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table';

    const { headers, rows } = parseTableSource(this.raw);
    const table = document.createElement('table');

    if (headers.length > 0) {
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      headers.forEach(h => {
        const th = document.createElement('th');
        th.innerHTML = renderCellInline(h);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const tbody = document.createElement('tbody');
    const colCount = Math.max(headers.length, ...rows.map(r => r.length), 0);
    rows.forEach(r => {
      const tr = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const td = document.createElement('td');
        td.innerHTML = renderCellInline(r[i] ?? '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  ignoreEvent(): boolean {
    // 点击穿透，方便把光标点进表格源码行
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 节点 → 样式类映射
 * ------------------------------------------------------------------ */

/** 行内节点的 class 名 */
const INLINE_CLASS: Record<string, string> = {
  StrongEmphasis: 'cm-md-strong',
  Emphasis: 'cm-md-em',
  InlineCode: 'cm-md-inline-code',
  Strikethrough: 'cm-md-strike',
  Link: 'cm-md-link',
};

/** 块级节点 → 行 class（ListItem 单独处理，不在这里） */
const BLOCK_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h cm-md-h1',
  ATXHeading2: 'cm-md-h cm-md-h2',
  ATXHeading3: 'cm-md-h cm-md-h3',
  ATXHeading4: 'cm-md-h cm-md-h4',
  ATXHeading5: 'cm-md-h cm-md-h5',
  ATXHeading6: 'cm-md-h cm-md-h6',
  Blockquote: 'cm-md-blockquote',
  FencedCode: 'cm-md-fenced-code',
};

/** 这些语法标记节点在非活动行时应当被隐藏（ListMark / TaskMarker 另有专门逻辑） */
const HIDDEN_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'QuoteMark',
  'LinkMark',
  'URL',
  'LinkTitle',
]);

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/**
 * 计算一行内「纯文本内容」的字符范围。
 * 只跳过行首空白，**不跳过** `- ` `> ` `1. ` 这类标记 ——
 * 标记的隐藏交给对应的 ListMark/QuoteMark 处理，
 * 否则标记会被包进内容的 mark 范围，导致隐藏失效（列表横杠残留）。
 */
function contentRange(state: EditorStateType, from: number, to: number): { start: number; end: number } {
  const line = state.doc.lineAt(from);
  const clampedTo = Math.min(to, line.to);
  let start = line.from;
  while (start < clampedTo && (state.doc.sliceString(start, start + 1) === ' ' || state.doc.sliceString(start, start + 1) === '\t')) {
    start++;
  }
  return { start, end: clampedTo };
}

/** 判断某个位置是否落在「活动行」范围内 */
function isActiveLine(state: EditorStateType, pos: number, activeLines: Set<number>): boolean {
  return activeLines.has(state.doc.lineAt(pos).number);
}

/** 收集活动行（光标所在行 + 选区覆盖的所有行） */
function collectActiveLines(state: EditorStateType): Set<number> {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const startLine = state.doc.lineAt(r.from).number;
    const endLine = state.doc.lineAt(r.to).number;
    for (let n = startLine; n <= endLine; n++) set.add(n);
  }
  return set;
}

/** 向上数列表嵌套深度（最外层列表 = 1） */
function listDepth(node: SyntaxNode): number {
  let d = 0;
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === 'BulletList' || p.name === 'OrderedList') d++;
  }
  return d;
}

/* ------------------------------------------------------------------ *
 * 主构建函数
 * ------------------------------------------------------------------ */

function buildDecorations(state: EditorStateType): DecorationSet {
  const activeLines = collectActiveLines(state);
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  const push = (from: number, to: number, deco: Decoration) => {
    if (from >= to) return;
    decos.push({ from, to, deco });
  };

  /** 把一个标记（含其后紧跟的一个空格）整体隐藏 */
  const hideMark = (from: number, to: number) => {
    let end = to;
    if (state.sliceDoc(end, end + 1) === ' ') end++;
    push(from, end, Decoration.replace({}));
  };

  const tree = syntaxTree(state);

  /**
   * 表格被整块替换成 <table> widget 后，它内部的行/单元格节点如果再加装饰
   * 就会落在被替换的范围内（冲突）。用这个游标把子树整体跳过。
   */
  let skipUntil = -1;

  tree.iterate({
    enter: node => {
      if (skipUntil >= 0) {
        if (node.from < skipUntil) return;
        skipUntil = -1;
      }

      const name = node.name;
      const active = isActiveLine(state, node.from, activeLines);

      /* ---------- 1. 列表标记：按父列表类型分流 ---------- */
      if (name === 'ListMark') {
        if (active) return; // 活动行原样显示
        const parentList = node.node.parent?.parent?.name;
        if (parentList === 'OrderedList') {
          // 序号由下面的 OrderedList 分支统一生成（支持自动重排）
          return;
        }
        hideMark(node.from, node.to);
        return;
      }

      /* ---------- 2. 有序列表：按出现顺序生成 1. 2. 3. ---------- */
      if (name === 'OrderedList') {
        let order = 0;
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name !== 'ListItem') continue;
          order++;
          const mark = child.getChild('ListMark');
          if (!mark) continue;
          if (isActiveLine(state, mark.from, activeLines)) continue; // 该行显示源码
          push(mark.from, mark.to, Decoration.replace({
            widget: new TextWidget(`${order}.`, 'cm-md-ol-num'),
          }));
        }
        return;
      }

      /* ---------- 3. 任务勾选框 ---------- */
      if (name === 'TaskMarker') {
        if (active) return;
        const raw = state.sliceDoc(node.from, node.to);
        const checked = /\[[xX]\]/.test(raw);
        push(node.from, node.to, Decoration.replace({
          widget: new TaskWidget(checked, node.from),
        }));
        return;
      }

      /* ---------- 3.5 表格：整块换成 <table> ---------- */
      if (name === 'Table') {
        const fromLine = state.doc.lineAt(node.from).number;
        const toLine = state.doc.lineAt(node.to).number;
        let anyActive = false;
        for (let n = fromLine; n <= toLine; n++) {
          if (activeLines.has(n)) { anyActive = true; break; }
        }
        if (anyActive) return; // 光标在表格任意一行 → 整表显示源码

        const raw = state.sliceDoc(node.from, node.to);
        skipUntil = node.to; // 表格内部节点不再单独加装饰
        push(node.from, node.to, Decoration.replace({ widget: new TableWidget(raw) }));
        return;
      }

      /* ---------- 4. 隐藏型语法标记 ---------- */
      if (HIDDEN_MARKS.has(name)) {
        if (active) return; // 活动行原样显示
        // 链接的 URL 部分整体隐藏
        if (name === 'URL' || name === 'LinkTitle') {
          push(node.from, node.to, Decoration.replace({}));
          return;
        }
        // 图片语法 ![alt](url)：LinkMark 交给 Image 分支整体替换
        if (name === 'LinkMark') return;
        push(node.from, node.to, Decoration.replace({}));
        return;
      }

      /* ---------- 5. 图片：整段 ![alt](url) 换成 <img> ---------- */
      if (name === 'Image') {
        if (active) return;
        const raw = state.sliceDoc(node.from, node.to);
        const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(raw);
        if (!m) return;
        const src = m[2];
        const alt = m[1];

        // 本地图片：local:<id> → IndexedDB blob URL
        if (src.startsWith('local:')) {
          const id = src.slice('local:'.length);
          const url = getCachedImageUrl(id);
          push(node.from, node.to, Decoration.replace({
            widget: url ? new ImageWidget(url, alt) : new LocalImagePendingWidget(id, alt),
          }));
          return;
        }

        if (/^(https?:|data:|\/|\.)/.test(src)) {
          push(node.from, node.to, Decoration.replace({ widget: new ImageWidget(src, alt) }));
        }
        return;
      }

      /* ---------- 6. 行内样式 ---------- */
      const inlineCls = INLINE_CLASS[name];
      if (inlineCls) {
        if (name === 'Link') {
          // 链接：文字部分上链接样式
          const raw = state.sliceDoc(node.from, node.to);
          const m = /^\[([^\]]*)\]/.exec(raw);
          if (m && m[1]) {
            push(node.from + 1, node.from + 1 + m[1].length, Decoration.mark({ class: inlineCls }));
          } else {
            push(node.from, node.to, Decoration.mark({ class: inlineCls }));
          }
        } else {
          // 粗体/斜体/代码/删除线：只给「内容部分」上样式，标记本身另处理
          const content = contentRange(state, node.from, node.to);
          push(content.start, content.end, Decoration.mark({ class: inlineCls }));
        }
        return;
      }

      /* ---------- 6.5 缩进代码块（4 空格 / Tab）：吃掉行首缩进 + 整体底色 ---------- */
      if (name === 'CodeBlock') {
        const startLine = state.doc.lineAt(node.from);
        const endLine = state.doc.lineAt(node.to);
        for (let n = startLine.number; n <= endLine.number; n++) {
          const line = state.doc.line(n);
          const m = /^[ \t]{1,4}/.exec(state.sliceDoc(line.from, line.to));
          if (m && m[0].length > 0) {
            push(line.from, line.from + m[0].length, Decoration.replace({}));
          }
        }
        push(startLine.from, endLine.to, Decoration.mark({ class: 'cm-md-fenced-code' }));
        return;
      }

      /* ---------- 7. 列表项：区分 无序 / 有序 / 任务 + 嵌套缩进 ---------- */
      if (name === 'ListItem') {
        const isTask = !!node.node.getChild('Task');
        const parentName = node.node.parent?.name ?? '';
        const depth = Math.min(Math.max(listDepth(node.node) - 1, 0), 6);
        const cls = [
          'cm-md-li',
          isTask ? 'cm-md-li-task' : (parentName === 'OrderedList' ? 'cm-md-li-ol' : 'cm-md-li-ul'),
          depth > 0 ? `cm-md-indent-${depth}` : '',
        ].filter(Boolean).join(' ');

        const line = state.doc.lineAt(node.from);
        const content = contentRange(state, node.from, node.to);
        push(content.start, Math.max(content.end, line.to), Decoration.mark({ class: cls }));
        return;
      }

      /* ---------- 8. 块级行样式 ---------- */
      const blockCls = BLOCK_CLASS[name];
      if (blockCls) {
        const line = state.doc.lineAt(node.from);
        // 把整行的「内容区」加上块样式
        const content = contentRange(state, node.from, node.to);
        push(content.start, Math.max(content.end, line.to), Decoration.mark({ class: blockCls }));
        return;
      }

      /* ---------- 9. 分割线：整行换成一条横线 ---------- */
      if (name === 'HorizontalRule') {
        if (active) return;
        const line = state.doc.lineAt(node.from);
        push(line.from, line.to, Decoration.replace({ class: 'cm-md-hr-widget' }));
        return;
      }
    },
  });

  // RangeSetBuilder 要求按 from 升序、同 from 时 to 升序
  decos.sort((a, b) => (a.from - b.from) || (a.to - b.to));

  const builder = new RangeSetBuilder<Decoration>();
  let lastFrom = -1;
  let lastTo = -1;
  for (const d of decos) {
    // 跳过与上一个完全重叠的（RangeSetBuilder 不允许 from 倒退）
    if (d.from < lastFrom || (d.from === lastFrom && d.to < lastTo)) continue;
    builder.add(d.from, d.to, d.deco);
    lastFrom = d.from;
    lastTo = d.to;
  }
  return builder.finish();
}

/* ------------------------------------------------------------------ *
 * StateField：文档 / 选区变化时重建装饰
 * ------------------------------------------------------------------ */

/**
 * 强制重建装饰的效果。
 * 用于「本地图片的 blob URL 准备好了」这类**文档没变但渲染结果要变**的场景
 * （空 transaction 不会触发 StateField.update 重建）。
 */
export const forceRerenderDecorations = StateEffect.define<null>();

export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some(e => e.is(forceRerenderDecorations))) {
      return buildDecorations(tr.state);
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f),
});

/* ------------------------------------------------------------------ *
 * 对外扩展
 * ------------------------------------------------------------------ */

/** 供 MemoPage 判断「光标是否落在活动行」时复用 */
export { collectActiveLines };

/**
 * 活动行：Obsidian 里活动行本身没有背景，只有行号高亮；
 * 这里移动端不显示行号，所以活动行**不加底色**，避免破坏「渲染态」观感。
 * 光标本身就是位置提示，够用了。
 */
export const activeLineDecor: Extension = EditorView.theme({
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
});

/** 汇总导出 Live Preview 扩展 */
export function livePreview(): Extension {
  return [livePreviewField, activeLineDecor];
}
