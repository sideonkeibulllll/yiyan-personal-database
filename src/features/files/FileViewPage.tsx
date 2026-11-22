/**
 * 作品详情页（v3.8.0）
 *
 * 一个作品 = 一个文件夹：文件条切换文件，入口 html 用沙箱 iframe 预览（存储垫片托管 localStorage）。
 * - 预览：只对入口 html（index.html），垫片按「作品名」分库（替代 MT 管理器预览）；
 * - 编辑：逐文本文件编辑保存（覆盖前自动存版本快照）；
 * - 历史版本 / 应用数据：当前文件的快照回滚、作品的存储数据清空/导出；
 * - 新建/导入/删除文件、重命名/复制/删除作品；
 * - 打开即记 lastOpenedAt（管理器默认区按最近使用排序）。
 *
 * 封面不在这页折腾：作品列表封面只认入口 html 的 `<meta name="cover" content="...">`，
 * 图由 AI 的 draw_image 画好放作品里。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  deleteWork,
  deleteWorkFile,
  duplicateWork,
  entryNameFor,
  formatFileSize,
  isHtmlPath,
  isImagePath,
  listWorkFiles,
  migrateLegacyFlatFiles,
  pickEntry,
  readWorkBinary,
  readWorkText,
  renameWork,
  writeWorkBinary,
  writeWorkText,
  type WorkFile,
} from '@/services/workLibrary';
import {
  appDataStats,
  clearAppData,
  deleteVersion,
  getAppData,
  listVersions,
  saveAppData,
  touchFileOpened,
  VERSION_KEEP,
  type FileVersion,
} from '@/services/fileAssets';
import { buildStorageShimScript, injectScripts } from '@/utils/htmlStorageShim';
import { bytesToBase64 } from '@/services/traeImage';
import { IconBack, IconCopy, IconCheck, IconEdit, IconTrash, IconRename, IconPlus } from '@/components/icons';
import { goBack } from '@/utils/navBack';
import './Files.css';

type Mode = 'preview' | 'source';
type Panel = null | 'versions' | 'appdata' | 'newfile';

const REASON_LABEL: Record<FileVersion['reason'], string> = {
  save: '手动保存',
  ai: 'AI 写入',
  system: '系统',
};

export function FileViewPage() {
  const { name: rawName } = useParams();
  const navigate = useNavigate();
  const work = useMemo(() => decodeURIComponent(rawName ?? ''), [rawName]);

  const [files, setFiles] = useState<WorkFile[]>([]);
  const [entry, setEntry] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [text, setText] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [mode, setMode] = useState<Mode>('preview');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [dirtyHint, setDirtyHint] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [newFileName, setNewFileName] = useState('');

  const [previewData, setPreviewData] = useState<Record<string, string>>({});
  const [previewToken, setPreviewToken] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [appStat, setAppStat] = useState<{ keys: number; bytes: number }>({ keys: 0, bytes: 0 });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appDataRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const flash = useCallback((msg: string) => {
    setDirtyHint(msg);
    window.setTimeout(() => setDirtyHint(''), 1800);
  }, []);

  const loadFile = useCallback(async (path: string) => {
    if (isImagePath(path)) {
      const b64 = await readWorkBinary(work, path);
      const ext = (path.split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      setImageData(b64 ? `data:${mime};base64,${b64}` : null);
      setText('');
      setDraft('');
    } else {
      const file = await readWorkText(work, path);
      setImageData(null);
      setText(file?.text ?? '');
      setDraft(file?.text ?? '');
    }
  }, [work]);

  const load = useCallback(async () => {
    await migrateLegacyFlatFiles();
    const list = await listWorkFiles(work);
    if (list.length === 0) {
      setMissing(true);
      setLoaded(true);
      return;
    }
    const entryPath = pickEntry(list.map(f => f.path));
    setFiles(list);
    setEntry(entryPath);
    const path = entryPath ?? list[0].path;
    setCurrentPath(path);
    await loadFile(path);
    const data = await getAppData(work);
    setPreviewData(data);
    appDataRef.current = data;
    setMissing(false);
    setLoaded(true);
    void touchFileOpened(work);
  }, [work, loadFile]);

  useEffect(() => { void load(); }, [load]);

  const entryHtml = entry !== null && isHtmlPath(entry);
  const isEntryView = currentPath === entry;
  const canPreview = entryHtml && isEntryView;

  // 预览文档：存储垫片（按作品名分库）
  const previewHtml = useMemo(() => {
    if (!canPreview || !loaded || missing) return '';
    return injectScripts(text, [buildStorageShimScript(previewData)]);
  }, [text, previewData, previewToken, canPreview, loaded, missing]);

  // iframe 消息桥：应用数据回写
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;
      if (data.__yiyanAppData && typeof data.__yiyanAppData === 'object') {
        const next = data.__yiyanAppData as Record<string, string>;
        appDataRef.current = next;
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          void saveAppData(work, appDataRef.current);
        }, 400);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [work]);

  const save = async () => {
    try {
      await writeWorkText(work, currentPath, draft, { reason: 'save' });
      setText(draft);
      setEditing(false);
      flash('已保存（旧版本已存快照）');
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

  const handleRenameWork = async () => {
    const next = renameValue.trim();
    if (!next || next === work) { setRenaming(false); return; }
    try {
      const saved = await renameWork(work, next);
      setRenaming(false);
      navigate(`/files/${encodeURIComponent(saved)}`, { replace: true });
    } catch {
      window.alert('改名失败，请重试');
    }
  };

  const handleDuplicate = async () => {
    try {
      const copy = await duplicateWork(work);
      navigate(`/files/${encodeURIComponent(copy)}`);
    } catch {
      window.alert('复制失败，请重试');
    }
  };

  const handleDeleteWork = async () => {
    if (!window.confirm(`确定删除作品「${work}」吗？全部文件、快照与应用数据都会没。`)) return;
    try {
      await deleteWork(work);
      navigate('/files');
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  const handleNewFile = async () => {
    const path = newFileName.trim();
    if (!path) return;
    try {
      const saved = await writeWorkText(work, path, '', { reason: 'system' });
      setPanel(null);
      setNewFileName('');
      await load();
      setCurrentPath(saved.split('/').slice(1).join('/') || path);
      flash(`已创建 ${path}`);
    } catch {
      window.alert('创建失败，请重试');
    }
  };

  const handleImportFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    let ok = 0;
    for (const file of Array.from(list)) {
      try {
        const path = file.name.replace(/[\\/]/g, '-').trim();
        if (isImagePath(path)) {
          const buf = new Uint8Array(await file.arrayBuffer());
          await writeWorkBinary(work, path, bytesToBase64(buf));
        } else {
          await writeWorkText(work, path, await file.text(), { reason: 'system' });
        }
        ok += 1;
      } catch {
        /* skip */
      }
    }
    await load();
    flash(ok > 0 ? `已导入 ${ok} 个文件` : '没有导入任何文件');
  };

  const handleDeleteFile = async () => {
    if (!window.confirm(`删除「${currentPath}」？`)) return;
    try {
      await deleteWorkFile(work, currentPath);
      await load();
      flash('已删除');
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  const openVersions = async () => {
    setPanel('versions');
    setVersions(await listVersions(`${work}/${currentPath}`));
  };

  const openAppData = async () => {
    setPanel('appdata');
    setAppStat(await appDataStats(work));
  };

  const handleRollback = async (v: FileVersion) => {
    if (!window.confirm(`回滚到 ${new Date(v.ts).toLocaleString()} 的版本？当前内容会先存为快照。`)) return;
    try {
      await writeWorkText(work, currentPath, v.text, { reason: 'save' });
      setPanel(null);
      await load();
      flash('已回滚');
    } catch {
      window.alert('回滚失败，请重试');
    }
  };

  const handleDeleteVersion = async (v: FileVersion) => {
    if (v.id == null) return;
    if (!window.confirm(`删除 ${new Date(v.ts).toLocaleString()} 这份快照？`)) return;
    await deleteVersion(v.id);
    setVersions(await listVersions(`${work}/${currentPath}`));
  };

  const handleClearAppData = async () => {
    if (!window.confirm(`清空「${work}」的全部应用数据？作品里记的内容会全没。`)) return;
    await clearAppData(work);
    appDataRef.current = {};
    setPreviewData({});
    setPreviewToken(t => t + 1);
    setAppStat({ keys: 0, bytes: 0 });
    flash('应用数据已清空');
  };

  const handleExportAppData = async () => {
    const data = await getAppData(work);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${work.replace(/\.[^.]+$/, '')}-数据.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const switchFile = async (path: string) => {
    if (path === currentPath) return;
    setEditing(false);
    setCurrentPath(path);
    await loadFile(path);
  };

  return (
    <div className="file-view-page">
      <header className="files-head">
        <button type="button" className="files-back" onClick={() => goBack(navigate, '/files')} title="返回上一页">
          <IconBack />
        </button>
        <div className="files-title">
          <h1 className="file-view-name">{work || '作品'}</h1>
          <span className="files-sub">
            {files.length} 个文件{dirtyHint ? ` · ${dirtyHint}` : ''}
          </span>
        </div>
        <div className="file-view-actions">
          {canPreview && !editing && (
            <button
              type="button"
              className="files-icon-btn"
              onClick={() => setMode(mode === 'preview' ? 'source' : 'preview')}
              title={mode === 'preview' ? '看源码' : '看预览'}
            >
              {mode === 'preview' ? '源码' : '预览'}
            </button>
          )}
          {!editing && !imageData && (
            <button type="button" className="files-icon-btn" onClick={copyAll} title="复制全文">
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          )}
          {!editing && !imageData && (
            <button type="button" className="files-icon-btn" onClick={() => setEditing(true)} title="编辑当前文件">
              <IconEdit size={14} />
            </button>
          )}
          {editing && (
            <>
              <button type="button" className="files-icon-btn" onClick={() => { setDraft(text); setEditing(false); }}>取消</button>
              <button type="button" className="files-icon-btn primary" onClick={save}>保存</button>
            </>
          )}
          <button type="button" className="files-icon-btn danger" onClick={handleDeleteWork} title="删除作品">
            <IconTrash size={14} />
          </button>
        </div>
      </header>

      {/* 文件条：作品内的文件切换 */}
      {loaded && !missing && (
        <div className="file-view-tools">
          {files.map(f => (
            <button
              key={f.path}
              type="button"
              className={`files-chip ${f.path === currentPath ? 'active' : ''}`}
              onClick={() => void switchFile(f.path)}
            >
              {f.path}
            </button>
          ))}
          <button type="button" className="files-chip ghost" onClick={() => { setNewFileName('app.js'); setPanel('newfile'); }}>
            <IconPlus size={12} /> 文件
          </button>
          <button type="button" className="files-chip ghost" onClick={() => importInputRef.current?.click()}>导入</button>
          <input
            ref={importInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={e => { void handleImportFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}

      {/* 工具行 */}
      {loaded && !missing && !editing && (
        <div className="file-view-tools">
          <button type="button" className="files-chip" onClick={() => void openVersions()}>历史版本</button>
          {entryHtml && (
            <button type="button" className="files-chip" onClick={() => void openAppData()}>应用数据</button>
          )}
          <button type="button" className="files-chip" onClick={handleDeleteFile}>删除此文件</button>
          <button type="button" className="files-chip" onClick={() => { setRenameValue(work); setRenaming(true); }}>
            <IconRename size={12} /> 重命名
          </button>
          <button type="button" className="files-chip" onClick={handleDuplicate}>复制一份</button>
          <span className="file-view-tools-note">
            {entryHtml ? '封面取自 meta name="cover"' : ''}
          </span>
        </div>
      )}

      {!loaded && <div className="files-empty">加载中…</div>}
      {loaded && missing && (
        <div className="files-empty">
          <p>这个作品不存在（可能已被删除）。</p>
          <button type="button" className="files-create-btn" onClick={() => navigate('/files')}>回作品列表</button>
        </div>
      )}

      {renaming && (
        <div className="files-modal-mask" onClick={() => setRenaming(false)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>重命名作品</h3>
            <input
              className="files-create-input"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleRenameWork(); }}
              autoFocus
            />
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={() => setRenaming(false)}>取消</button>
              <button type="button" className="files-create-btn" onClick={handleRenameWork}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建文件 */}
      {panel === 'newfile' && (
        <div className="files-modal-mask" onClick={() => setPanel(null)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>新建文件</h3>
            <input
              className="files-create-input"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleNewFile(); }}
              placeholder="相对路径，如 app.css 或 assets/a.png"
              autoFocus
            />
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={() => setPanel(null)}>取消</button>
              <button type="button" className="files-create-btn" onClick={handleNewFile}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 历史版本面板 */}
      {panel === 'versions' && (
        <div className="files-modal-mask" onClick={() => setPanel(null)}>
          <div className="files-modal wide" onClick={e => e.stopPropagation()}>
            <h3>历史版本 · {currentPath}（滚动保留最近 {VERSION_KEEP} 份）</h3>
            {versions.length === 0 && (
              <p className="files-empty-hint">还没有快照喵。以后每次保存或 AI 覆盖写之前，旧内容会自动存一份。</p>
            )}
            <div className="version-list">
              {versions.map(v => (
                <div key={v.id} className="version-row">
                  <div className="version-info">
                    <span className="version-time">{new Date(v.ts).toLocaleString()}</span>
                    <span className="version-meta">{formatFileSize(new Blob([v.text]).size)} · {REASON_LABEL[v.reason]}</span>
                  </div>
                  <div className="version-acts">
                    <button type="button" className="files-chip" onClick={() => void handleRollback(v)}>回滚</button>
                    <button type="button" className="files-chip danger" onClick={() => void handleDeleteVersion(v)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn" onClick={() => setPanel(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 应用数据面板 */}
      {panel === 'appdata' && (
        <div className="files-modal-mask" onClick={() => setPanel(null)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>应用数据</h3>
            <p className="files-empty-hint">
              作品里的 localStorage 由存储垫片托管，按作品名分库保存。
              当前：{appStat.keys} 个键 · 约 {formatFileSize(appStat.bytes)}。
            </p>
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={() => void handleExportAppData()}>导出 JSON</button>
              <button type="button" className="files-create-btn danger" onClick={() => void handleClearAppData()}>清空数据</button>
              <button type="button" className="files-create-btn" onClick={() => setPanel(null)}>关闭</button>
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

      {loaded && !missing && !editing && imageData && (
        <div className="file-view-body"><img className="file-view-image" src={imageData} alt={currentPath} /></div>
      )}

      {loaded && !missing && !editing && !imageData && (!canPreview || mode === 'source') && (
        <div className="file-view-body"><pre>{text}</pre></div>
      )}

      {loaded && !missing && !editing && canPreview && mode === 'preview' && (
        <iframe
          key={previewToken}
          ref={iframeRef}
          className="file-view-frame"
          title={work}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          srcDoc={previewHtml}
        />
      )}
    </div>
  );
}
