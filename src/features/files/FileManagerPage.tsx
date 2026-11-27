/**
 * 文件与作品管理器（v3.8.0：作品文件夹 / 图标网格 / 双区域 / 导入）
 *
 * 这是「小型应用平台」的启动器喵：
 * - 一个作品 = 一个文件夹（入口 index.<ext> + css/js/图片），卡片展示封面；
 * - 图标网格（仿资源管理器大图标），旧列表视图已砍；
 * - 双区域：
 *   1) 固定区 = 置顶作品 + 1 个随机展示位（按天换，偏向最久没打开的，防遗忘）；
 *   2) 默认区 = 其余作品按最近使用时间倒序；
 * - 封面：只认入口 html 里的 `<meta name="cover" content="...">`（AI 用 draw_image 画好放作品里）；
 * - 导入：从系统文件管理器选 html/文本/图片进来，每个文件自动变一个作品；
 * - 长按卡片（桌面右键）出操作菜单：置顶/排序/重命名/复制/删除。
 *
 * 两种形态：
 * - 独立页 `#/files`（带返回）
 * - 嵌入设置页（embedded，无返回、高度自适应、背景透明）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createWork,
  deleteWork,
  duplicateWork,
  entryNameFor,
  formatFileSize,
  formatRelativeTime,
  isHtmlPath,
  isImagePath,
  listWorks,
  migrateLegacyFlatFiles,
  renameWork,
  uniqueWorkName,
  writeWorkBinary,
  writeWorkText,
  type WorkInfo,
} from '@/services/workLibrary';
import {
  getMetaMap,
  updateFileMeta,
  type FileMeta,
} from '@/services/fileAssets';
import { extractWorkCover } from '@/utils/workCover';
import { bytesToBase64 } from '@/services/traeImage';
import { describeBundleResult, importBundle, looksLikeZip } from '@/services/workBundle';
import { localDateKey } from '@/utils/localDate';
import { IconBack, IconPlus, IconTrash, IconCopy, IconEdit, IconCheck, IconMore } from '@/components/icons';
import { goBack } from '@/utils/navBack';
import './Files.css';

type Filter = 'all' | 'html' | 'text' | 'other';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'html', label: '网页' },
  { key: 'text', label: '文本' },
  { key: 'other', label: '其它' },
];

const IMPORT_ACCEPT = '.html,.htm,.txt,.md,.markdown,.css,.js,.json,.csv,.svg,.xml,.yml,.yaml,.png,.jpg,.jpeg,.gif,.webp,.zip';

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
  if (isHtmlPath(name)) return 'HTML';
  if (/\.md$/i.test(name)) return 'MD';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'TXT';
  return ext.slice(0, 4);
}

function kindOf(name: string): Filter {
  if (isHtmlPath(name)) return 'html';
  if (/\.(md|txt|json|csv|ts|js|css|xml|yml|yaml)$/i.test(name)) return 'text';
  return 'other';
}

/** FNV-1a：给「每日一亮」做确定性随机种子 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface CardItem {
  work: WorkInfo;
  meta?: FileMeta;
  cover?: string;
}

interface FileManagerPageProps {
  /** 嵌入设置页时传 true：不显示返回、不占满整屏 */
  embedded?: boolean;
}

