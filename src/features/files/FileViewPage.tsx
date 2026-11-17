/**
 * 文件查看 / 编辑页（v3.6.4）
 *
 * html 默认进「预览」（沙箱 iframe，全屏），可切源码；其他文本直接显示源码。
 * 编辑保存走本地 Filesystem，不走危险确认（删除才要）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteLibraryFile,
  duplicateLibraryFile,
  formatFileSize,
  isHtmlFile,
  readLibraryFile,
  renameLibraryFile,
  writeLibraryFile,
} from '@/services/fileLibrary';
import { IconBack, IconCopy, IconCheck, IconEdit, IconTrash, IconRename } from '@/components/icons';
import { goBack } from '@/utils/navBack';
import './Files.css';

type Mode = 'preview' | 'source';

export function FileViewPage() {
  const { name: rawName } = useParams();
  const navigate = useNavigate();
  const name = useMemo(() => decodeURIComponent(rawName ?? ''), [rawName]);

  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<Mode>(isHtmlFile(name) ? 'preview' : 'source');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [dirtyHint, setDirtyHint] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    const file = await readLibraryFile(name);
    if (!file) {
      setMissing(true);
      setLoaded(true);
      return;
    }
    setText(file.text);
    setDraft(file.text);
    setMissing(false);
    setLoaded(true);
  }, [name]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    try {
      await writeLibraryFile(name, draft);
      setText(draft);
      setEditing(false);
      setDirtyHint('已保存');
      window.setTimeout(() => setDirtyHint(''), 1500);
    } catch {
      window.alert('保存失败，请重试');
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleRename = async () => {
    const next = renameValue.trim();
    if (!next || next === name) { setRenaming(false); return; }
    try {
      const saved = await renameLibraryFile(name, next);
      setRenaming(false);
      navigate(`/files/${encodeURIComponent(saved)}`, { replace: true });
    } catch {
      window.alert('改名失败，请重试');
    }
  };

  const handleDuplicate = async () => {
    try {
      const copy = await duplicateLibraryFile(name);
      navigate(`/files/${encodeURIComponent(copy)}`);
    } catch {
      window.alert('复制失败，请重试');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定删除「${name}」吗？删除后不可恢复。`)) return;
    try {
      await deleteLibraryFile(name);
      navigate('/files');
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  const bytes = new Blob([text]).size;

  return (
    <div className="file-view-page">
      <header className="files-head">
        <button type="button" className="files-back" onClick={() => goBack(navigate, '/files')} title="返回上一页">
          <IconBack />
        </button>
        <div className="files-title">
          <h1 className="file-view-name">{name || '文件'}</h1>
          <span className="files-sub">{formatFileSize(bytes)}{dirtyHint ? ` · ${dirtyHint}` : ''}</span>
        </div>
        <div className="file-view-actions">
          {isHtmlFile(name) && !editing && (
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => setMode(mode === 'preview' ? 'source' : 'preview')}
              title={mode === 'preview' ? '看源码' : '看预览'}
            >
              {mode === 'preview' ? '源码' : '预览'}
            </button>
          )}
          {!editing && (
            <button type="button" className="files-icon-btn" onClick={copyAll} title="复制全文">
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          )}
          {!editing && (
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => { setRenameValue(name); setRenaming(true); }}
              title="重命名"
            >
              <IconRename size={14} />
            </button>
          )}
          {!editing && (
            <button type="button" className="files-icon-btn" onClick={handleDuplicate} title="复制一份">
              <IconCopy size={14} />
            </button>
          )}
          {editing ? (
            <>
              <button type="button" className="files-icon-btn" onClick={() => { setDraft(text); setEditing(false); }}>取消</button>
              <button type="button" className="files-icon-btn primary" onClick={save}>保存</button>
            </>
          ) : (
            <button type="button" className="files-icon-btn" onClick={() => setEditing(true)} title="编辑">
              <IconEdit size={14} />
            </button>
          )}
          <button type="button" className="files-icon-btn danger" onClick={handleDelete} title="删除">
            <IconTrash size={14} />
          </button>
        </div>
      </header>

      {!loaded && <div className="files-empty">加载中…</div>}
      {loaded && missing && (
        <div className="files-empty">
          <p>这个文件不存在（可能已被删除）。</p>
          <button type="button" className="files-create-btn" onClick={() => navigate('/files')}>回文件库</button>
        </div>
      )}

      {renaming && (
        <div className="files-modal-mask" onClick={() => setRenaming(false)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>重命名</h3>
            <input
              className="files-create-input"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleRename(); }}
              autoFocus
            />
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={() => setRenaming(false)}>取消</button>
              <button type="button" className="files-create-btn" onClick={handleRename}>保存</button>
            </div>
          </div>
        </div>
      )}

      {loaded && !missing && editing && (
        <textarea
          className="file-view-editor"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          spellCheck={false}
        />
      )}

      {loaded && !missing && !editing && mode === 'source' && (
        <div className="file-view-body"><pre>{text}</pre></div>
      )}

      {loaded && !missing && !editing && mode === 'preview' && (
        <iframe
          className="file-view-frame"
          title={name}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          srcDoc={text}
        />
      )}
    </div>
  );
}
