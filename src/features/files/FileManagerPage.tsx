/**
 * 文件库（v3.6.4）
 *
 * 列表式的「总管理器」：看有哪些文件、点开全屏看、手动新建/删除。
 * AI 通过 MCP 工具（list_files / read_file / write_file / delete_file）读写同一个目录。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteLibraryFile,
  formatFileSize,
  isHtmlFile,
  isMarkdownFile,
  listLibraryFiles,
  writeLibraryFile,
  type LibraryFile,
} from '@/services/fileLibrary';
import { IconBack, IconFile, IconPlus, IconTrash, IconChevronRight } from '@/components/icons';
import './Files.css';

/** 按扩展名给个小图标字（没有图标库依赖，纯文本标识） */
function fileBadge(name: string): string {
  if (isHtmlFile(name)) return 'HTML';
  if (isMarkdownFile(name)) return 'MD';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'TXT';
  return ext.slice(0, 4);
}

export function FileManagerPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('demo.html');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await listLibraryFiles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const total = useMemo(() => files.reduce((sum, file) => sum + (file.size || 0), 0), [files]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const shell = isHtmlFile(name)
      ? '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>新文件</title>\n</head>\n<body>\n  <h1>你好</h1>\n</body>\n</html>\n'
      : '';
    await writeLibraryFile(name, shell);
    setCreating(false);
    setNewName('demo.html');
    await refresh();
    navigate(`/files/${encodeURIComponent(name)}`);
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确定删除「${name}」吗？删除后不可恢复。`)) return;
    try {
      await deleteLibraryFile(name);
      await refresh();
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  return (
    <div className="files-page">
      <header className="files-head">
        <button type="button" className="files-back" onClick={() => navigate('/')} title="返回">
          <IconBack />
        </button>
        <div className="files-title">
          <h1>文件库</h1>
          <span className="files-sub">{files.length} 个文件 · {formatFileSize(total)}</span>
        </div>
        <button type="button" className="files-new" onClick={() => setCreating(v => !v)}>
          <IconPlus size={16} />
          <span>新建</span>
        </button>
      </header>

      {creating && (
        <div className="files-create">
          <input
            className="files-create-input"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
            placeholder="文件名，如 demo.html / note.md"
            autoFocus
          />
          <button type="button" className="files-create-btn" onClick={handleCreate}>创建</button>
        </div>
      )}

      <div className="files-body">
        {loading && <div className="files-empty">读取中…</div>}
        {!loading && files.length === 0 && (
          <div className="files-empty">
            <IconFile size={28} />
            <p>还没有文件。</p>
            <p className="files-empty-hint">
              点右上角「新建」，或者直接让 Chat 里的 AI 帮你写一个（记得在 MCP 面板勾上「文件库」）。
            </p>
          </div>
        )}
        {files.map(file => (
          <div key={file.name} className="files-row">
            <button
              type="button"
              className="files-row-main"
              onClick={() => navigate(`/files/${encodeURIComponent(file.name)}`)}
            >
              <span className={`files-badge ${isHtmlFile(file.name) ? 'html' : ''}`}>{fileBadge(file.name)}</span>
              <span className="files-row-text">
                <span className="files-row-name">{file.name}</span>
                <span className="files-row-meta">{formatFileSize(file.size)}</span>
              </span>
              <IconChevronRight size={14} />
            </button>
            <button
              type="button"
              className="files-row-del"
              onClick={() => void handleDelete(file.name)}
              title={`删除 ${file.name}`}
              aria-label={`删除 ${file.name}`}
            >
              <IconTrash size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
