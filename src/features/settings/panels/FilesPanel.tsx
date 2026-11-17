/**
 * 设置面板 - 文件库（v3.6.5）
 *
 * 只负责「入口 + 概览」：HTML 文件池放这里，点一下直接全屏打开，
 * 真正的增删改在 #/files 管理器里（避免两处 UI 打架）。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listLibraryFiles, formatFileSize, isHtmlFile, type LibraryFile } from '@/services/fileLibrary';
import { IconFile, IconChevronRight } from '@/components/icons';

export function FilesPanel() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await listLibraryFiles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
  const htmlCount = files.filter(file => isHtmlFile(file.name)).length;

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">文件库</h2>

      <div className="form-group">
        <span className="form-hint">
          这里是 AI 的作品池（主要放 html / md）。点文件名直接全屏打开预览；新建、编辑、删除在完整管理器里。
        </span>
        <div className="model-manage-row">
          <span className="model-manage-name">
            {loading ? '读取中…' : `共 ${files.length} 个文件（${htmlCount} 个 HTML）· ${formatFileSize(total)}`}
          </span>
          <button
            type="button"
            className="model-manage-add-btn"
            onClick={() => navigate('/files')}
          >
            打开管理器
          </button>
        </div>
      </div>

      <div className="form-group">
        {!loading && files.length === 0 && (
          <span className="form-hint">
            还没有文件。在 Chat 里勾上 MCP 的「文件库」，让 AI 写一个（write_file 不需要你确认）。
          </span>
        )}
        {files.map(file => (
          <button
            key={file.name}
            type="button"
            className="settings-link-btn files-entry-row"
            onClick={() => navigate(`/files/${encodeURIComponent(file.name)}`)}
            title={`打开 ${file.name}`}
          >
            <IconFile size={14} />
            <span className="files-entry-name">{file.name}</span>
            <span className="files-entry-meta">{formatFileSize(file.size)}</span>
            <IconChevronRight size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}
