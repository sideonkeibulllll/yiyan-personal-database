/**
 * 设置页面
 * 左侧栏 + 右侧配置项 + 底部保存按钮 布局
 * 各面板内容已拆分为 panels/ 下的子组件，本文件负责状态、业务逻辑与布局
 */
import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { incrementalImport } from '@/utils/import';
import { IconSave, IconChevronRight } from '@/components/icons';
import type { ImportResult } from '@/features/datamanager/types';
import {
  createBackup,
  exportToDownload,
  listBackups,
  deleteBackup,
  restoreFromBackup,
  restoreFromZipFile,
  readZipManifest,
  shouldAutoBackup,
} from '@/services/backupService';
import type {
  BackupItem,
  BackupManifest,
  RestoreResult,
} from '@/services/backupTypes';
import {
  getTrustedDevices,
  removeTrustedDevice,
  discoverDevices,
  createDeviceByIp,
  handshakeAndCreateDevice,
  prepareZipForSend,
  sendZipToDevice,
  getLocalIp,
  startLocalServer,
  stopLocalServer,
  setReceiveHandler,
  pullMissingOriginals,
  getMissingOriginals,
} from '@/services/syncService';
import { isElectron } from '@/services/electronAdapter';
import { restoreFromBase64Zip, saveReceivedZip } from '@/services/backupService';
// 云端备份模块改为动态 import（v2.1.2）：
// - 避免进入设置页面就加载 R2Client/cloudBackupService（即使已移除 AWS SDK，仍可减少初始 chunk）
// - 用户点击"加载云端备份模块"按钮后才加载，最大化启动速度
import type {
  CloudBackupResult,
  CloudRestoreResult,
} from '@/services/cloudBackupTypes';

/** 云端备份模块类型（动态 import 后获得） */
type CloudModule = typeof import('@/services/cloudBackupService');
import { isHttpServerSupported } from '@/services/capacitorHttpServer';
import type {
  DiscoveredDevice,
  TrustedDevice,
  TransferProgress,
  SendRequest,
  DeviceHandshake,
} from '@/services/backupTypes';
import { AiPanel } from './panels/AiPanel';
import { TodoPanel } from './panels/TodoPanel';
import { RandomPanel } from './panels/RandomPanel';
import { DataManagerPanel } from './panels/DataManagerPanel';
import { FileManagerPage } from '@/features/files/FileManagerPage';
import { ImportPanel } from './panels/ImportPanel';
import { ExportPanel } from './panels/ExportPanel';
import { BackupPanel } from './panels/BackupPanel';
import { ChatMediaPanel } from './panels/ChatMediaPanel';
import { RestorePanel } from './panels/RestorePanel';
import { CloudPanel } from './panels/CloudPanel';
import { SyncPanel } from './panels/SyncPanel';
import { PromptsPanel } from './panels/PromptsPanel';
import { PromptLibraryPanel } from './panels/PromptLibraryPanel';
import { McpGroupPanel } from './panels/McpGroupPanel';
import { GlmPanel } from './panels/GlmPanel';
import { SearchPanel } from './panels/SearchPanel';
import { NotifyPanel } from './panels/NotifyPanel';
import { WidgetPanel } from './panels/WidgetPanel';
import { WidgetStylePanel } from './panels/WidgetStylePanel';
import './SettingsPage.css';
import './SettingsNavMobile.css';

/** 设置面板类型 */
type SettingsTab =
  | 'ai'
  | 'search'
  | 'todo'
  | 'random'
  | 'notify'
  | 'widget'
  | 'widgetStyle'
  | 'dataManager'
  | 'import'
  | 'export'
  | 'backup'
  | 'chatMedia'
  | 'restore'
  | 'cloud'
  | 'sync'
  | 'prompts'
  | 'promptLib'
  | 'mcpGroups'
  | 'files'
  | 'glm';

/** 导航叶子项 */
interface NavLeaf {
  key: SettingsTab;
  label: string;
  /** 搜索时可命中的别名（如「ai」能搜到 AI 配置） */
  alias?: string;
}

/**
 * 设置导航分组（v3.6.1）
 *
 * 为什么分组：移动端原本是 17 个平级 tab 横向滚动，要滑三屏才到「MCP 分组」，
 * 而且每加一个面板就更长一节。现在移动端是「分组 → 子页 → 面板」三级，
 * 首页固定 4 行；桌面端仍是左侧栏（只是条目从 17 减到 14）。
 */
