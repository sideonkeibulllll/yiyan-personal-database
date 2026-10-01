/**
 * 备忘录页（v2.4.0 · Obsidian 式实时预览）
 *
 * 布局：
 * 1. 顶部栏：返回 / 文档名 / 标题大纲 / 菜单（换篇・新建・删除）
 * 2. 快捷字符栏（横向滚动）
 * 3. 单一编辑区（CodeMirror 6 实时预览，无需切换模式）
 * 4. 标题大纲抽屉
 *
 * 核心亮点：
 * - **实时预览**：光标所在行显示 Markdown 源码，其余行已渲染（对齐 Obsidian Live Preview）
 * - 实时保存（输入即写库，防抖 800ms）
 * - **记住上次聚焦的 # 标题**：光标停在某标题下，退出时记录该标题纯文本；
 *   下次进入自动跳转回该标题位置。定位锚点可随时通过移动光标改写。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MemoDoc } from '@/types';
import {
  getLastOrCreateMemo, getMemo, saveMemo, saveMemoAnchor,
  createMemo, getAllMemos, deleteMemo, setLastMemoId,
} from '@/services/memoDatabase';
import type { MemoEditorHandle } from './components/MemoEditor';
import { MemoFormatBar } from './components/MemoFormatBar';
import { MemoOutline } from './components/MemoOutline';
import { extractHeadings, offsetOfHeading, deriveTitle, type FormatAction } from './memoMarkdown';
import './Memo.css';

/**
 * 懒加载编辑器（v2.4.3 性能优化）
 *
 * MemoEditor 静态引入了整个 CodeMirror 6 生态
 * （@codemirror/view + state + commands + lang-markdown + language + lezer），
 * 单独一个 chunk 就有 ~525 KB —— 但只有「备忘录页」才用得到。
 * 改为 lazy 后，这段体积从「所有页面的公共依赖」变成「备忘录页按需加载」。
 *
 * 注：MemoEditorHandle 走 `import type`，类型在编译期被擦除，不会把它拉回主包。
 */
const MemoEditor = lazy(() =>
  import('./components/MemoEditor').then(m => ({ default: m.MemoEditor }))
);

const SAVE_DEBOUNCE = 800;

