/**
 * 文件管理器（v3.6.7）
 *
 * 使用场景想清楚了再画的：
 * 1. AI 写完 html → 人只想「点开看看」→ 主区域整块可点，直接全屏预览；
 * 2. 迭代同一件作品 → 「复制一份」而不是覆盖，留个后悔的余地；
 * 3. 名字乱（pet-pixel-final-v2）→ 「重命名」不用去别处；
 * 4. 文件多了 → 搜索 + 类型筛选 + 最近修改排前面；
 * 5. 手机上按钮要够大 → 每个卡片下方一整行操作，不搞 hover 才出现的小图标。
 *
 * 两种形态：
 * - 独立页 `#/files`（带返回）
 * - 嵌入设置页（embedded，无返回、高度自适应、背景透明）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  deleteLibraryFile,
  duplicateLibraryFile,
  formatFileSize,
  formatRelativeTime,
  isHtmlFile,
  isMarkdownFile,
  listLibraryFiles,
  renameLibraryFile,
  writeLibraryFile,
  type LibraryFile,
} from '@/services/fileLibrary';
import { IconBack, IconFile, IconPlus, IconTrash, IconCopy, IconEdit, IconCheck } from '@/components/icons';
import { goBack } from '@/utils/navBack';
import './Files.css';

type Filter = 'all' | 'html' | 'text' | 'other';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'html', label: 'HTML' },
  { key: 'text', label: '文本' },
  { key: 'other', label: '其他' },
];

const TEMPLATES: Array<{ key: string; label: string; name: string; content: string }> = [
  { key: 'blank', label: '空白', name: 'untitled.txt', content: '' },
  {
    key: 'html',
    label: 'HTML 页面',
    name: 'demo.html',
    content: '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>新作品</title>\n  <style>\n    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14151a; color: #f5f5f7; font-family: system-ui, sans-serif; }\n    h1 { font-weight: 600; letter-spacing: 1px; }\n  </style>\n</head>\n<body>\n  <h1>新作品</h1>\n</body>\n</html>\n',
  },
  {
    key: 'md',
    label: 'Markdown 笔记',
    name: 'note.md',
    content: '# 标题\n\n正文…\n',
  },
];

/** 按扩展名给个小标识（没有图标库依赖，纯文本标签） */
function fileBadge(name: string): string {
  if (isHtmlFile(name)) return 'HTML';
  if (isMarkdownFile(name)) return 'MD';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'TXT';
  return ext.slice(0, 4);
}

function kindOf(name: string): Filter {
  if (isHtmlFile(name)) return 'html';
  if (isMarkdownFile(name) || /\.(txt|json|csv|ts|js|css|xml|yml|yaml)$/i.test(name)) return 'text';
  return 'other';
}

interface FileManagerPageProps {
  /** 嵌入设置页时传 true：不显示返回、不占满整屏 */
  embedded?: boolean;
}