interface NavGroup {
  key: string;
  label: string;
  desc: string;
  items: NavLeaf[];
  /** 只有一个面板的分组：点分组直接进面板，不再多一层子页（v3.6.9） */
  directTo?: SettingsTab;
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'ai',
    label: 'AI 与提示词',
    desc: '模型配置 · 联网搜索 · 提示词 · MCP',
    items: [
      { key: 'ai', label: 'AI 配置', alias: 'api key model 模型' },
      { key: 'glm', label: 'GLM 配置', alias: '免费 智谱' },
      { key: 'search', label: '联网搜索', alias: '搜索引擎 秘塔 metaso deepseek 联网' },
      { key: 'prompts', label: '功能提示词', alias: '标签建议 连线建议 上下文' },
      { key: 'promptLib', label: '提示词库', alias: '常用 模板 教学' },
      { key: 'mcpGroups', label: 'MCP 分组', alias: '工具 分组' },
    ],
  },
  {
    key: 'data',
    label: '数据与备份',
    desc: '数据管理 · 备份恢复 · 设备互通',
    items: [
      { key: 'dataManager', label: '数据管理', alias: '标签 组' },
      { key: 'backup', label: '本地备份', alias: 'zip 导出' },
      { key: 'chatMedia', label: '聊天图片', alias: '缓存图片 相册 导出 文件管理器' },
      { key: 'cloud', label: '云端备份', alias: 'r2 d1 中转站' },
      { key: 'sync', label: '设备互通', alias: '局域网 互传' },
    ],
  },
  {
    key: 'filesGroup',
    label: '文件与作品',
    desc: 'HTML 作品池 · 全屏预览 · 重命名与复制',
    directTo: 'files',
    items: [
      { key: 'files', label: '文件与作品', alias: 'html 作品 文件 预览 重命名' },
    ],
  },
  {
    key: 'daily',
    label: '日常与通知',
    desc: '待办 · 随机浏览 · 记忆来信',
    items: [
      { key: 'todo', label: '待办配置', alias: '模板 自动' },
      { key: 'random', label: '随机浏览', alias: '权重 卡片' },
      { key: 'notify', label: '记忆来信', alias: '提醒 推送' },
    ],
  },
  {
    key: 'desktop',
    label: '桌面组件',
    desc: '橱窗筛选与外观',
    items: [
      { key: 'widget', label: '桌面橱窗', alias: '小组件 候选' },
      { key: 'widgetStyle', label: '桌面组件样式', alias: '外观 配色' },
    ],
  },
];

/** 桌面端左侧栏与搜索用的扁平列表（按分组顺序展开） */
const NAV_LEAVES: NavLeaf[] = NAV_GROUPS.flatMap(g => g.items);

/**
 * 降级为子入口的面板：不再出现在导航里，统一从「数据管理」进。
 * key 保留 —— 旧的 `#/settings?tab=import` 深链照样能用。
 */
const SUB_ENTRY_TABS: NavLeaf[] = [
  { key: 'import', label: '导入数据', alias: '合并 增量' },
  { key: 'export', label: '导出数据', alias: 'json 备份' },
  { key: 'restore', label: '恢复数据', alias: 'zip 还原' },
];

/** 搜索范围：导航项 + 子入口 */
const SEARCHABLE: NavLeaf[] = [...NAV_LEAVES, ...SUB_ENTRY_TABS];

/** 任意 tab（含子入口）→ 所属分组 key */
const TAB_GROUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const g of NAV_GROUPS) for (const it of g.items) map[it.key] = g.key;
  for (const s of SUB_ENTRY_TABS) map[s.key] = 'data';
  return map;
})();

/** tab → 导航高亮项（子入口高亮它的父项「数据管理」） */
const TAB_HIGHLIGHT: Record<string, SettingsTab> = (() => {
  const map: Record<string, SettingsTab> = {};
  for (const it of NAV_LEAVES) map[it.key] = it.key;
  for (const s of SUB_ENTRY_TABS) map[s.key] = 'dataManager';
  return map;
})();

/** 合法的 tab 值集合（供 ?tab= 深链校验，防止脏参数把面板渲染成空白） */
const TAB_KEYS = new Set<string>(SEARCHABLE.map(i => i.key));

/** 移动端设置断点（与 SettingsPage.css 的 @media (max-width: 768px) 对齐） */
const MOBILE_QUERY = '(max-width: 768px)';

