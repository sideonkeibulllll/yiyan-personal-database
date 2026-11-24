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
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
  readWorkManifest,
  readWorkText,
  renameWork,
  writeWorkBinary,
  writeWorkText,
  type WorkFile,
  type WorkManifest,
} from '@/services/workLibrary';
import { listRecentPages, rememberPage } from '@/services/workRecent';
import { buildWorkCatalog } from '@/services/workCatalog';
import {
  clampLimit,
  DEFAULT_DAILY_LIMIT,
  MAX_DAILY_LIMIT,
  readWorkAiGrant,
  resetWorkAiUsage,
  runWorkAi,
  updateWorkAiGrant,
  type WorkAiGrant,
} from '@/services/workAi';
import type { WorkAiBridgeConfig } from '@/utils/workAiBridge';
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
import { buildWorkPreview, parseNavTarget } from '@/utils/workPreview';
import { bytesToBase64 } from '@/services/traeImage';
import { IconBack, IconCopy, IconCheck, IconEdit, IconTrash, IconRename, IconPlus } from '@/components/icons';
import { goBack } from '@/utils/navBack';
import './Files.css';

type Mode = 'preview' | 'source';
type Panel = null | 'pages' | 'actions' | 'ai' | 'versions' | 'appdata' | 'newfile';

interface PendingAiAsk {
  id: string;
  req: { kind: string; prompt: string; system?: string; thinking?: boolean; search?: boolean };
}

const ISLAND_POS_KEY = 'yiyan_island_pos_v1';

interface IslandPos {
  left: number;
  top: number;
}

/**
 * 读上次拖到的位置（相对作品页左上角的 CSS 像素）。
 * ⚠️ 这里绝对不能用 window.innerWidth/innerHeight 换算：
 * 部分 Android WebView 的 innerHeight 和 getBoundingClientRect / clientY
 * 不在同一坐标系（实测差近一倍），会导致球只能在中线以下活动、跟手只有半速。
 * 统一用页面容器的矩形做参照，两者同源就一定对得上。
 */