export function FileManagerPage({ embedded = false }: FileManagerPageProps) {
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkInfo[]>([]);
  const [metaMap, setMetaMap] = useState<Record<string, FileMeta>>({});
  const [coverMap, setCoverMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('demo.html');
  const [template, setTemplate] = useState('html');
  const [renaming, setRenaming] = useState<WorkInfo | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuFor, setMenuFor] = useState<WorkInfo | null>(null);
  const [toast, setToast] = useState('');
  const [importing, setImporting] = useState('');
  const [barMenu, setBarMenu] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  const flash = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 1800);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await migrateLegacyFlatFiles();
      const [list, meta] = await Promise.all([listWorks(), getMetaMap()]);
      const covers: Record<string, string> = {};
      await Promise.all(list.map(async item => {
        const cover = await extractWorkCover(item.name, item.entry);
        if (cover) covers[item.name] = cover;
      }));
      setWorks(list);
      setMetaMap(meta);
      setCoverMap(covers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: works.length, html: 0, text: 0, other: 0 };
    for (const work of works) base[kindOf(work.name)] += 1;
    return base;
  }, [works]);

  const searching = keyword.trim().length > 0 || filter !== 'all';

  const items = useMemo<CardItem[]>(() => {
    const key = keyword.trim().toLowerCase();
    return works
      .filter(work => {
        if (filter !== 'all' && kindOf(work.name) !== filter) return false;
        if (key && !work.name.toLowerCase().includes(key)) return false;
        return true;
      })
      .map(work => ({ work, meta: metaMap[work.name], cover: coverMap[work.name] }));
  }, [works, filter, keyword, metaMap, coverMap]);

  const pinnedItems = useMemo(
    () => items.filter(i => i.meta?.pinned).sort((a, b) => (a.meta?.pinOrder ?? 0) - (b.meta?.pinOrder ?? 0)),
    [items],
  );

  const unpinnedItems = useMemo(() => items.filter(i => !i.meta?.pinned), [items]);

  /** 每日一亮：最久没打开的前 1/3 里按日期种子抽一张（同一天稳定） */
  const dailyPick = useMemo<CardItem | null>(() => {
    if (searching || unpinnedItems.length === 0) return null;
    const stalest = [...unpinnedItems].sort(
      (a, b) => (a.meta?.lastOpenedAt ?? 0) - (b.meta?.lastOpenedAt ?? 0),
    );
    const pool = stalest.slice(0, Math.max(1, Math.ceil(stalest.length / 3)));
    return pool[hashStr(localDateKey()) % pool.length];
  }, [unpinnedItems, searching]);

  /** 默认区：最近使用倒序（今日一亮已经露过脸的不重复出现） */
  const recentItems = useMemo(() => {
    const arr = unpinnedItems.filter(item => item.work.name !== dailyPick?.work.name);
    arr.sort((a, b) => {
      const ta = a.meta?.lastOpenedAt || a.work.mtime || 0;
      const tb = b.meta?.lastOpenedAt || b.work.mtime || 0;
      return tb - ta || a.work.name.localeCompare(b.work.name);
    });
    return arr;
  }, [unpinnedItems, dailyPick]);

  const totalSize = useMemo(() => works.reduce((sum, w) => sum + (w.size || 0), 0), [works]);

  // v4.2.2：退出作品统一落到「文件与作品」列表（/files），不再回设置面板。
  // 原因：设置里的管理器和独立 /files 是同一个列表的两种壳，退出回设置页会让用户
  // 觉得「我只是关掉一个 html，怎么跑到设置里了」；而 /files 自己有返回键能回设置。
  // 另：这一条让「退出」有明确目的地，不再依赖 history.back() 猜上一页。
  const openWork = (name: string) => navigate(`/files/${encodeURIComponent(name)}`, {
    state: { yiyanBackTo: '/files' },
  });

  // ===== 长按 / 右键菜单 =====
  const startPress = (work: WorkInfo) => {
    cancelPress();
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setMenuFor(work);
    }, 500);
  };
  const cancelPress = () => {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  // ===== 选择模式（格子右上角小标记进入，只复用已有的删除/置顶动作） =====
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(prev => (prev.size >= items.length ? new Set<string>() : new Set(items.map(i => i.work.name))));
  };

  const handleDeleteSelected = async () => {
    const names = Array.from(selected);
    if (names.length === 0) return;
    if (!window.confirm(`删除选中的 ${names.length} 个作品？全部文件、快照与应用数据都会没。`)) return;
    try {
      for (const name of names) await deleteWork(name);
      exitSelect();
      await refresh();
      flash(`已删除 ${names.length} 个作品`);
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  // ===== 作品操作 =====
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const tpl = TEMPLATES.find(item => item.key === template) ?? TEMPLATES[0];
    try {
      await createWork(name, entryNameFor(name), tpl.content);
      setCreating(false);
      setNewName('demo.html');
      await refresh();
      flash(`已创建 ${name}`);
    } catch {
      window.alert('创建失败，请重试');
    }
  };

  const handleImport = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    let ok = 0;
    const notes: string[] = [];
    const failures: string[] = [];

    for (const file of Array.from(list)) {
      try {
        // 作品包：一个 zip = 一个作品（清单 + 生成的目录页）
        if (await looksLikeZip(file)) {
          setImporting(`导入 ${file.name}`);
          const result = await importBundle(file, {
            onProgress: (done, total) => setImporting(`解包 ${done}/${total}`),
          });
          if (result.ok) {
            ok += 1;
            notes.push(describeBundleResult(result));
            if (result.warnings.length > 0) notes.push(`· ${result.warnings.join('；')}`);
          } else {
            failures.push(`「${file.name}」没导入：${result.message ?? '未知原因'}`);
          }
          continue;
        }

        const name = await uniqueWorkName(file.name);
        const entry = entryNameFor(file.name);
        if (isImagePath(file.name)) {
          const buf = new Uint8Array(await file.arrayBuffer());
          await writeWorkBinary(name, entry, bytesToBase64(buf));
        } else {
          const text = await file.text();
          await writeWorkText(name, entry, text, { reason: 'system' });
        }
        ok += 1;
      } catch (err) {
        failures.push(`「${file.name}」导入出错：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setImporting('');
    await refresh();
    if (failures.length > 0) {
      window.alert([...failures, ...notes].join('\n\n'));
    }
    if (ok > 0) {
      flash(notes[0] ?? `已导入 ${ok} 个作品`);
    } else if (failures.length === 0) {
      flash('没有导入任何文件');
    }
  };

  const handleRename = async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming.name) { setRenaming(null); return; }
    try {
      const saved = await renameWork(renaming.name, next);
      setRenaming(null);
      await refresh();
      flash(`已改名为 ${saved}`);
    } catch {
      window.alert('改名失败，请重试');
    }
  };

  const handleDuplicate = async (name: string) => {
    try {
      const copy = await duplicateWork(name);
      await refresh();
      flash(`已复制为 ${copy}`);
    } catch {
      window.alert('复制失败，请重试');
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`确定删除作品「${name}」吗？全部文件、快照与应用数据都会没。`)) return;
    try {
      await deleteWork(name);
      await refresh();
      flash(`已删除 ${name}`);
    } catch {
      window.alert('删除失败，请重试');
    }
  };

  const handleTogglePin = async (name: string) => {
    const meta = metaMap[name];
    if (meta?.pinned) {
      await updateFileMeta(name, { pinned: false });
      flash('已取消置顶');
    } else {
      await updateFileMeta(name, { pinned: true, pinOrder: Date.now() });
      flash('已置顶');
    }
    setMenuFor(null);
    await refresh();
  };

  const handleMovePin = async (name: string, dir: -1 | 1) => {
    const list = pinnedItems;
    const idx = list.findIndex(i => i.work.name === name);
    const swapWith = list[idx + dir];
    if (idx < 0 || !swapWith) return;
    const a = list[idx].meta?.pinOrder ?? 0;
    const b = swapWith.meta?.pinOrder ?? 0;
    await updateFileMeta(name, { pinOrder: b });
    await updateFileMeta(swapWith.work.name, { pinOrder: a });
    setMenuFor(null);
    await refresh();
  };

  // ===== 渲染 =====
  const renderCard = (item: CardItem, marks?: { pin?: boolean; daily?: boolean }) => {
    const { work, meta, cover } = item;
    const usedAt = meta?.lastOpenedAt || work.mtime || 0;
    const picked = selected.has(work.name);
    return (
      <div key={work.name} className={`files-tile s-item ${picked ? 'picked' : ''}`}>
        <button
          type="button"
          className="files-tile-main"
          onClick={() => (selectMode ? toggleSelect(work.name) : openWork(work.name))}
          onPointerDown={() => { if (!selectMode) startPress(work); }}
          onPointerUp={cancelPress}
          onPointerMove={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={e => { e.preventDefault(); setMenuFor(work); }}
          title={selectMode ? '选中' : `打开 ${work.name}`}
        >
          <span className="files-tile-thumb">
            {cover ? (
              <img className="files-tile-img" src={cover} alt="" loading="lazy" />
            ) : (
              <span className={`files-tile-fallback ${isHtmlPath(work.name) ? 'html' : ''}`}>{fileBadge(work.name)}</span>
            )}
            <span className="files-tile-shade" aria-hidden="true" />
            <span className="files-tile-cap">
              <span className="files-tile-name">{work.name}</span>
              <span className="files-tile-meta">
                {work.fileCount > 1 ? `${work.fileCount} 文件 · ` : ''}{formatFileSize(work.size)}
                {usedAt ? ` · ${formatRelativeTime(usedAt)}` : ''}
              </span>
            </span>
            {(marks?.pin || marks?.daily) && (
              <span className="files-badges">
                {marks?.pin && <span className="files-mark">置顶</span>}
                {marks?.daily && <span className="files-mark daily">今日</span>}
              </span>
            )}
            {selectMode && (
              <span className={`files-tile-check ${picked ? 'on' : ''}`} aria-hidden="true">
                {picked ? <IconCheck size={11} /> : null}
              </span>
            )}
          </span>
        </button>

        {!selectMode && (
          <button
            type="button"
            className="files-tile-pick"
            onClick={() => { setSelectMode(true); setSelected(new Set([work.name])); }}
            title="选择"
            aria-label="选择"
          />
        )}
      </div>
    );
  };

  return (
    <div className={`files-page ${embedded ? 'embedded' : ''} ${selectMode ? 'selecting' : ''}`}>
      {!embedded && (
        <header className="files-bar">
          <button
            type="button"
            className="files-bar-btn"
            onClick={() => goBack(navigate, '/')}
            title="返回上一页"
          >
            <IconBack />
          </button>
          <h1 className="files-bar-title">文件</h1>
          <div className="files-bar-right">
            <button
              type="button"
              className={`files-bar-btn ${barMenu ? 'on' : ''}`}
              onClick={() => setBarMenu(v => !v)}
              title="更多"
            >
              <IconMore size={18} />
            </button>
            {barMenu && (
              <>
                <div className="files-bar-scrim" onClick={() => setBarMenu(false)} />
                <div className="files-menu" role="menu">
                  <span className="files-menu-head">
                    {works.length} 个作品 · {formatFileSize(totalSize)}
                  </span>
                  <button
                    type="button"
                    className="files-menu-row"
                    disabled={importing !== ''}
                    onClick={() => { setBarMenu(false); importInputRef.current?.click(); }}
                  >
                    {importing || '导入文件 / 作品包'}
                  </button>
                  <button
                    type="button"
                    className="files-menu-row"
                    onClick={() => { setBarMenu(false); setCreating(true); }}
                  >
                    新建作品
                  </button>
                  <button
                    type="button"
                    className="files-menu-row"
                    onClick={() => { setBarMenu(false); setSelectMode(true); }}
                  >
                    批量选择
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
      )}

      {embedded && (
        <div className="files-embedded-head">
          <span className="files-embedded-meta">
            {works.length} 个作品 · {formatFileSize(totalSize)}
          </span>
          <div className="files-embedded-acts">
            <button
              type="button"
              className="files-mini-btn"
              disabled={importing !== ''}
              onClick={() => importInputRef.current?.click()}
            >
              {importing || '导入'}
            </button>
            <button type="button" className="files-mini-btn on" onClick={() => setCreating(true)}>
              <IconPlus size={13} /> 新建
            </button>
          </div>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          void handleImport(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="files-controls">
        <div className="files-seg" role="tablist" aria-label="按类型筛选">
          {FILTERS.map(item => (
            <button
              key={item.key}
              type="button"
              className={`files-seg-btn ${filter === item.key ? 'on' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="files-seg-count">{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <input
          className="files-search"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜索作品名"
        />
      </div>

      <div className="files-body">
        {loading && <div className="files-loading"><i />正在读取文件…</div>}

        {!loading && works.length === 0 && (
          <div className="files-empty">
            <b>这里还没有作品</b>
            <span>
              导入一个 html，或把整个网页文件夹打成 .mod.zip 一次放进；
              也可以去 Chat 让 AI 直接写 —— 记得在 MCP 面板勾上「文件与作品」。
            </span>
            <div className="files-empty-actions">
              <button type="button" className="files-create-btn" onClick={() => importInputRef.current?.click()}>导入文件</button>
              <button type="button" className="files-create-btn ghost" onClick={() => setCreating(true)}>新建空白</button>
              <button type="button" className="files-create-btn ghost" onClick={() => navigate('/chat')}>去 Chat 写</button>
            </div>
          </div>
        )}

        {!loading && works.length > 0 && items.length === 0 && (
          <div className="files-empty">
            <b>没有匹配「{keyword || FILTERS.find(f => f.key === filter)?.label}」的作品</b>
            <span>换个关键词，或者把上面的筛选切回「全部」。</span>
          </div>
        )}

        {/* 搜索/筛选：扁平网格 */}
        {!loading && searching && items.length > 0 && (
          <div className="files-grid">{items.map(item => renderCard(item))}</div>
        )}

        {/* 双区域 */}
        {!loading && !searching && items.length > 0 && (
          <>
            {(pinnedItems.length > 0 || dailyPick) && (
              <section className="files-zone">
                <h2 className="files-zone-title">置顶与推荐</h2>
                <div className="files-grid">
                  {pinnedItems.map(item => renderCard(item, { pin: true }))}
                  {dailyPick && renderCard(dailyPick, { daily: true })}
                </div>
              </section>
            )}
            {recentItems.length > 0 && (
              <section className="files-zone">
                <h2 className="files-zone-title">最近使用</h2>
                <div className="files-grid">{recentItems.map(item => renderCard(item))}</div>
              </section>
            )}
          </>
        )}
      </div>

      {/* 选择模式：底部一条计数 + 动作 */}
      {selectMode && (
        <div className="files-select-bar">
          <button type="button" className="files-select-ghost" onClick={toggleSelectAll}>
            {selected.size >= items.length ? '取消全选' : '全选'}
          </button>
          <span className="files-select-count">{selected.size} 项</span>
          <button
            type="button"
            className="files-select-del"
            disabled={selected.size === 0}
            onClick={() => void handleDeleteSelected()}
          >
            <IconTrash size={14} /> 删除
          </button>
          <button type="button" className="files-select-ghost" onClick={exitSelect}>完成</button>
        </div>
      )}

      {/* 长按 / 右键操作菜单 */}
      {menuFor && (
        <div className="files-sheet-mask" onClick={() => setMenuFor(null)}>
          <div className="files-sheet" onClick={e => e.stopPropagation()}>
            <span className="sheet-grabber" aria-hidden="true" />
            <div className="sheet-head">
              <h3>{menuFor.name}</h3>
              <span className="sheet-sub">
                {formatFileSize(menuFor.size)}{menuFor.fileCount > 1 ? ` · ${menuFor.fileCount} 文件` : ''}
              </span>
            </div>
            <div className="files-menu-list">
              <button type="button" className="files-menu-item" onClick={() => void handleTogglePin(menuFor.name)}>
                {metaMap[menuFor.name]?.pinned ? '取消置顶' : '置顶'}
              </button>
              {metaMap[menuFor.name]?.pinned && (
                <>
                  <button type="button" className="files-menu-item" onClick={() => void handleMovePin(menuFor.name, -1)}>上移</button>
                  <button type="button" className="files-menu-item" onClick={() => void handleMovePin(menuFor.name, 1)}>下移</button>
                </>
              )}
              <button
                type="button"
                className="files-menu-item"
                onClick={() => { setRenaming(menuFor); setRenameValue(menuFor.name); setMenuFor(null); }}
              >
                <IconEdit size={14} /> 重命名
              </button>
              <button type="button" className="files-menu-item" onClick={() => { void handleDuplicate(menuFor.name); setMenuFor(null); }}>
                <IconCopy size={14} /> 复制一份
              </button>
              <button type="button" className="files-menu-item danger" onClick={() => { void handleDelete(menuFor.name); setMenuFor(null); }}>
                <IconTrash size={14} /> 删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建弹层 */}
      {creating && (
        <div className="files-modal-mask" onClick={() => setCreating(false)}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>新建作品</h3>
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
              placeholder="作品名，如 demo.html"
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
            <h3>重命名作品</h3>
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
