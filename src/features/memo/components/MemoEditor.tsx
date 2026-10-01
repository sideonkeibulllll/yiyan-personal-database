/**
 * 编辑区：CodeMirror 6 实时预览编辑器
 *
 * 对外接口与旧 textarea 版保持兼容（MemoEditorHandle），
 * 但底层换成 CM6 + livePreview 扩展，实现 Obsidian 式「光标行显示源码、其余行渲染」。
 *
 * 暴露的能力：
 * - onChange：内容变化（实时）
 * - onAnchorChange：光标所在 # 标题变化（供父组件持久化「上次聚焦标题」）
 * - jumpToOffset：跳到指定字符偏移
 * - insertAtCursor：在光标处插入片段（快捷字符栏用）
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, placeholder as cmPlaceholder,
  drawSelection, highlightActiveLine, rectangularSelection, highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { livePreview } from './livePreview';
import { findHeadingAtCursor } from '../memoMarkdown';

export interface MemoEditorHandle {
  /** 跳到指定字符偏移并聚焦 */
  jumpToOffset: (offset: number) => void;
  /** 获取可聚焦的 DOM（兼容旧接口，返回 CM 的 contentDOM） */
  getEl: () => HTMLElement | null;
  /** 在光标处插入片段；caretOffset 为插入后光标相对光标起点的偏移 */
  insertAtCursor: (snippet: string, caretOffset?: number) => void;
  /** 用选中内容包裹片段（{s} 占位） */
  wrapSelectionAtCursor: (before: string, after: string, fallbackCaret?: number) => void;
  /** 取当前选中的文本 */
  getSelection: () => string;
  /**
   * 快照当前选区。
   * 快捷字符栏的按钮会 preventDefault 阻止焦点转移，但某些浏览器/时机下
   * CM 仍会先失焦并把 selection 归零；在按钮 mousedown 的第一时间调用本方法
   * 把真实选区固定下来，之后的插入操作就以它为准。
   */
  snapshotSelection: () => void;
  reportAnchor: () => void;
}

interface MemoEditorProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  /** 光标所在标题变化 */
  onAnchorChange: (anchor: string | null) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const MemoEditor = forwardRef<MemoEditorHandle, MemoEditorProps>(function MemoEditor(
  { value, placeholder, onChange, onAnchorChange, onFocus, onBlur },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** 外部 value 同步进 doc 时，抑制 onChange 回环 */
  const syncingRef = useRef(false);
  /**
   * 「最后已知的光标位置」。
   * 快捷字符栏点击时会 preventDefault 阻止焦点转移，此时 CM6 的
   * view.state.selection 看似还在，但失焦后不可靠；这里自己记住最近一次
   * 有焦点时的选区，插入时优先用它，避免片段被插到文档开头。
   */
  const lastSelRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  const cbs = useRef({ onChange, onAnchorChange, onFocus, onBlur });
  cbs.current = { onChange, onAnchorChange, onFocus, onBlur };

  /* -------------------- 初始化（仅一次） -------------------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged && !syncingRef.current) {
        cbs.current.onChange(update.state.doc.toString());
      }
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        const sel = update.state.selection.main;
        // 只要是有焦点状态下的选区就记下来（失焦时 CM 可能把选区重置到 0）
        if (update.view.hasFocus) {
          lastSelRef.current = { from: sel.from, to: sel.to };
        }
        const anchor = findHeadingAtCursor(update.state.doc.toString(), sel.head);
        cbs.current.onAnchorChange(anchor);
      }
      if (update.focusChanged) {
        if (update.view.hasFocus) cbs.current.onFocus?.();
        else cbs.current.onBlur?.();
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, addKeymap: true }),
        livePreview(),
        cmPlaceholder(placeholder || '开始写点什么…'),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅初始化一次；value 的后续同步由下一个 effect 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------- 外部 value → 内部 doc -------------------- */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    syncingRef.current = true;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: EditorSelection.cursor(Math.min(sel.head, value.length)),
    });
    syncingRef.current = false;
  }, [value]);

  /* -------------------- 对外句柄 -------------------- */
  useImperativeHandle(ref, () => ({
    jumpToOffset(offset: number) {
      const view = viewRef.current;
      if (!view) return;
      const pos = Math.max(0, Math.min(offset, view.state.doc.length));
      view.focus();
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      lastSelRef.current = { from: pos, to: pos };
    },
    getEl: () => viewRef.current?.contentDOM ?? null,
    getSelection() {
      const view = viewRef.current;
      if (!view) return '';
      // 优先用「最后已知选区」（快捷栏点击时编辑器可能已失焦）
      const { from, to } = lastSelRef.current;
      return view.state.sliceDoc(from, to);
    },
    insertAtCursor(snippet: string, caretOffset?: number) {
      const view = viewRef.current;
      if (!view) return;
      // 用最后已知选区，避免失焦后 selection 被重置到 0 → 插到文档开头
      const { from, to } = lastSelRef.current;
      const caret = from + (caretOffset ?? snippet.length);
      view.focus();
      view.dispatch({
        changes: { from, to, insert: snippet },
        selection: EditorSelection.cursor(caret),
        scrollIntoView: true,
      });
      lastSelRef.current = { from: caret, to: caret };
    },
    wrapSelectionAtCursor(before: string, after: string, fallbackCaret?: number) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = lastSelRef.current;
      const selected = view.state.sliceDoc(from, to);
      if (selected) {
        const insert = before + selected + after;
        const caret = from + before.length + selected.length;
        view.focus();
        view.dispatch({
          changes: { from, to, insert },
          // 保留选中状态，方便连续加粗/斜体
          selection: EditorSelection.range(from + before.length, caret),
          scrollIntoView: true,
        });
        lastSelRef.current = { from: from + before.length, to: caret };
      } else {
        const insert = before + after;
        const caret = from + (fallbackCaret ?? before.length);
        view.focus();
        view.dispatch({
          changes: { from, to, insert },
          selection: EditorSelection.cursor(caret),
          scrollIntoView: true,
        });
        lastSelRef.current = { from: caret, to: caret };
      }
    },
    snapshotSelection() {
      const view = viewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      // 只有编辑器确实持有焦点、或选区非零时才覆盖，避免把有效快照冲掉
      if (view.hasFocus || sel.from !== sel.to) {
        lastSelRef.current = { from: sel.from, to: sel.to };
      }
    },
    reportAnchor() {
      const view = viewRef.current;
      if (!view) return;
      cbs.current.onAnchorChange(findHeadingAtCursor(view.state.doc.toString(), lastSelRef.current.from));
    },
  }), []);

  return <div className="memo-editor-cm" ref={hostRef} />;
});
