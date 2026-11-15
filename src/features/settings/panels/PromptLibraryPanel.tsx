/**
 * 设置面板 - 提示词库（v3.6.0）
 *
 * 定位是「资产台账」：手工录入、随时改名/改正文/归档，Chat 页只负责调用。
 * 数据在 settings.ai.promptLibrary（见 services/promptLibrary.ts），
 * 每次操作即时落盘，不依赖设置页底部的「保存」按钮。
 *
 * 长文本编辑走全屏弹层（复用 .memory-overlay 的视觉），因为正文动辄一两千字，
 * 塞在设置页的窄栏里没法看。
 */
import { useCallback, useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  MAX_PROMPT_CHARS,
  countPrompts,
  createPrompt,
  deletePrompt,
  importBuiltinPrompts,
  sortPrompts,
  updatePrompt,
} from '@/services/promptLibrary';
import type { SavedPrompt } from '@/types';
import './PromptLibraryPanel.css';

interface EditorState {
  /** 有 id = 改已有条目，没有 = 新建 */
  id?: string;
  title: string;
  scene: string;
  content: string;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

/** 复制正文（WebView 里 navigator.clipboard 可能失效，保留 textarea 兜底） */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function formatChars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k 字` : `${n} 字`;
}

export function PromptLibraryPanel() {
  const library = useSettingsStore(state => state.settings.ai.promptLibrary);
  const [keyword, setKeyword] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [flash, setFlash] = useState('');

  const all = useMemo(() => library ?? [], [library]);

  /** 列表：置顶 → 最近用过 → 最近改动（与 Chat 面板同一套排序） */
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = all.filter(p => {
      if (!showArchived && p.archived) return false;
      if (!kw) return true;
      return (
        p.title.toLowerCase().includes(kw) ||
        (p.scene ?? '').toLowerCase().includes(kw) ||
        p.content.toLowerCase().includes(kw)
      );
    });
    return sortPrompts(filtered);
  }, [all, keyword, showArchived]);

  const total = countPrompts({ includeArchived: true });
  const archivedCount = all.filter(p => p.archived).length;

  const notify = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(''), 2200);
  }, []);

  const openCreate = useCallback(() => {
    setEditor({ title: '', scene: '', content: '' });
  }, []);

  const openEdit = useCallback((p: SavedPrompt) => {
    setEditor({ id: p.id, title: p.title, scene: p.scene ?? '', content: p.content });
  }, []);

  const handleSave = useCallback(() => {
    if (!editor) return;
    if (!editor.content.trim()) {
      notify('正文是空的，先写点什么喵');
      return;
    }
    if (editor.id) {
      updatePrompt(editor.id, { title: editor.title, scene: editor.scene, content: editor.content });
      notify('已保存修改');
    } else {
      createPrompt({ title: editor.title, scene: editor.scene, content: editor.content });
      notify('已新建提示词');
    }
    setEditor(null);
  }, [editor, notify]);

  const handleDelete = useCallback((p: SavedPrompt) => {
    if (!confirm(`确定彻底删除「${p.title}」吗？\n（只想暂时收起来的话，用「归档」）`)) return;
    deletePrompt(p.id);
    notify('已删除');
  }, [notify]);

  const handleCopy = useCallback(async (p: SavedPrompt) => {
    const ok = await copyText(p.content);
    notify(ok ? `已复制「${p.title}」正文` : '复制失败，请打开编辑手动全选');
  }, [notify]);

  const handleImport = useCallback(() => {
    const { added, skipped } = importBuiltinPrompts();
    if (added === 0) {
      notify(`内置 8 条已在库里（跳过 ${skipped} 条）`);
    } else {
      notify(`已导入 ${added} 条${skipped > 0 ? `，跳过已存在的 ${skipped} 条` : ''}`);
    }
  }, [notify]);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">提示词库</h2>
      <p className="form-hint" style={{ marginTop: 0 }}>
        手工维护的可复用提示词。在 Chat 里点工具栏「提示词」即可挂载，正文不会占输入框。
        随本地备份与设备互传一起走（云备份不含设置，所以别指望云恢复带回）。
      </p>

      <div className="promptlib-toolbar">
        <input
          type="text"
          className="form-input promptlib-search"
          placeholder="搜索名称 / 场景 / 正文…"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <button className="promptlib-primary-btn" onClick={openCreate} type="button">＋ 新建</button>
      </div>

      <div className="promptlib-toolbar promptlib-toolbar-sub">
        <span className="promptlib-count">共 {total} 条{archivedCount > 0 ? ` · 已归档 ${archivedCount}` : ''}</span>
        <span className="promptlib-toolbar-actions">
          {archivedCount > 0 && (
            <button
              className={`promptlib-ghost-btn ${showArchived ? 'active' : ''}`}
              onClick={() => setShowArchived(v => !v)}
              type="button"
            >
              {showArchived ? '隐藏归档' : '显示归档'}
            </button>
          )}
          <button className="promptlib-ghost-btn" onClick={handleImport} type="button">导入内置 8 条</button>
        </span>
      </div>

      {flash && <div className="promptlib-flash">{flash}</div>}

      {visible.length === 0 ? (
        <div className="promptlib-empty">
          {total === 0
            ? '库里还是空的。点「导入内置 8 条」拿到那套教学提示词，或者「＋ 新建」自己写一条。'
            : '没有匹配的条目，换个关键词试试。'}
        </div>
      ) : (
        <div className="promptlib-list">
          {visible.map(p => (
            <div key={p.id} className={`promptlib-item ${p.archived ? 'archived' : ''}`}>
              <div className="promptlib-item-main" onClick={() => openEdit(p)}>
                <div className="promptlib-item-title">
                  {p.pinned && <span className="promptlib-pin">置顶</span>}
                  <span className="promptlib-name">{p.title}</span>
                  {p.archived ? <span className="promptlib-archived-tag">已归档</span> : null}
                </div>
                {p.scene && <div className="promptlib-scene">{p.scene}</div>}
                <div className="promptlib-meta">
                  {formatChars(p.content.length)}
                  {p.useCount ? ` · 用过 ${p.useCount} 次` : ''}
                </div>
              </div>
              <div className="promptlib-item-actions">
                <button
                  className={`promptlib-icon-btn ${p.pinned ? 'on' : ''}`}
                  onClick={() => updatePrompt(p.id, { pinned: !p.pinned })}
                  title={p.pinned ? '取消置顶' : '置顶'}
                  type="button"
                >
                  ★
                </button>
                <button className="promptlib-icon-btn" onClick={() => handleCopy(p)} title="复制正文" type="button">复制</button>
                <button
                  className="promptlib-icon-btn"
                  onClick={() => updatePrompt(p.id, { archived: p.archived ? 0 : 1 })}
                  title={p.archived ? '恢复' : '归档（默认不显示）'}
                  type="button"
                >
                  {p.archived ? '恢复' : '归档'}
                </button>
                <button className="promptlib-icon-btn danger" onClick={() => handleDelete(p)} title="删除" type="button">删</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <div className="memory-overlay" onClick={() => setEditor(null)}>
          <div className="memory-panel glass promptlib-editor" onClick={e => e.stopPropagation()}>
            <div className="memory-header">
              <h3>{editor.id ? '编辑提示词' : '新建提示词'}</h3>
              <button className="memory-close" onClick={() => setEditor(null)} title="关闭"><CloseIcon /></button>
            </div>

            <div className="promptlib-field">
              <label className="form-label">名称</label>
              <input
                type="text"
                className="form-input"
                placeholder="如：整页作业"
                value={editor.title}
                onChange={e => setEditor(s => (s ? { ...s, title: e.target.value } : s))}
              />
            </div>

            <div className="promptlib-field">
              <label className="form-label">场景（一句话，可空）</label>
              <input
                type="text"
                className="form-input"
                placeholder="如：一整页要交的作业 · 逐题答案 + 每类四问"
                value={editor.scene}
                onChange={e => setEditor(s => (s ? { ...s, scene: e.target.value } : s))}
              />
            </div>

            <div className="promptlib-field promptlib-field-grow">
              <label className="form-label">
                正文
                <span className="promptlib-chars">{formatChars(editor.content.length)}</span>
              </label>
              <textarea
                className="form-input promptlib-textarea"
                placeholder="原样保存，不做变量替换。在 Chat 里挂载时整段拼到消息最前面。"
                value={editor.content}
                maxLength={MAX_PROMPT_CHARS}
                onChange={e => setEditor(s => (s ? { ...s, content: e.target.value } : s))}
              />
            </div>

            <div className="promptlib-editor-footer">
              <button className="memory-btn" onClick={() => setEditor(null)} type="button">取消</button>
              <button className="memory-btn primary" onClick={handleSave} disabled={!editor.content.trim()} type="button">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