function loadIslandPos(): IslandPos | null {
  try {
    const raw = localStorage.getItem(ISLAND_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: number; top?: number };
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function saveIslandPos(pos: IslandPos): void {
  try {
    localStorage.setItem(ISLAND_POS_KEY, JSON.stringify(pos));
  } catch {
    /* 存不了无所谓 */
  }
}

const REASON_LABEL: Record<FileVersion['reason'], string> = {
  save: '手动保存',
  ai: 'AI 写入',
  system: '系统',
};

export function FileViewPage() {
  const { name: rawName } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const work = useMemo(() => decodeURIComponent(rawName ?? ''), [rawName]);

  // v4.1.0：chat 里的「已写入」卡片会带 ?page=相对路径，点开直接落在那页
  const requestedPage = useMemo(() => {
    const search = location.search || '';
    const match = /[?&]page=([^&]*)/.exec(search);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }, [location.search]);
  /** 同一次导航只消费一次 ?page，之后手动切页不会再被拽回去 */
  const consumedNavRef = useRef('');
  // v3.8.1：从设置页「文件与作品」内嵌管理器进来的，返回时直接落到该面板
  // （replace 掉详情页，避免多退一页退到设置首页）。
  const backTo = (location.state as { yiyanBackTo?: string } | null)?.yiyanBackTo;
  const handleBack = useCallback(() => {
    if (backTo) navigate(backTo, { replace: true });
    else goBack(navigate, '/files');
  }, [backTo, navigate]);

  const [files, setFiles] = useState<WorkFile[]>([]);
  const [entry, setEntry] = useState<string | null>(null);
  const [manifest, setManifest] = useState<WorkManifest | null>(null);
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
  // 文档和它的来源页绑在一起：只有 ready 的才拿去渲染 iframe。
  // （iframe 先挂载再改 srcDoc，部分内核不会重新加载文档，会白屏）
  const [previewDoc, setPreviewDoc] = useState<{ path: string; html: string } | null>(null);
  const [previewToken, setPreviewToken] = useState(0);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [aiGrant, setAiGrant] = useState<WorkAiGrant>(() => readWorkAiGrant(work));
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPendingAsk, setAiPendingAsk] = useState<PendingAiAsk | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [appStat, setAppStat] = useState<{ keys: number; bytes: number }>({ keys: 0, bytes: 0 });

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // 桥注入时的初始配置：只跟「日额度/联网开关」有关，不跟已用次数走。
  // 否则每调一次 AI 就重建一次 iframe，作品里的状态全丢。
  const aiCfgRef = useRef<WorkAiBridgeConfig>({ remaining: DEFAULT_DAILY_LIMIT, allowSearch: false });
  aiCfgRef.current = { remaining: aiGrant.dailyLimit, allowSearch: aiGrant.allowSearch };
  const appDataRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // 可拖动的悬浮球：收起是一颗球，点开横向展开成 退出 / 操作 / 选页
  const [islandPos, setIslandPos] = useState<IslandPos | null>(() => loadIslandPos());
  const [islandDim, setIslandDim] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hostWidth, setHostWidth] = useState(0);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIslandDim(true), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  // 容器的真实宽度：决定展开方向（球在右半边就向左长，在左半边就向右长）
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const measure = () => setHostWidth(el.getBoundingClientRect().width);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 恢复上次位置后按当前容器尺寸校正一次，换机型/换方向也不会把球留在屏幕外
  useEffect(() => {
    if (!islandPos) return;
    const host = pageRef.current;
    const el = islandRef.current;
    if (!host || !el) return;
    const box = host.getBoundingClientRect();
    const width = el.offsetWidth || 40;
    const height = el.offsetHeight || 40;
    const left = Math.min(Math.max(islandPos.left, 8), Math.max(8, box.width - width - 8));
    const top = Math.min(Math.max(islandPos.top, 8), Math.max(8, box.height - height - 8));
    if (Math.abs(left - islandPos.left) > 1 || Math.abs(top - islandPos.top) > 1) {
      setIslandPos({ left, top });
    }
    // 只在挂载时做一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // 作品包导入的作品带 mod.json，入口以清单为准（指向生成的目录页）
    const manifestDoc = await readWorkManifest(work);
    const entryPath = pickEntry(list.map(f => f.path), manifestDoc?.entry);
    setFiles(list);
    setEntry(entryPath);
    setManifest(manifestDoc);
    // chat 卡片带了具体页面就落过去；同一次导航只认一次，手动切页不会被拽回
    const navKey = `${location.key}|${requestedPage}`;
    const jumpTo = requestedPage
      && consumedNavRef.current !== navKey
      && list.some(item => item.path === requestedPage)
      ? requestedPage
      : '';
    if (jumpTo) consumedNavRef.current = navKey;
    const path = jumpTo || entryPath || list[0].path;
    setCurrentPath(path);
    await loadFile(path);
    const data = await getAppData(work);
    setPreviewData(data);
    appDataRef.current = data;
    setMissing(false);
    setLoaded(true);
    void touchFileOpened(work);
  }, [work, loadFile, requestedPage, location.key]);

  useEffect(() => { void load(); }, [load]);

  const entryHtml = entry !== null && isHtmlPath(entry);
  // v3.9.0：任意 html 页都能预览 —— 作品包里的页面要能互相点开
  const canPreview = isHtmlPath(currentPath);
  /** 当前这页是不是打包器生成的目录页 —— 只有它才回显「继续上次」 */
  const isCatalogPage = manifest?.generatedEntry === true && manifest.entry === currentPath;

  // 预览文档：当前页的相对资源懒内联 + 存储垫片 + 包内链接拦截
  useEffect(() => {
    let cancelled = false;
    if (!canPreview || !loaded || missing) {
      setPreviewDoc(null);
      return;
    }
    void (async () => {
      const report = await buildWorkPreview(work, currentPath, previewData, {
        recent: isCatalogPage ? listRecentPages(work) : [],
        ai: aiCfgRef.current,
      });
      if (cancelled) return;
      setPreviewDoc({ path: currentPath, html: report?.html ?? '' });
    })();
    return () => { cancelled = true; };
  }, [work, currentPath, previewData, previewToken, canPreview, loaded, missing, isCatalogPage]);

  /** 只有当前页的文档已经就绪，才允许渲染 iframe */
  const previewReady = previewDoc !== null && previewDoc.path === currentPath && previewDoc.html !== '';

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

  // iframe 消息桥：包内链接跳转（目录页点卡片 → 切到那一页继续预览）
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data.__yiyanNav !== 'string') return;
      const baseDir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : '';
      const target = parseNavTarget(baseDir, data.__yiyanNav);
      if (!target) return;
      if (!files.some(item => item.path === target.path)) {
        flash(`包里没有「${target.path}」`);
        return;
      }
      if (target.path !== entry) rememberPage(work, target.path);
      setEditing(false);
      setCurrentPath(target.path);
      void loadFile(target.path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [currentPath, files, loadFile, flash, entry, work]);

  // ===== 作品内 AI：请求 → 宿主调用 → 原路回传 =====
  const executeAi = useCallback(async (id: string, req: PendingAiAsk['req']) => {
    const reply = (payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ __yiyanAIResult: { id, ...payload } }, '*');
    };
    setAiBusy(true);
    try {
      const result = await runWorkAi({
        work,
        prompt: req.prompt,
        system: req.system,
        thinking: req.thinking,
        search: req.search,
        json: req.kind === 'json',
      });
      // 成功或失败都刷新一下额度显示
      setAiGrant(readWorkAiGrant(work));
      reply({
        ok: result.ok,
        text: result.text,
        data: result.data,
        error: result.error,
        code: result.code,
        remaining: result.remaining,
      });
    } catch (err) {
      reply({ ok: false, code: 'failed', error: err instanceof Error ? err.message : String(err), remaining: 0 });
    } finally {
      setAiBusy(false);
    }
  }, [work]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || ev.source !== win) return;
      const data = ev.data as { __yiyanAI?: PendingAiAsk['req'] & { id: string } } | null;
      const req = data?.__yiyanAI;
      if (!req || typeof req.id !== 'string') return;
      // 没授权就先弹确认卡，用户点了允许才真正调用
      if (!readWorkAiGrant(work).enabled) {
        setAiPendingAsk({ id: req.id, req });
        return;
      }
      void executeAi(req.id, req);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [work, executeAi]);

  const handleAllowAi = async () => {
    const pending = aiPendingAsk;
    setAiPendingAsk(null);
    setAiGrant(updateWorkAiGrant(work, { enabled: true }));
    if (pending) await executeAi(pending.id, pending.req);
  };

  const handleDenyAi = () => {
    const pending = aiPendingAsk;
    setAiPendingAsk(null);
    if (!pending) return;
    iframeRef.current?.contentWindow?.postMessage({
      __yiyanAIResult: {
        id: pending.id,
        ok: false,
        code: 'unauthorized',
        error: '用户没有授权这个作品使用 AI',
        remaining: 0,
      },
    }, '*');
  };

  const save = async () => {
    try {
      await writeWorkText(work, currentPath, draft, { reason: 'save' });
      setText(draft);
      setEditing(false);
      // 预览文档不依赖 text，保存后必须显式重建，否则看到的还是旧内容
      setPreviewToken(token => token + 1);
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
      navigate(`/files/${encodeURIComponent(saved)}`, { replace: true, state: backTo ? { yiyanBackTo: backTo } : undefined });
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

  /** 扫描作品里所有 html，生成 / 更新目录页 + mod.json */
  const handleBuildCatalog = async () => {
    try {
      const result = await buildWorkCatalog(work);
      if (!result.ok) {
        window.alert(result.message);
        return;
      }
      await load();
      flash(result.message);
    } catch {
      window.alert('生成目录页失败，请重试');
    }
  };

  const handleToggleAi = (enabled: boolean) => {
    setAiGrant(updateWorkAiGrant(work, { enabled }));
  };

  const handleAiLimitChange = (value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    setAiGrant(updateWorkAiGrant(work, { dailyLimit: clampLimit(num) }));
  };

  const handleToggleAiSearch = (allowSearch: boolean) => {
    setAiGrant(updateWorkAiGrant(work, { allowSearch }));
  };

  const handleResetAiUsage = () => {
    setAiGrant(resetWorkAiUsage(work));
    flash('今日 AI 用量已清零');
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
    if (path !== entry) rememberPage(work, path);
    setEditing(false);
    setCurrentPath(path);
    await loadFile(path);
  };

  /** 作品内所有 html 页面 —— 悬浮球的「选页」侧栏靠它，不用退回目录页重选 */
  const htmlPages = useMemo(() => {
    const list = files.filter(item => isHtmlPath(item.path));
    // 入口永远排第一，页码才有意义
    const index = list.findIndex(item => item.path === entry);
    if (index > 0) {
      const [head] = list.splice(index, 1);
      list.unshift(head);
    }
    return list;
  }, [files, entry]);
  const pageIndex = useMemo(
    () => htmlPages.findIndex(item => item.path === currentPath),
    [htmlPages, currentPath],
  );

  // ===== 悬浮球拖动（拖完记住位置，点按钮不误触） =====
  // 不能在 pointerdown 就 setPointerCapture：捕获后 click 会落到容器上，按钮永远点不动。
  // 也不用「增量累加」算位置：直接按「手指 - 抓取偏移」换算绝对坐标，
  // 只要 clientX 和容器矩形同坐标系，跟手就是 1:1，不会被缩放放大或缩小。
  const onIslandDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (expanded) return;
    const el = islandRef.current;
    const host = pageRef.current;
    if (!el || !host) return;
    const rect = el.getBoundingClientRect();
    const grabX = e.clientX - rect.left;
    const grabY = e.clientY - rect.top;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    setIslandDim(false);

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      moved = true;
      const box = host.getBoundingClientRect();
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const left = Math.min(
        Math.max(ev.clientX - box.left - grabX, 8),
        Math.max(8, box.width - width - 8),
      );
      const top = Math.min(
        Math.max(ev.clientY - box.top - grabY, 8),
        Math.max(8, box.height - height - 8),
      );
      setIslandPos({ left, top });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      // 拖动结束浏览器还会补一个 click，先吞掉，免得一拖就跳页
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 120);
      saveIslandPos({ left: el.offsetLeft, top: el.offsetTop });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="file-view-page" ref={pageRef}>
      {/* 悬浮球：收起是一颗球，点开向左长成 退出 / 操作 / 选页 三个圆钮 */}
      {!editing && (
        <>
          {expanded && <div className="island-scrim" onClick={() => setExpanded(false)} />}
          <div
            ref={islandRef}
            className={`file-island ${expanded ? `expanded ${islandPos && islandPos.left > hostWidth / 2 ? 'expand-left' : 'expand-right'}` : ''} ${islandDim && !expanded ? 'dim' : ''}`}
            style={islandPos
              ? { left: islandPos.left, top: islandPos.top, right: 'auto', bottom: 'auto' }
              : undefined}
            onPointerDown={onIslandDown}
            onClickCapture={e => {
              if (suppressClickRef.current) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            {expanded ? (
              <>
                <button
                  type="button"
                  className="island-orb"
                  onClick={() => { setExpanded(false); handleBack(); }}
                  title="退出作品"
                >
                  <IconBack size={17} />
                </button>
                <button
                  type="button"
                  className="island-orb"
                  onClick={() => { setExpanded(false); setPanel('actions'); }}
                  title="作品操作"
                >
                  <span className="orb-glyph">···</span>
                </button>
                {htmlPages.length > 1 && (
                  <button
                    type="button"
                    className="island-orb"
                    onClick={() => { setExpanded(false); setPanel('pages'); }}
                    title={`选择页面（${pageIndex >= 0 ? pageIndex + 1 : 1}/${htmlPages.length}）`}
                  >
                    <span className="orb-glyph list">≡</span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="island-orb main"
                onClick={() => { setExpanded(true); setIslandDim(false); }}
                title={`${work || '作品'}${pageIndex >= 0 ? ` · 第 ${pageIndex + 1}/${htmlPages.length} 页` : ''}`}
              >
                <span className="orb-glyph">···</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* 编辑态：底部一条保存栏，不跟悬浮球抢位置 */}
      {editing && (
        <div className="file-edit-bar">
          <button type="button" className="edit-bar-btn" onClick={() => { setDraft(text); setEditing(false); }}>取消</button>
          <span className="edit-bar-path">{currentPath}</span>
          <button type="button" className="edit-bar-btn primary" onClick={save}>保存</button>
        </div>
      )}

      {aiBusy && (
        <div className="work-ai-busy">
          <span className="work-ai-spinner" />
          <span>AI 正在思考…</span>
        </div>
      )}

      {dirtyHint && <div className="files-toast">{dirtyHint}</div>}

      <input
        ref={importInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => { void handleImportFiles(e.target.files); e.target.value = ''; }}
      />

      {/* 页面侧栏：从右边浮出来，盖在 html 上，不挤压内容 */}
      {panel === 'pages' && (
        <div className="files-side-mask" onClick={() => setPanel(null)}>
          <aside className="files-side" onClick={e => e.stopPropagation()}>
            <header className="side-head">
              <h3>页面</h3>
              <span className="side-count">{pageIndex >= 0 ? `${pageIndex + 1} / ${htmlPages.length}` : ''}</span>
              <button type="button" className="side-close" onClick={() => setPanel(null)} title="关闭">×</button>
            </header>
            <div className="side-tools">
              <button
                type="button"
                className="sheet-toggle"
                onClick={() => setShowAllFiles(value => !value)}
              >
                {showAllFiles ? `只看页面 ${htmlPages.length}` : `全部文件 ${files.length}`}
              </button>
            </div>
            <div className="side-list">
              {(showAllFiles ? files : htmlPages).map(item => (
                <button
                  key={item.path}
                  type="button"
                  className={`sheet-row ${item.path === currentPath ? 'active' : ''}`}
                  onClick={() => { void switchFile(item.path); setPanel(null); }}
                >
                  <span className="sheet-row-name">{item.path}</span>
                  {item.path === entry && <span className="sheet-row-tag">入口</span>}
                  <span className="sheet-row-meta">{formatFileSize(item.size)}</span>
                </button>
              ))}
              {!showAllFiles && htmlPages.length === 0 && (
                <p className="files-empty-hint">这个作品里没有 html 页面。</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* 操作抽屉：原本摊成两行的工具全收在这里 */}
      {panel === 'actions' && (
        <div className="files-sheet-mask" onClick={() => setPanel(null)}>
          <div className="files-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-grabber" />
            <div className="sheet-head">
              <h3>{work}</h3>
              <span className="sheet-sub">
                {files.length} 个文件 · {formatFileSize(files.reduce((sum, item) => sum + item.size, 0))}
              </span>
            </div>
            <div className="sheet-grid">
              {canPreview && (
                <button
                  type="button"
                  className="sheet-action"
                  onClick={() => { setMode(mode === 'preview' ? 'source' : 'preview'); setPanel(null); }}
                >
                  <span className="sheet-action-icon">{mode === 'preview' ? '</>' : '◉'}</span>
                  <span>{mode === 'preview' ? '源码' : '预览'}</span>
                </button>
              )}
              {!imageData && (
                <button
                  type="button"
                  className="sheet-action"
                  onClick={() => { setEditing(true); setPanel(null); }}
                >
                  <IconEdit size={17} />
                  <span>编辑</span>
                </button>
              )}
              {!imageData && (
                <button
                  type="button"
                  className="sheet-action"
                  onClick={() => { void copyAll(); setPanel(null); }}
                >
                  {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
                  <span>{copied ? '已复制' : '复制全文'}</span>
                </button>
              )}
              <button type="button" className="sheet-action" onClick={() => void openVersions()}>
                <span className="sheet-action-icon">⟲</span>
                <span>历史版本</span>
              </button>
              {canPreview && (
                <button type="button" className="sheet-action" onClick={() => void openAppData()}>
                  <span className="sheet-action-icon">{'{}'}</span>
                  <span>应用数据</span>
                </button>
              )}
              <button
                type="button"
                className="sheet-action"
                onClick={() => { setNewFileName('app.js'); setPanel('newfile'); }}
              >
                <IconPlus size={17} />
                <span>新建文件</span>
              </button>
              <button
                type="button"
                className="sheet-action"
                onClick={() => { setPanel(null); void handleBuildCatalog(); }}
              >
                <span className="sheet-action-icon">☰</span>
                <span>生成目录页</span>
              </button>
              <button
                type="button"
                className={`sheet-action ${aiGrant.enabled ? 'ai-on' : ''}`}
                onClick={() => setPanel('ai')}
              >
                <span className="sheet-action-icon">✦</span>
                <span>AI 权限</span>
              </button>
              <button type="button" className="sheet-action" onClick={() => importInputRef.current?.click()}>
                <span className="sheet-action-icon">↧</span>
                <span>导入文件</span>
              </button>
              <button
                type="button"
                className="sheet-action"
                onClick={() => { setRenameValue(work); setRenaming(true); setPanel(null); }}
              >
                <IconRename size={17} />
                <span>重命名</span>
              </button>
              <button
                type="button"
                className="sheet-action"
                onClick={() => { void handleDuplicate(); setPanel(null); }}
              >
                <span className="sheet-action-icon">⧉</span>
                <span>复制一份</span>
              </button>
              <button
                type="button"
                className="sheet-action"
                onClick={() => { setPanel(null); void handleDeleteFile(); }}
              >
                <span className="sheet-action-icon">−</span>
                <span>删除此文件</span>
              </button>
              <button
                type="button"
                className="sheet-action danger"
                onClick={() => { void handleDeleteWork(); setPanel(null); }}
              >
                <IconTrash size={17} />
                <span>删除作品</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 权限面板：开关 / 每日次数 / 联网授权 / 今日用量 */}
      {panel === 'ai' && (
        <div className="files-sheet-mask" onClick={() => setPanel(null)}>
          <div className="files-sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-grabber" />
            <div className="sheet-head">
              <h3>AI 权限</h3>
              <span className="sheet-sub">{work}</span>
            </div>
            <div className="ai-panel">
              <label className="ai-row">
                <span className="ai-row-label">允许这个作品使用 AI</span>
                <input
                  type="checkbox"
                  className="ai-switch"
                  checked={aiGrant.enabled}
                  onChange={e => handleToggleAi(e.target.checked)}
                />
              </label>
              <label className="ai-row">
                <span className="ai-row-label">
                  每天次数
                  <em className="ai-row-hint">默认 {DEFAULT_DAILY_LIMIT} 次，最多 {MAX_DAILY_LIMIT}</em>
                </span>
                <input
                  type="number"
                  className="ai-number"
                  min={1}
                  max={MAX_DAILY_LIMIT}
                  value={aiGrant.dailyLimit}
                  onChange={e => handleAiLimitChange(e.target.value)}
                />
              </label>
              <label className="ai-row">
                <span className="ai-row-label">
                  允许联网搜索
                  <em className="ai-row-hint">关着时作品就算请求 search 也会跳过</em>
                </span>
                <input
                  type="checkbox"
                  className="ai-switch"
                  checked={aiGrant.allowSearch}
                  onChange={e => handleToggleAiSearch(e.target.checked)}
                />
              </label>
              <p className="ai-usage">
                今日已用 {Math.min(aiGrant.used, aiGrant.dailyLimit)} / {aiGrant.dailyLimit} 次
                · 相同问题 5 分钟内复用结果
              </p>
              <div className="files-modal-actions">
                <button type="button" className="files-create-btn ghost" onClick={handleResetAiUsage}>清空今日用量</button>
                <button type="button" className="files-create-btn" onClick={() => setPanel(null)}>关闭</button>
              </div>
            </div>
          </div>
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

      {/* AI 授权确认：作品第一次请求时弹一次 */}
      {aiPendingAsk && (
        <div className="files-modal-mask" onClick={handleDenyAi}>
          <div className="files-modal" onClick={e => e.stopPropagation()}>
            <h3>「{work}」想使用 AI</h3>
            <p className="files-empty-hint">
              每天最多 {aiGrant.dailyLimit} 次，相同问题 5 分钟内复用结果。
              请求内容会发送给你在设置里配置的模型服务商。
            </p>
            <div className="files-modal-actions">
              <button type="button" className="files-create-btn ghost" onClick={handleDenyAi}>先不用</button>
              <button type="button" className="files-create-btn" onClick={() => void handleAllowAi()}>允许</button>
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

      {loaded && !missing && !editing && canPreview && mode === 'preview' && previewReady && (
        <iframe
          key={`${currentPath}-${previewToken}`}
          ref={iframeRef}
          className="file-view-frame"
          title={work}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          srcDoc={previewDoc?.html ?? ''}
        />
      )}
    </div>
  );
}
