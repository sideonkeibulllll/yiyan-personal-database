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
 */
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState } from '@codemirror/state';
import type { EditorState as EditorStateType, Extension, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

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

/** 块级节点 → 行 class（用于鼠标悬停、点击定位等） */
const BLOCK_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h cm-md-h1',
  ATXHeading2: 'cm-md-h cm-md-h2',
  ATXHeading3: 'cm-md-h cm-md-h3',
  ATXHeading4: 'cm-md-h cm-md-h4',
  ATXHeading5: 'cm-md-h cm-md-h5',
  ATXHeading6: 'cm-md-h cm-md-h6',
  Blockquote: 'cm-md-blockquote',
  FencedCode: 'cm-md-fenced-code',
  CodeBlock: 'cm-md-fenced-code',
  HorizontalRule: 'cm-md-hr',
  ListItem: 'cm-md-li',
};

/** 这些语法标记节点在非活动行时应当被隐藏 */
const HIDDEN_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'StrikethroughMark',
  'QuoteMark',
  'ListMark',
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
 * 标记的隐藏交给 HIDDEN_MARKS 里对应的 ListMark/QuoteMark 处理，
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
function isActive(state: EditorStateType, pos: number, activeLines: Set<number>): boolean {
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

  const tree = syntaxTree(state);

  tree.iterate({
    enter: node => {
      const name = node.name;
      const active = isActive(state, node.from, activeLines) || isActive(state, Math.max(node.from, node.to - 1), activeLines);

      // ---------- 1. 隐藏型语法标记 ----------
      if (HIDDEN_MARKS.has(name)) {
        if (active) return; // 活动行原样显示
        // 链接的 URL 部分整体隐藏
        if (name === 'URL' || name === 'LinkTitle') {
          push(node.from, node.to, Decoration.replace({}));
          return;
        }
        // 图片语法 ![alt](url) 整体替换为图片预览
        if (name === 'LinkMark') return;
        push(node.from, node.to, Decoration.replace({}));
        return;
      }

      // ---------- 2. 图片：整段 ![alt](url) 换成 <img> ----------
      if (name === 'Image') {
        if (active) return;
        const raw = state.sliceDoc(node.from, node.to);
        const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(raw);
        if (m && /^(https?:|data:|\/|\.)/.test(m[2])) {
          push(node.from, node.to, Decoration.replace({ widget: new ImageWidget(m[2], m[1]) }));
        }
        return;
      }

      // ---------- 3. 行内样式 ----------
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

      // ---------- 4. 块级行样式 ----------
      const blockCls = BLOCK_CLASS[name];
      if (blockCls) {
        const line = state.doc.lineAt(node.from);
        // 把整行的「内容区」加上块样式
        const content = contentRange(state, node.from, node.to);
        push(content.start, Math.max(content.end, line.to), Decoration.mark({ class: blockCls }));
        return;
      }

      // ---------- 5. 分割线：整行换成一条横线 ----------
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

export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection) {
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