export function MemoPage() {
  const navigate = useNavigate();
  const [memo, setMemo] = useState<MemoDoc | null>(null);
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [allMemos, setAllMemos] = useState<MemoDoc[]>([]);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);

  const editorRef = useRef<MemoEditorHandle>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<{ content: string } | null>(null);
  const anchorRef = useRef<string | null>(null);
  const didJumpRef = useRef(false);

  const headings = useMemo(() => extractHeadings(content), [content]);

  // === 初次加载 ===
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
        const wantId = params.get('id');
        const doc = wantId ? (await getMemo(wantId)) ?? (await getLastOrCreateMemo()) : await getLastOrCreateMemo();
        if (cancelled) return;
        setMemo(doc);
        setContent(doc.content);
        setLastMemoId(doc.id);
        setActiveAnchor(doc.lastAnchor);
        setAllMemos(await getAllMemos());
      } catch (err) {
        console.error('[MemoPage] 加载失败:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // === 自动跳转到上次聚焦的标题（一次性）===
  useEffect(() => {
    if (didJumpRef.current) return;
    if (!memo) return;
    if (!memo.lastAnchor) { didJumpRef.current = true; return; }
    const offset = offsetOfHeading(content, memo.lastAnchor);
    if (offset === null) { didJumpRef.current = true; return; }
    // 等编辑器挂载完成
    const t = setTimeout(() => {
      editorRef.current?.jumpToOffset(offset);
      setActiveAnchor(memo.lastAnchor);
      didJumpRef.current = true;
    }, 160);
    return () => clearTimeout(t);
  }, [memo, content]);

  /** 立即写库 */
  const flush = useCallback(async (nextContent: string, anchor: string | null) => {
    const doc = memo;
    if (!doc) return;
    const next: MemoDoc = {
      ...doc,
      content: nextContent,
      title: deriveTitle(nextContent),
      lastAnchor: anchor,
    };
    await saveMemo(next);
    setMemo(next);
    setSavedAt(Date.now());
  }, [memo]);

  /** 内容变化：防抖保存 */
  const handleChange = useCallback((value: string) => {
    setContent(value);
    pendingRef.current = { content: value };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flush(value, anchorRef.current);
    }, SAVE_DEBOUNCE);
  }, [flush]);

  /** 光标所在标题变化：记录锚点（轻量写入，不动 updated_at） */
  const handleAnchorChange = useCallback((anchor: string | null) => {
    anchorRef.current = anchor;
    if (anchor !== activeAnchor) {
      setActiveAnchor(anchor);
      if (memo) void saveMemoAnchor(memo.id, anchor);
    }
  }, [activeAnchor, memo]);

  // === 卸载/切后台时立刻保存 ===
  useEffect(() => {
    const doFlush = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const pending = pendingRef.current;
      if (pending) {
        void flush(pending.content, anchorRef.current);
        pendingRef.current = null;
      }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') doFlush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', doFlush);
    return () => {
      doFlush();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', doFlush);
    };
  }, [flush]);

  /** 快捷栏插入（走 CodeMirror dispatch，保留选区语义） */
  const handleInsert = useCallback((action: FormatAction) => {
    const handle = editorRef.current;
    if (!handle) return;
    const snippet = action.snippet;

    // 包裹类符号（B / I / S / `）：选中文字则自动包起来
    const wrapMatch = /^(\*{2}|\*|~{2}|`)$/.exec(snippet);
    const pairs: Record<string, [string, string]> = {
      '**': ['**', '**'],
      '*': ['*', '*'],
      '~~': ['~~', '~~'],
      '`': ['`', '`'],
    };
    if (wrapMatch && pairs[snippet]) {
      const [before, after] = pairs[snippet];
      handle.wrapSelectionAtCursor(before, after, action.caret);
      return;
    }

    // 链接 / 图片：选中文字时塞进方括号
    const selectedText = handle.getSelection();
    if (snippet === '[](url)' && selectedText) {
      handle.insertAtCursor(`[${selectedText}](url)`, selectedText.length + 3);
      return;
    }
    if (snippet === '![](url)' && selectedText) {
      handle.insertAtCursor(`![${selectedText}](url)`, selectedText.length + 4);
      return;
    }

    handle.insertAtCursor(snippet, action.caret);
  }, []);

  /** 大纲跳转 */
  const handleJump = useCallback((h: { line: number; text: string }) => {
    const offset = offsetOfHeading(content, h.text);
    if (offset === null) return;
    setShowOutline(false);
    setTimeout(() => editorRef.current?.jumpToOffset(offset), 80);
  }, [content]);

  /** 切换文档 */
  const handleSwitch = useCallback(async (targetId: string) => {
    setShowMenu(false);
    const doc = await getMemo(targetId);
    if (!doc) return;
    setMemo(doc);
    setContent(doc.content);
    setActiveAnchor(doc.lastAnchor);
    anchorRef.current = doc.lastAnchor;
    setLastMemoId(doc.id);
    didJumpRef.current = false;
  }, []);

  const handleNewMemo = useCallback(async () => {
    const created = await createMemo('未命名', '# 新备忘录\n\n');
    setMemo(created);
    setContent(created.content);
    setActiveAnchor(null);
    anchorRef.current = null;
    setLastMemoId(created.id);
    setAllMemos(await getAllMemos());
    setShowMenu(false);
    didJumpRef.current = true;
  }, []);

  const handleDeleteMemo = useCallback(async () => {
    if (!memo) return;
    if (!confirm(`确定删除「${memo.title}」？`)) return;
    await deleteMemo(memo.id);
    const rest = await getAllMemos();
    if (rest.length > 0) {
      setMemo(rest[0]);
      setContent(rest[0].content);
      setActiveAnchor(rest[0].lastAnchor);
      anchorRef.current = rest[0].lastAnchor;
      setLastMemoId(rest[0].id);
      didJumpRef.current = false;
    } else {
      const created = await createMemo('未命名', '# 新备忘录\n\n');
      setMemo(created);
      setContent(created.content);
      setActiveAnchor(null);
      setLastMemoId(created.id);
    }
    setAllMemos(await getAllMemos());
    setShowMenu(false);
  }, [memo]);

  const charCount = content.length;
  const saveLabel = savedAt
    ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : '未保存';

  return (
    <div className="memo-page">
      {/* 1. 顶部栏 */}
      <header className="memo-header">
        <button className="memo-icon-btn" onClick={() => navigate(-1)} title="返回">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="memo-header-title">
          <span className="memo-title-text">{memo?.title || '备忘录'}</span>
          <span className="memo-save-state">{saveLabel}</span>
        </div>
        <button
          className="memo-icon-btn"
          onClick={() => setShowOutline(v => !v)}
          title="标题大纲"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="12" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <button className="memo-icon-btn" onClick={() => setShowMenu(v => !v)} title="更多">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </header>

      {/* 菜单 */}
      {showMenu && (
        <div className="memo-menu-mask" onClick={() => setShowMenu(false)}>
          <div className="memo-menu" onClick={e => e.stopPropagation()}>
            <div className="memo-menu-label">切换备忘录</div>
            <div className="memo-menu-scroll">
              {allMemos.map(m => (
                <button
                  key={m.id}
                  className={`memo-menu-item ${m.id === memo?.id ? 'active' : ''}`}
                  onClick={() => handleSwitch(m.id)}
                >
                  {m.title}
                </button>
              ))}
            </div>
            <div className="memo-menu-sep" />
            <button className="memo-menu-item" onClick={handleNewMemo}>+ 新建备忘录</button>
            <button className="memo-menu-item danger" onClick={handleDeleteMemo}>删除当前备忘录</button>
          </div>
        </div>
      )}

      {/* 2. 快捷字符栏 */}
      <MemoFormatBar
        onBeforeInsert={() => editorRef.current?.snapshotSelection()}
        onInsert={handleInsert}
      />

      {/* 3. 实时预览编辑区（单文档、无模式切换） */}
      {/* CodeMirror 为懒加载 chunk，首次进入此页时才下载，用 Suspense 兜住加载瞬间 */}
      <div className="memo-body">
        <Suspense fallback={<div className="memo-editor-loading">编辑器加载中…</div>}>
          <MemoEditor
            ref={editorRef}
            value={content}
            onChange={handleChange}
            onAnchorChange={handleAnchorChange}
          />
        </Suspense>
      </div>

      {/* 标题大纲抽屉 */}
      {showOutline && (
        <div className="memo-outline-mask" onClick={() => setShowOutline(false)}>
          <div className="memo-outline-panel" onClick={e => e.stopPropagation()}>
            <MemoOutline headings={headings} activeText={activeAnchor} onJump={handleJump} />
          </div>
        </div>
      )}

      {/* 4. 底部状态栏 */}
      <footer className="memo-footer">
        <span>{charCount} 字</span>
        <span className="memo-footer-anchor">
          {activeAnchor ? `定位：${activeAnchor}` : '定位：无（光标移到 # 标题下即可记住）'}
        </span>
      </footer>
    </div>
  );
}