export function FileManagerPage({ embedded = false }: FileManagerPageProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('demo.html');
  const [template, setTemplate] = useState('html');
  const [renaming, setRenaming] = useState<LibraryFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [toast, setToast] = useState('');

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 1800);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await listLibraryFiles());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: files.length, html: 0, text: 0, other: 0 };
    for (const file of files) base[kindOf(file.name)] += 1;
    return base;
  }, [files]);

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return files.filter(file => {
      if (filter !== 'all' && kindOf(file.name) !== filter) return false;
      if (key && !file.name.toLowerCase().includes(key)) return false;
      return true;
    });
  }, [files, filter, keyword]);

  const totalSize = useMemo(() => files.reduce((sum, file) => sum + (file.size || 0), 0), [files]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const tpl = TEMPLATES.find(item => item.key === template) ?? TEMPLATES[0];
    try {
      await writeLibraryFile(name, tpl.content);
      setCreating(false);
      setNewName('demo.html');
      await refresh();
      flash(`已创建 ${name}`);
    } catch {
      window.alert('创建失败，请重试');
    }
  };

  const handleRename = async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming.name) { setRenaming(null); return; }
    try {
      const saved = await renameLibraryFile(renaming.name, next);
      setRenaming(null);
      await refresh();
      flash(`已改名为 ${saved}`);
    } catch {
      window.alert('改名失败，请重试');
    }
  };

  const handleDuplicate = async (name: string) => {
    try {
      const copy = await duplicateLibraryFile(name);
      await refresh();
      flash(`已复制为 ${copy}`);
    } catch {
      window.alert('复制失败，请重试');
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确定删除「${name}」吗？删除后不可恢复。`)) return;
    try {
      await deleteLibraryFile(name);
      await refresh();
      flash(`已删除 ${name}`);
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  return (
    <div className={`files-page ${embedded ? 'embedded' : ''}`}>
      <header className="files-head">
        {!embedded && (
          <button type="button" className="files-back" onClick={() => goBack(navigate, '/')} title="返回上一页">
            <IconBack />
          </button>
        )}
        <div className="files-title">
          <h1>文件管理器</h1>
          <span className="files-sub">
            {files.length} 个文件 · {formatFileSize(totalSize)}{counts.html > 0 ? ` · ${counts.html} 个作品` : ''}
          </span>
        </div>
        <button type="button" className="files-new" onClick={() => setCreating(true)}>
          <IconPlus size={16} />
          <span>新建</span>
        </button>
      </header>

      <div className="files-tools">
        <input
          className="files-search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜索文件名…"
        />
        <div className="files-filters">
          {FILTERS.map(item => (
            <button
              key={item.key}
              type="button"
              className={`files-filter ${filter === item.key ? 'active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="files-filter-count">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="files-body">
        {loading && <div className="files-empty">读取中…</div>}

        {!loading && files.length === 0 && (
          <div className="files-empty">
            <IconFile size={30} />
            <p>还没有作品喵。</p>
            <p className="files-empty-hint">
              点右上角「新建」，或者去 Chat 让 AI 直接写一个 —— 记得在输入区的 MCP 面板勾上「文件库」，
              写完会自动出现在这里，点一下就全屏看。
            </p>
            <div className="files-empty-actions">
              <button type="button" className="files-create-btn" onClick={() => setCreating(true)}>新建空白文件</button>
              <button type="button" className="files-create-btn ghost" onClick={() => navigate('/chat')}>去 Chat 让 AI 写</button>
            </div>
          </div>
        )}

        {!loading && files.length > 0 && visible.length === 0 && (
          <div className="files-empty">
            <p>没有匹配「{keyword || FILTERS.find(f => f.key === filter)?.label}」的文件喵</p>
          </div>
        )}

        {visible.map(file => (
          <div key={file.name} className="files-card">
            <button
              type="button"
              className="files-card-main"
              onClick={() => navigate(`/files/${encodeURIComponent(file.name)}`)}
              title={`打开 ${file.name}`}
            >
              <span className={`files-badge ${isHtmlFile(file.name) ? 'html' : ''}`}>{fileBadge(file.name)}</span>
              <span className="files-row-text">
                <span className="files-row-name">{file.name}</span>
                <span className="files-row-meta">
                  {formatFileSize(file.size)}
                  {file.mtime ? ` · ${formatRelativeTime(file.mtime)}` : ''}
                </span>
              </span>
              {isHtmlFile(file.name) && <span className="files-preview-hint">点击预览</span>}
            </button>

            <div className="files-card-actions">
              <button type="button" className="files-act" onClick={() => { setRenaming(file); setRenameValue(file.name); }}>
                <IconEdit size={13} /><span>重命名</span>
              </button>
              <button type="button" className="files-act" onClick={() => void handleDuplicate(file.name)}>
                <IconCopy size={13} /><span>复制一份</span>
              </button>
              <button type="button" className="files-act danger" onClick={() => void handleDelete(file.name)}>
                <IconTrash size={13} /><span>删除</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 新建弹层 */}
      {creating && (
        <div className="files-modal-mask" onClick={() => setCreating(false)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>新建文件</h3>
            <div className="files-templates">
              {TEMPLATES.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={`files-template ${template === item.key ? 'active' : ''}`}
                  onClick={() => { setTemplate(item.key); setNewName(item.name); }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              className="files-create-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              placeholder="文件名，如 demo.html"
              autoFocus
            />
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={() => setCreating(false)}>取消</button>
              <button type="button" className="files-create-btn" onClick={handleCreate}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名弹层 */}
      {renaming && (
        <div className="files-modal-mask" onClick={() => setRenaming(null)}>
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
              <button type="button" className="files-create-btn ghost" onClick={() => setRenaming(null)}>取消</button>
              <button type="button" className="files-create-btn" onClick={handleRename}><IconCheck size={13} /> 保存</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="files-toast">{toast}</div>}
    </div>
  );
}