export function SettingsPage() {
  // 当前选中的面板（支持 /settings?tab=promptLib 这类深链，供 Chat 里的「管理」直达）
  const [searchParams] = useSearchParams();
  /** 深链带了合法 tab → 移动端直接落到详情页，而不是先看分组列表 */
  const deepLinkTab = (() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && TAB_KEYS.has(fromUrl) ? (fromUrl as SettingsTab) : null;
  })();
  const [activeTab, setActiveTab] = useState<SettingsTab>(deepLinkTab ?? 'ai');

  /* === 移动端三级导航（v3.6.1）：分组列表 → 组内子页 → 面板 === */
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [mobileView, setMobileView] = useState<'index' | 'group' | 'detail'>(deepLinkTab ? 'detail' : 'index');
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(deepLinkTab ? (TAB_GROUP[deepLinkTab] ?? null) : null);
  const [navKeyword, setNavKeyword] = useState('');

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobileLayout(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /**
   * URL 里的 ?tab= 变化时跟随（v3.6.1）。
   * 场景：已经在设置页，又被深链指到另一个面板 —— 同一路由不会重挂组件，
   * 光靠 useState 初始化器是不够的，会「点了没反应」。
   */
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (!fromUrl || !TAB_KEYS.has(fromUrl)) return;
    const tab = fromUrl as SettingsTab;
    if (tab === activeTab) return;
    setActiveTab(tab);
    setOpenGroupKey(TAB_GROUP[tab] ?? null);
    if (window.matchMedia(MOBILE_QUERY).matches) setMobileView('detail');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** 当前 tab 在导航里应该高亮哪一项（子入口高亮「数据管理」） */
  const highlightTab = TAB_HIGHLIGHT[activeTab] ?? activeTab;
  const currentGroup = NAV_GROUPS.find(g => g.key === (openGroupKey ?? TAB_GROUP[activeTab]));

  /** 移动端：进面板 */
  const openPanel = (key: SettingsTab) => {
    setActiveTab(key);
    setOpenGroupKey(TAB_GROUP[key] ?? null);
    setMobileView('detail');
  };

  /** 移动端：从面板退回（有分组就回组内页，否则回首页） */
  const closePanel = () => {
    const g = TAB_GROUP[activeTab];
    const group = NAV_GROUPS.find(item => item.key === g);
    // 单面板分组没有子页可回，直接回分组首页
    if (group?.directTo) {
      setOpenGroupKey(null);
      setMobileView('index');
      return;
    }
    setOpenGroupKey(g ?? null);
    setMobileView(g ? 'group' : 'index');
  };

  const navMatches = (() => {
    const kw = navKeyword.trim().toLowerCase();
    if (!kw) return null;
    return SEARCHABLE.filter(i => i.label.toLowerCase().includes(kw) || (i.alias ?? '').toLowerCase().includes(kw));
  })();

  // 保存状态
  const [saveMessage, setSaveMessage] = useState('');
  const [showSaveToast, setShowSaveToast] = useState(false);

  // 脏数据追踪：记录用户修改但尚未保存的字段
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const markDirty = (field: string) => {
    setDirtyFields(prev => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };

  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipFileInputRef = useRef<HTMLInputElement>(null);

  // 备份状态
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');

  // 恢复状态
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [pendingZipFile, setPendingZipFile] = useState<{ file: File; manifest: BackupManifest | null } | null>(null);

  // 云端备份状态
  // cloudConfig 已移除（硬编码配置不需要 state）
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudBackupResult, setCloudBackupResult] = useState<CloudBackupResult | null>(null);
  const [cloudRestoreResult, setCloudRestoreResult] = useState<CloudRestoreResult | null>(null);
  const [lastCloudBackupTs, setLastCloudBackupTs] = useState<number | null>(null);
  const [cloudBackupHistory, setCloudBackupHistory] = useState<any[]>([]);
  // v2.1.2: 云端备份模块懒加载（点击按钮后才 dynamic import）
  const [cloudModule, setCloudModule] = useState<CloudModule | null>(null);
  const [cloudModuleLoading, setCloudModuleLoading] = useState(false);

  // 云端配置编辑表单
  // editConfig 已移除（硬编码配置不需要表单）

  // 同步状态
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('8443');
  const [manualAdding, setManualAdding] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [localIp, setLocalIp] = useState('');
  const [localIpLoading, setLocalIpLoading] = useState(false);
  const [localIpCopied, setLocalIpCopied] = useState(false);

  // 接收服务状态（Electron 或 Android 原生可用）
  const [serverRunning, setServerRunning] = useState(false);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [nativeServerSupported, setNativeServerSupported] = useState(false);

  // 检测原生平台是否支持本地服务器
  useEffect(() => {
    if (!isElectron()) {
      isHttpServerSupported().then(setNativeServerSupported);
    }
  }, []);

  // 接收到数据时的弹窗
  const [receiveDialog, setReceiveDialog] = useState<{
    request: SendRequest;
    fromName: string;
    filename: string;
    dataSize: number;
  } | null>(null);

  // ====== 保存处理 ======
  const handleSave = () => {
    // settings store 是响应式的，所有修改已经实时写入 store
    // 这里只需要做持久化确认
    // store 内部的 persist 中间件会自动保存到 localStorage
    // 所以这里主要是给用户一个保存成功的反馈
    setSaveMessage(`已保存 ${dirtyFields.size} 项更改`);
    setShowSaveToast(true);
    setDirtyFields(new Set());
    setTimeout(() => {
      setShowSaveToast(false);
      setSaveMessage('');
    }, 2000);
  };

  // 处理文件选择 - 增量导入
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const result = await incrementalImport(text);
      setImportResult(result);
      // 刷新条目列表
      window.location.reload();
    } catch (err) {
      setImportResult({
        total: 0,
        imported: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : '导入失败'],
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ====== 备份处理 ======

  const refreshBackups = async () => {
    try {
      const list = await listBackups();
      setBackups(list);
    } catch (err) {
      setBackupMessage(`加载备份列表失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const handleCreateBackup = async () => {
    setBackupBusy(true);
    setBackupMessage('正在创建备份...');
    try {
      const manifest = await createBackup('manual');
      setBackupMessage(`备份成功: ${manifest.entryCount} 条记录, ${manifest.todoCount} 条待办`);
      await refreshBackups();
    } catch (err) {
      setBackupMessage(`备份失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleExportToDownload = async () => {
    setBackupBusy(true);
    setBackupMessage('正在导出到 Download 目录...');
    try {
      const manifest = await exportToDownload('manual');
      setBackupMessage(`导出成功: 已保存到 Download/yiyan-backup/ (${manifest.entryCount} 条记录)`);
    } catch (err) {
      setBackupMessage(`导出失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!confirm(`确定删除备份 ${filename}?`)) return;
    try {
      await deleteBackup(filename);
      await refreshBackups();
    } catch (err) {
      setBackupMessage(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  // ====== 恢复处理 ======

  const handleRestoreFromBackup = async (filename: string) => {
    if (!confirm(`确定从 ${filename} 恢复?\n当前数据将被覆盖（恢复前会自动备份）`)) return;
    setRestoreBusy(true);
    setRestoreResult(null);
    try {
      const result = await restoreFromBackup(filename);
      setRestoreResult(result);
      setBackupMessage('恢复完成');
    } catch (err) {
      setRestoreResult({
        entriesImported: 0, entriesSkipped: 0,
        todosImported: 0, todosSkipped: 0,
        tagsImported: 0, tagsSkipped: 0,
        groupsImported: 0, groupsSkipped: 0,
        errors: [err instanceof Error ? err.message : '恢复失败'],
      });
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleZipFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const manifest = await readZipManifest(file);
    setPendingZipFile({ file, manifest });
    if (zipFileInputRef.current) zipFileInputRef.current.value = '';
  };

  const handleRestoreFromZip = async () => {
    if (!pendingZipFile) return;
    setRestoreBusy(true);
    setRestoreResult(null);
    try {
      const result = await restoreFromZipFile(pendingZipFile.file);
      setRestoreResult(result);
      setPendingZipFile(null);
    } catch (err) {
      setRestoreResult({
        entriesImported: 0, entriesSkipped: 0,
        todosImported: 0, todosSkipped: 0,
        tagsImported: 0, tagsSkipped: 0,
        groupsImported: 0, groupsSkipped: 0,
        errors: [err instanceof Error ? err.message : '恢复失败'],
      });
    } finally {
      setRestoreBusy(false);
    }
  };

  // ===== 同步处理 =====

  const refreshTrustedDevices = () => {
    setTrustedDevices(getTrustedDevices());
  };

  const refreshLocalIp = async () => {
    setLocalIpLoading(true);
    try {
      const ip = await getLocalIp();
      setLocalIp(ip);
    } catch {
      setLocalIp('');
    } finally {
      setLocalIpLoading(false);
    }
  };

  const handleCopyLocalIp = async () => {
    if (!localIp) return;
    try {
      await navigator.clipboard.writeText(localIp);
      setLocalIpCopied(true);
      setTimeout(() => setLocalIpCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setSyncMessage('正在搜索附近设备...');
    try {
      const devices = await discoverDevices(5000);
      setDiscoveredDevices(devices);
      if (devices.length === 0) {
        setSyncMessage('未发现设备，可手动输入 IP 连接');
      } else {
        setSyncMessage(`发现 ${devices.length} 个设备`);
      }
    } catch (err) {
      setSyncMessage(`搜索失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setDiscovering(false);
    }
  };

  const handleManualAdd = async () => {
    if (!manualIp) return;
    const port = parseInt(manualPort) || 8443;
    setManualAdding(true);
    setSyncMessage(`正在握手 ${manualIp}:${port}...`);
    try {
      const result = await handshakeAndCreateDevice(manualIp, port);
      if (!result) {
        setSyncMessage(
          `❌ 无法连接到 ${manualIp}:${port}\n` +
          `请确认：\n` +
          `1. 对方已开启"接收服务"\n` +
          `2. 双方在同一局域网\n` +
          `3. IP 和端口正确\n` +
          `4. 防火墙未拦截 ${port} 端口`
        );
        return;
      }
      const { device, handshake } = result;
      setDiscoveredDevices(prev => {
        if (prev.find(d => d.id === device.id)) return prev;
        return [...prev, device];
      });
      setSyncMessage(
        `✅ 已连接: ${handshake.name} ` +
        `(${handshake.type === 'phone' ? '手机' : '电脑'}) ` +
        `· v${handshake.appVersion}`
      );
    } catch (err) {
      setSyncMessage(`握手失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setManualAdding(false);
    }
  };

  const handleSendToDevice = async (device: DiscoveredDevice, requestImport: boolean) => {
    setSyncBusy(true);
    setTransferProgress(null);
    setSyncMessage(`正在准备数据发送到 ${device.name}（含增量原图）...`);
    try {
      const { base64, filename, size } = await prepareZipForSend(device);
      setSyncMessage(`正在发送 ${filename} 到 ${device.name}...`);
      const resp = await sendZipToDevice(
        device, base64, filename, requestImport,
        (p) => setTransferProgress(p),
      );
      if (resp.action === 'import') {
        setSyncMessage(`${device.name} 已导入数据`);
      } else if (resp.action === 'save_only') {
        setSyncMessage(`${device.name} 已保存到副本目录`);
      } else {
        setSyncMessage(`${device.name} 拒绝了接收`);
      }

      if (resp.action !== 'reject') {
        const pending = getMissingOriginals();
        if (pending.length > 0) {
          setSyncMessage(prev => `${prev}\n正在从 ${device.name} 拉取 ${pending.length} 张缺失原图...`);
          try {
            const { pulled, remaining } = await pullMissingOriginals(device);
            setSyncMessage(prev =>
              `${prev}\n原图拉取完成：成功 ${pulled} 张` +
              (remaining > 0 ? `，队列剩余 ${remaining} 张（等下次连接其他设备）` : '，队列已清空')
            );
          } catch (err) {
            setSyncMessage(prev => `${prev}\n原图拉取失败: ${err instanceof Error ? err.message : '未知错误'}`);
          }
        }
      }
    } catch (err) {
      setSyncMessage(`发送失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleRemoveTrusted = (deviceId: string) => {
    if (!confirm('确定移除该信任设备?')) return;
    removeTrustedDevice(deviceId);
    refreshTrustedDevices();
  };

  // ===== 云端备份 =====

  // v2.2.0: 加载云端备份模块（动态 import）
  const handleLoadCloudModule = async () => {
    if (cloudModule || cloudModuleLoading) return;
    setCloudModuleLoading(true);
    setCloudMessage('正在加载云端备份模块...');
    try {
      const mod = await import('@/services/cloudBackupService');
      setCloudModule(mod);
      setCloudMessage('');
      // 模块加载完成后立即刷新状态
      try {
        const ts = await mod.getLastCloudBackupTime();
        setLastCloudBackupTs(ts);
        const history = await mod.listCloudBackups();
        setCloudBackupHistory(history);
      } catch (err) {
        console.warn('[cloud] refresh state failed:', err);
      }
    } catch (err) {
      setCloudMessage(`加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setCloudModuleLoading(false);
    }
  };

  const refreshCloudState = async () => {
    if (!cloudModule) return;
    try {
      const ts = await cloudModule.getLastCloudBackupTime();
      setLastCloudBackupTs(ts);
      const history = await cloudModule.listCloudBackups();
      setCloudBackupHistory(history);
    } catch (err) {
      console.warn('[cloud] refresh state failed:', err);
    }
  };

  const handleTestCloud = async () => {
    if (!cloudModule) return;
    setCloudBusy(true);
    setCloudMessage('正在测试 D1 连接…');
    try {
      /**
       * D1 通常 <1s，R2 探测要 2~4s（它会真的走一趟 Worker → R2 取一个不存在的对象）。
       * 分开 await，让先回来的先显示 —— 之前用 Promise.all 会让人对着「测试中」干等最慢的那个。
       */
      const d1Promise = cloudModule.d1TestConnection();
      const r2Promise = cloudModule.r2TestConnection().catch(err => ({
        ok: false,
        message: err instanceof Error ? err.message : 'R2 探测异常',
      }));

      const d1 = await d1Promise;
      setCloudMessage(`D1: ${d1.message}\nR2: 测试中…（R2 要走一趟中转站 → R2，会慢几秒）`);
      const r2 = await r2Promise;
      setCloudMessage(`D1: ${d1.message}\nR2: ${r2.message}`);
    } catch (err) {
      setCloudMessage(`测试失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudBackup = async () => {
    if (!cloudModule) return;
    setCloudBusy(true);
    setCloudMessage('正在备份到云端...');
    setCloudBackupResult(null);
    try {
      const result = await cloudModule.backupToCloud();
      setCloudBackupResult(result);
      setCloudMessage(
        `✅ 备份完成 (${(result.duration / 1000).toFixed(1)}s)\n` +
        `条目 ${result.entriesSynced} · 待办 ${result.todosSynced} · ` +
        `标签 ${result.tagsSynced} · 附件上传 ${result.attachmentsUploaded} · ` +
        `删除同步 ${result.deletionsSynced}`
      );
      await refreshCloudState();
    } catch (err) {
      setCloudMessage(`备份失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudRestore = async () => {
    if (!cloudModule) return;
    if (!confirm('确定从云端恢复数据？\n（合并模式：跳过已存在的条目）')) return;
    setCloudBusy(true);
    setCloudMessage('正在从云端恢复...');
    setCloudRestoreResult(null);
    try {
      const result = await cloudModule.restoreFromCloud();
      setCloudRestoreResult(result);
      setCloudMessage(
        `✅ 恢复完成 (${(result.duration / 1000).toFixed(1)}s)\n` +
        `条目 +${result.entriesPulled}/${result.entriesSkipped} 跳过 · ` +
        `待办 +${result.todosPulled}/${result.todosSkipped} 跳过 · ` +
        `附件下载 ${result.attachmentsDownloaded}`
      );
    } catch (err) {
      setCloudMessage(`恢复失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setCloudBusy(false);
    }
  };

  // ====== 接收服务 ======

  const handleStartServer = async () => {
    setServerBusy(true);
    setSyncMessage('正在启动接收服务...');
    try {
      const actualPort = await startLocalServer(8443);
      setServerPort(actualPort);
      setServerRunning(true);
      setSyncMessage(`✅ 接收服务已启动 (端口 ${actualPort})\n对方可发送数据到 ${localIp || '本机IP'}:${actualPort}`);
    } catch (err) {
      setSyncMessage(`启动失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setServerBusy(false);
    }
  };

  const handleStopServer = async () => {
    setServerBusy(true);
    setSyncMessage('正在停止接收服务...');
    try {
      await stopLocalServer();
      setServerRunning(false);
      setServerPort(null);
      setSyncMessage('接收服务已停止');
    } catch (err) {
      setSyncMessage(`停止失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setServerBusy(false);
    }
  };

  useEffect(() => {
    setReceiveHandler(async (request: SendRequest, data: string) => {
      const fromName = request.from?.name || '未知设备';
      const fromType = request.from?.type === 'phone' ? '手机' : '电脑';
      const dataSizeKB = Math.round((data.length * 0.75) / 1024);

      return await new Promise<'import' | 'save_only' | 'reject'>((resolve) => {
        setReceiveDialog({
          request,
          fromName: `${fromName} (${fromType})`,
          filename: request.filename,
          dataSize: dataSizeKB,
        });

        (window as any).__pendingReceiveResolve = (action: 'import' | 'save_only' | 'reject') => {
          (window as any).__pendingReceiveResolve = null;
          setReceiveDialog(null);
          resolve(action);
        };
      });
    });

    return () => {
      setReceiveHandler(null);
      if ((window as any).__pendingReceiveResolve) {
        (window as any).__pendingReceiveResolve('reject');
      }
    };
  }, []);

  const handleReceiveAction = async (action: 'import' | 'save_only' | 'reject') => {
    const resolve = (window as any).__pendingReceiveResolve;
    if (!resolve) return;

    if (action === 'reject') {
      resolve('reject');
      return;
    }

    if (receiveDialog?.request) {
      try {
        const path = await saveReceivedZip(
          (receiveDialog.request as any).data,
          receiveDialog.filename,
        );
        setSyncMessage(`已保存到: ${path}`);

        if (action === 'import') {
          setSyncMessage('正在导入数据...');
          const result = await restoreFromBase64Zip(
            (receiveDialog.request as any).data,
          );
          setSyncMessage(
            `✅ 导入完成: 条目 +${result.entriesImported}/${result.entriesSkipped} 跳过, ` +
            `待办 +${result.todosImported}/${result.todosSkipped} 跳过`
          );
        }
      } catch (err) {
        setSyncMessage(`处理失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    }
    resolve(action);
  };

  // ====== 面板初始化副作用 ======
  useEffect(() => {
    if (activeTab === 'backup') refreshBackups();
    // v2.1.2: 云端备份模块需用户点击按钮加载后才刷新
    if (activeTab === 'cloud' && cloudModule) refreshCloudState();
    if (activeTab === 'sync') {
      refreshTrustedDevices();
      refreshLocalIp();
    }
  }, [activeTab, cloudModule]);

  // ====== 渲染右侧面板 ======
  const renderPanel = () => {
    switch (activeTab) {
      case 'ai':
        return <AiPanel markDirty={markDirty} />;

      case 'todo':
        return <TodoPanel markDirty={markDirty} />;

      case 'random':
        return <RandomPanel markDirty={markDirty} />;

      case 'notify':
        return <NotifyPanel markDirty={markDirty} />;

      case 'widget':
        return <WidgetPanel markDirty={markDirty} />;

      case 'widgetStyle':
        return <WidgetStylePanel />;

      case 'dataManager':
        return <DataManagerPanel onOpenTab={openPanel} />;

      case 'files':
        return <FileManagerPage embedded />;

      case 'import':
        return (
          <ImportPanel
            importResult={importResult}
            importing={importing}
            fileInputRef={fileInputRef}
            onFileSelect={handleFileSelect}
            onCloseResult={() => setImportResult(null)}
          />
        );

      case 'export':
        return <ExportPanel />;

      case 'chatMedia':
        return <ChatMediaPanel />;

      case 'backup':
        return (
          <BackupPanel
            backups={backups}
            backupBusy={backupBusy}
            backupMessage={backupMessage}
            restoreBusy={restoreBusy}
            onCreateBackup={handleCreateBackup}
            onExportToDownload={handleExportToDownload}
            onRestoreFromBackup={handleRestoreFromBackup}
            onDeleteBackup={handleDeleteBackup}
          />
        );

      case 'restore':
        return (
          <RestorePanel
            restoreBusy={restoreBusy}
            restoreResult={restoreResult}
            pendingZipFile={pendingZipFile}
            zipFileInputRef={zipFileInputRef}
            onZipFileSelect={handleZipFileSelect}
            onRestoreFromZip={handleRestoreFromZip}
            onCancelPending={() => setPendingZipFile(null)}
            onCloseResult={() => setRestoreResult(null)}
          />
        );

      case 'cloud':
        return (
          <CloudPanel
            moduleLoaded={!!cloudModule}
            moduleLoading={cloudModuleLoading}
            message={cloudMessage}
            busy={cloudBusy}
            lastBackupTs={lastCloudBackupTs}
            backupHistory={cloudBackupHistory}
            onLoadModule={handleLoadCloudModule}
            onTestCloud={handleTestCloud}
            onCloudBackup={handleCloudBackup}
            onCloudRestore={handleCloudRestore}
          />
        );

      case 'sync':
        return (
          <SyncPanel
            nativeServerSupported={nativeServerSupported}
            serverRunning={serverRunning}
            serverPort={serverPort}
            serverBusy={serverBusy}
            localIp={localIp}
            localIpLoading={localIpLoading}
            localIpCopied={localIpCopied}
            manualIp={manualIp}
            manualPort={manualPort}
            manualAdding={manualAdding}
            discovering={discovering}
            syncBusy={syncBusy}
            discoveredDevices={discoveredDevices}
            trustedDevices={trustedDevices}
            transferProgress={transferProgress}
            syncMessage={syncMessage}
            receiveDialog={receiveDialog}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onDiscover={handleDiscover}
            onCopyLocalIp={handleCopyLocalIp}
            onRefreshLocalIp={refreshLocalIp}
            onManualIpChange={setManualIp}
            onManualPortChange={setManualPort}
            onManualAdd={handleManualAdd}
            onSendToDevice={handleSendToDevice}
            onRemoveTrusted={handleRemoveTrusted}
            onReceiveAction={handleReceiveAction}
          />
        );

      case 'prompts':
        return <PromptsPanel markDirty={markDirty} />;

      case 'promptLib':
        return <PromptLibraryPanel />;

      case 'mcpGroups':
        return <McpGroupPanel />;

      case 'glm':
        return <GlmPanel markDirty={markDirty} />;

      case 'search':
        return <SearchPanel markDirty={markDirty} />;

      default:
        return null;
    }
  };

  return (
    <div className="settings-page">
      {/* 顶部标题栏 */}
      <header className="settings-header">
        <h1 className="settings-title">设置</h1>
      </header>

      {/* 主体布局：桌面端左栏 + 右面板；移动端「分组 → 子页 → 面板」三级导航 */}
      <div className={`settings-layout ${isMobileLayout ? 'settings-layout-mobile' : ''}`}>
        {/* 桌面端：左侧栏 */}
        {!isMobileLayout && (
          <nav className="settings-sidebar">
            {NAV_LEAVES.map(tab => (
              <button
                key={tab.key}
                className={`settings-nav-item ${highlightTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        {/* 移动端：分组首页 / 组内子页 */}
        {isMobileLayout && mobileView !== 'detail' && (
          <div className="settings-mobile-nav">
            {mobileView === 'index' ? (
              <>
                <input
                  className="settings-nav-search"
                  type="text"
                  placeholder="搜索设置项…（提示词 / 备份 / 模型）"
                  value={navKeyword}
                  onChange={e => setNavKeyword(e.target.value)}
                />
                {navMatches ? (
                  navMatches.length === 0 ? (
                    <div className="settings-nav-empty">没有匹配的设置项</div>
                  ) : (
                    <div className="settings-nav-list">
                      {navMatches.map(item => (
                        <button key={item.key} className="settings-nav-row" onClick={() => openPanel(item.key)}>
                          <span className="settings-nav-row-label">{item.label}</span>
                          <span className="settings-nav-row-hint">
                            {NAV_GROUPS.find(g => g.key === TAB_GROUP[item.key])?.label}
                          </span>
                          <IconChevronRight />
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="settings-nav-list is-tiles">
                    {NAV_GROUPS.map(g => (
                      <button
                        key={g.key}
                        className="settings-nav-group"
                        onClick={() => {
                          // 单面板分组（文件与作品）：一步直达，不再多点一次
                          if (g.directTo) { openPanel(g.directTo); return; }
                          setOpenGroupKey(g.key);
                          setMobileView('group');
                        }}
                      >
                        <span className="settings-nav-group-main">
                          <span className="settings-nav-group-label">{g.label}</span>
                          <span className="settings-nav-group-desc">{g.desc}</span>
                        </span>
                        <span className="settings-nav-group-count">{g.items.length}</span>
                        <IconChevronRight />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <button className="settings-nav-back" onClick={() => { setMobileView('index'); setNavKeyword(''); }}>
                  ← 设置
                </button>
                <h2 className="settings-nav-group-title">{currentGroup?.label}</h2>
                <div className="settings-nav-list">
                  {currentGroup?.items.map(item => (
                    <button
                      key={item.key}
                      className={`settings-nav-row ${activeTab === item.key ? 'active' : ''}`}
                      onClick={() => openPanel(item.key)}
                    >
                      <span className="settings-nav-row-label">{item.label}</span>
                      <IconChevronRight />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 配置面板（移动端只在详情页显示） */}
        {(!isMobileLayout || mobileView === 'detail') && (
          <main className={`settings-content ${isMobileLayout ? 'settings-content-mobile' : ''}`}>
            {isMobileLayout && (
              <button className="settings-nav-back settings-detail-back" onClick={closePanel}>
                ← {currentGroup ? currentGroup.label : '设置'}
              </button>
            )}
            {renderPanel()}
          </main>
        )}
      </div>

      {/* 底部保存按钮（移动端导航页没有可保存的东西，不显示） */}
      {(!isMobileLayout || mobileView === 'detail') && (
        <footer className="settings-footer">
          <button
            className={`settings-save-btn ${dirtyFields.size > 0 ? 'has-changes' : ''}`}
            onClick={handleSave}
          >
            <IconSave />
            <span>{dirtyFields.size > 0 ? `保存更改 (${dirtyFields.size})` : '保存'}</span>
          </button>
          {showSaveToast && (
            <div className="settings-save-toast">
              ✅ {saveMessage}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
