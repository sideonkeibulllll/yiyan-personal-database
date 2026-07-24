/**
 * 设置页面
 * 左侧栏 + 右侧配置项 + 底部保存按钮 布局
 * AI 配置 + 数据管理器 + 数据导入 + 随机浏览配置 + GLM 配置 + 提示词
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEntryStore } from '@/stores/entryStore';
import { BottomNav } from '@/components/BottomNav';
import { incrementalImport } from '@/utils/import';
import { DEFAULT_PROMPTS } from '@/types';
import type { PromptConfig, GLMConfig } from '@/types';
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
import {
  getCloudBackupConfig,
  saveCloudBackupConfig,
  clearCloudBackupConfig,
  testCloudConnection,
  backupToCloud,
  restoreFromCloud,
  listCloudBackups,
  getLastCloudBackupTime,
} from '@/services/cloudBackupService';
import type {
  CloudBackupConfig,
  CloudBackupResult,
  CloudRestoreResult,
} from '@/services/cloudBackupTypes';
import { isHttpServerSupported } from '@/services/capacitorHttpServer';
import type {
  DiscoveredDevice,
  TrustedDevice,
  TransferProgress,
  SendRequest,
  DeviceHandshake,
} from '@/services/backupTypes';
import './SettingsPage.css';

/** 提示词标签 */
const PROMPT_LABELS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '标签建议提示词',
  relationSuggestion: '关联建议提示词',
  dialogueContext: '对话上下文提示词',
  autoLink: '自动连线提示词',
  groupSuggestion: '组建议提示词',
  connectionSuggestion: '连线建议提示词',
};

/** 提示词提示 */
const PROMPT_HINTS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '可用变量: {content} {context}',
  relationSuggestion: '可用变量: {contentA} {contentB}',
  dialogueContext: '可用变量: {currentEntry} {recentEntries}',
  autoLink: '可用变量: {newEntry} {candidates}',
  groupSuggestion: '可用变量: {existingGroups} {recentEntries}',
  connectionSuggestion: '可用变量: {entries}',
};

/** 设置面板类型 */
type SettingsTab =
  | 'ai'
  | 'todo'
  | 'random'
  | 'dataManager'
  | 'import'
  | 'export'
  | 'backup'
  | 'restore'
  | 'cloud'
  | 'sync'
  | 'prompts'
  | 'glm';

/** 左侧栏配置项 */
const TAB_LIST: { key: SettingsTab; label: string }[] = [
  { key: 'ai', label: 'AI 配置' },
  { key: 'todo', label: '待办配置' },
  { key: 'random', label: '随机浏览' },
  { key: 'dataManager', label: '数据管理' },
  { key: 'import', label: '导入' },
  { key: 'export', label: '导出' },
  { key: 'backup', label: '本地备份' },
  { key: 'restore', label: '数据恢复' },
  { key: 'cloud', label: '云端备份' },
  { key: 'sync', label: '设备互通' },
  { key: 'prompts', label: '提示词' },
  { key: 'glm', label: 'GLM 配置' },
];

/* SVG Icon Components */
const IconBot = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
  </svg>
);

const IconDatabase = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
  </svg>
);

const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const IconShuffle = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c1.3 0 2.6-.7 3.3-1.8l.5-.8" /><path d="m18 14 4 4-4 4" />
  </svg>
);

const IconClipboard = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 14l2 2 4-4" />
  </svg>
);

const IconChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const IconBackup = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
  </svg>
);

const IconRestore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9c-2.52 0-4.93 1-6.74 2.74L3 8" /><path d="M3 3v5h5" />
  </svg>
);

const IconSync = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconDownload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconCloud = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);

const IconWifi = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13a10 10 0 0 1 14 0" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 20 0" /><line x1="12" y1="20" x2="12" y2="20" />
  </svg>
);

const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
  </svg>
);

const IconSave = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" />
  </svg>
);

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateRandomConfig = useSettingsStore(state => state.updateRandomConfig);
  const updateTodoConfig = useSettingsStore(state => state.updateTodoConfig);
  const updateContextConfig = useSettingsStore(state => state.updateContextConfig);
  const updatePushConfig = useSettingsStore(state => state.updatePushConfig);
  const entries = useEntryStore(state => state.entries);

  // 当前选中的面板
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

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
  const [cloudConfig, setCloudConfig] = useState<CloudBackupConfig | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState('');
  const [cloudBackupResult, setCloudBackupResult] = useState<CloudBackupResult | null>(null);
  const [cloudRestoreResult, setCloudRestoreResult] = useState<CloudRestoreResult | null>(null);
  const [lastCloudBackupTs, setLastCloudBackupTs] = useState<number | null>(null);
  const [cloudBackupHistory, setCloudBackupHistory] = useState<any[]>([]);

  // 云端配置编辑表单
  const [editConfig, setEditConfig] = useState<CloudBackupConfig | null>(null);

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

  const refreshCloudState = async () => {
    const config = getCloudBackupConfig();
    setCloudConfig(config);
    setEditConfig(config || {
      accountId: '', d1DatabaseId: '', d1ApiToken: '',
      r2BucketName: '', r2AccessKeyId: '', r2SecretAccessKey: '',
      r2CustomDomain: '',
    });
    if (config) {
      try {
        const ts = await getLastCloudBackupTime();
        setLastCloudBackupTs(ts);
        const history = await listCloudBackups();
        setCloudBackupHistory(history);
      } catch (err) {
        console.warn('[cloud] refresh state failed:', err);
      }
    }
  };

  const handleSaveCloudConfig = () => {
    if (!editConfig) return;
    if (!editConfig.accountId || !editConfig.d1DatabaseId || !editConfig.d1ApiToken
        || !editConfig.r2BucketName || !editConfig.r2AccessKeyId || !editConfig.r2SecretAccessKey) {
      setCloudMessage('请填写所有必填字段');
      return;
    }
    saveCloudBackupConfig(editConfig);
    setCloudConfig(editConfig);
    setCloudMessage('配置已保存');
  };

  const handleClearCloudConfig = () => {
    if (!confirm('确定清除云端备份配置？\n（不会影响已备份的数据）')) return;
    clearCloudBackupConfig();
    setCloudConfig(null);
    setEditConfig({
      accountId: '', d1DatabaseId: '', d1ApiToken: '',
      r2BucketName: '', r2AccessKeyId: '', r2SecretAccessKey: '',
      r2CustomDomain: '',
    });
    setLastCloudBackupTs(null);
    setCloudBackupHistory([]);
    setCloudMessage('配置已清除');
  };

  const handleTestCloud = async () => {
    if (!cloudConfig) return;
    setCloudBusy(true);
    setCloudMessage('正在测试连接...');
    try {
      const result = await testCloudConnection();
      setCloudMessage(`D1: ${result.d1}\nR2: ${result.r2}`);
    } catch (err) {
      setCloudMessage(`测试失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudBackup = async () => {
    setCloudBusy(true);
    setCloudMessage('正在备份到云端...');
    setCloudBackupResult(null);
    try {
      const result = await backupToCloud();
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
    if (!confirm('确定从云端恢复数据？\n（合并模式：跳过已存在的条目）')) return;
    setCloudBusy(true);
    setCloudMessage('正在从云端恢复...');
    setCloudRestoreResult(null);
    try {
      const result = await restoreFromCloud();
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
    if (activeTab === 'cloud') refreshCloudState();
    if (activeTab === 'sync') {
      refreshTrustedDevices();
      refreshLocalIp();
    }
  }, [activeTab]);

  // ====== 渲染右侧面板 ======
  const renderPanel = () => {
    switch (activeTab) {
      case 'ai':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">AI 配置</h2>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                type="password"
                className="form-input glass"
                value={settings.ai.apiKey}
                onChange={e => { updateAIConfig({ apiKey: e.target.value }); markDirty('ai.apiKey'); }}
                placeholder="sk-..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">API 地址</label>
              <input
                type="text"
                className="form-input glass"
                value={settings.ai.baseURL}
                onChange={e => { updateAIConfig({ baseURL: e.target.value }); markDirty('ai.baseURL'); }}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className="form-group">
              <label className="form-label">模型</label>
              {settings.ai.isDeepSeek ? (
                <select
                  className="form-input glass"
                  value={settings.ai.model}
                  onChange={e => { updateAIConfig({ model: e.target.value }); markDirty('ai.model'); }}
                >
                  <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                  <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                </select>
              ) : (
                <input
                  type="text"
                  className="form-input glass"
                  value={settings.ai.model}
                  onChange={e => { updateAIConfig({ model: e.target.value }); markDirty('ai.model'); }}
                  placeholder="gpt-4o-mini"
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.ai.isDeepSeek}
                  onChange={e => {
                    if (e.target.checked) {
                      updateAIConfig({
                        isDeepSeek: true,
                        baseURL: 'https://api.deepseek.com',
                        model: 'deepseek-v4-flash',
                      });
                    } else {
                      updateAIConfig({
                        isDeepSeek: false,
                        baseURL: 'https://api.openai.com/v1',
                        model: 'gpt-4o-mini',
                      });
                    }
                    markDirty('ai.isDeepSeek');
                  }}
                />
                <span>使用 DeepSeek 模型</span>
              </label>
            </div>

            {settings.ai.isDeepSeek && (
              <>
                <div className="form-group">
                  <label className="form-label">Temperature</label>
                  <input
                    type="number"
                    className="form-input glass"
                    value={settings.ai.deepSeekOptions.temperature}
                    onChange={e => { updateAIConfig({
                      deepSeekOptions: {
                        ...settings.ai.deepSeekOptions,
                        temperature: parseFloat(e.target.value) || 0.7,
                      },
                    }); markDirty('ai.deepSeekOptions.temperature'); }}
                    min="0" max="2" step="0.1"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Tokens</label>
                  <input
                    type="number"
                    className="form-input glass"
                    value={settings.ai.deepSeekOptions.maxTokens}
                    onChange={e => { updateAIConfig({
                      deepSeekOptions: {
                        ...settings.ai.deepSeekOptions,
                        maxTokens: parseInt(e.target.value) || 2000,
                      },
                    }); markDirty('ai.deepSeekOptions.maxTokens'); }}
                    min="100" max="32000" step="100"
                  />
                </div>
              </>
            )}

            {/* 智能标签配置 */}
            <div className="settings-subsection-title">智能标签</div>
            <div className="form-group">
              <label className="form-label">最近使用标签数量</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.smartTag?.recentTagCount ?? 50}
                onChange={e => { updateAIConfig({
                  smartTag: {
                    ...settings.ai.smartTag!,
                    recentTagCount: parseInt(e.target.value) || 50,
                    maxTags: settings.ai.smartTag?.maxTags ?? 6,
                    minTags: settings.ai.smartTag?.minTags ?? 1,
                    tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
                  },
                }); markDirty('ai.smartTag.recentTagCount'); }}
                min="5" max="200" step="5"
              />
              <span className="form-hint">标签建议时发送给 AI 的最近标签数（越多越准，但耗 token）</span>
            </div>
            <div className="form-group">
              <label className="form-label">最大返回标签数</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.smartTag?.maxTags ?? 6}
                onChange={e => { updateAIConfig({
                  smartTag: {
                    ...settings.ai.smartTag!,
                    maxTags: parseInt(e.target.value) || 6,
                    minTags: settings.ai.smartTag?.minTags ?? 1,
                    recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
                    tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
                  },
                }); markDirty('ai.smartTag.maxTags'); }}
                min="1" max="20" step="1"
              />
              <span className="form-hint">AI 返回标签数量上限（默认 6）</span>
            </div>
            <div className="form-group">
              <label className="form-label">最小返回标签数</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.smartTag?.minTags ?? 1}
                onChange={e => { updateAIConfig({
                  smartTag: {
                    ...settings.ai.smartTag!,
                    minTags: parseInt(e.target.value) || 1,
                    maxTags: settings.ai.smartTag?.maxTags ?? 6,
                    recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
                    tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
                  },
                }); markDirty('ai.smartTag.minTags'); }}
                min="0" max="20" step="1"
              />
              <span className="form-hint">AI 返回标签数量下限（默认 1）</span>
            </div>
            <div className="form-group">
              <label className="form-label">标签建议提示词</label>
              <textarea
                className="form-input glass"
                style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                value={settings.ai.smartTag?.tagSuggestPrompt ?? ''}
                onChange={e => { updateAIConfig({
                  smartTag: {
                    ...settings.ai.smartTag!,
                    tagSuggestPrompt: e.target.value,
                  },
                }); markDirty('ai.smartTag.tagSuggestPrompt'); }}
                placeholder="可用变量: {recentTags} {content}"
                rows={6}
              />
              <span className="form-hint">变量: {`{recentTags}`} = 最近标签列表, {`{content}`} = 当前条目内容</span>
            </div>

            {/* e.1: 组建议提示词 */}
            <div className="settings-subsection-title">智能组建议</div>
            <div className="form-group">
              <label className="form-label">最近条目数量</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.smartGroup?.recentEntryCount ?? 50}
                onChange={e => { updateAIConfig({
                  smartGroup: {
                    ...settings.ai.smartGroup!,
                    recentEntryCount: parseInt(e.target.value) || 50,
                    groupSuggestPrompt: settings.ai.smartGroup?.groupSuggestPrompt || '',
                  },
                }); markDirty('ai.smartGroup.recentEntryCount'); }}
                min="5" max="500" step="5"
              />
              <span className="form-hint">用于组建议的最近条目数量（默认 50）</span>
            </div>
            <div className="form-group">
              <label className="form-label">组建议提示词</label>
              <textarea
                className="form-input glass"
                style={{ minHeight: '100px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                value={settings.ai.smartGroup?.groupSuggestPrompt ?? ''}
                onChange={e => { updateAIConfig({
                  smartGroup: {
                    ...settings.ai.smartGroup!,
                    groupSuggestPrompt: e.target.value,
                  },
                }); markDirty('ai.smartGroup.groupSuggestPrompt'); }}
                placeholder="可用变量: {existingGroups} {recentEntries}"
                rows={5}
              />
              <span className="form-hint">变量: {`{existingGroups}`} = 已有分组, {`{recentEntries}`} = 最近条目</span>
            </div>

            {/* 连线建议配置 */}
            <div className="settings-subsection-title">连线建议</div>
            <div className="form-group">
              <label className="form-label">最近条目数量</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.connectionSuggestion?.recentEntryCount ?? 100}
                onChange={e => { updateAIConfig({
                  connectionSuggestion: {
                    ...settings.ai.connectionSuggestion!,
                    recentEntryCount: parseInt(e.target.value) || 100,
                    connectionSuggestPrompt: settings.ai.connectionSuggestion?.connectionSuggestPrompt || '',
                  },
                }); markDirty('ai.connectionSuggestion.recentEntryCount'); }}
                min="10" max="1000" step="10"
              />
              <span className="form-hint">用于连线建议的最近条目数量（默认 100）</span>
            </div>

            {/* e.2: Chat Soul 提示词 */}
            <div className="settings-subsection-title">Chat Soul</div>
            <div className="form-group">
              <label className="form-label">Chat Soul 提示词</label>
              <textarea
                className="form-input glass"
                style={{ minHeight: '100px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                value={settings.ai.chatSoul ?? ''}
                onChange={e => { updateAIConfig({ chatSoul: e.target.value }); markDirty('ai.chatSoul'); }}
                placeholder="对话系统提示词，定义 AI 的角色和风格"
                rows={5}
              />
              <span className="form-hint">用于定制 AI 对话时的角色性格和回复风格</span>
            </div>

            {/* f: 数据选择器配置 */}
            <div className="settings-subsection-title">数据选择器</div>
            <div className="form-group">
              <label className="form-label">「最近」勾选项数量</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.ai.recentPickerCount ?? 30}
                onChange={e => { updateAIConfig({ recentPickerCount: parseInt(e.target.value) || 30 }); markDirty('ai.recentPickerCount'); }}
                min="5" max="200" step="5"
              />
              <span className="form-hint">数据选择器中「最近」区域显示的条目数（默认 30）</span>
            </div>

            {/* 上下文范围配置 */}
            <div className="settings-subsection-title">上下文范围</div>
            <div className="form-group">
              <label className="form-label">近期条目数量</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.context.recentWindow}
                onChange={e => { updateContextConfig({ recentWindow: Math.max(1, Math.min(200, parseInt(e.target.value) || 20)) }); markDirty('context.recentWindow'); }}
                min="1" max="200" step="1"
              />
              <span className="form-hint">AI 对话时参考的最近条目数（越大上下文越丰富，但耗 token）</span>
            </div>
            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.context.enableLongTermMemory ?? false}
                  onChange={e => { updateContextConfig({ enableLongTermMemory: e.target.checked }); markDirty('context.enableLongTermMemory'); }}
                />
                <span>启用长期记忆</span>
              </label>
              <span className="form-hint">启用后 AI 会参考更多历史条目，耗 token 更多</span>
            </div>

            {/* 主动推送配置 */}
            <div className="settings-subsection-title">主动推送</div>
            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.push?.enabled ?? false}
                  onChange={e => { updatePushConfig({ enabled: e.target.checked }); markDirty('push.enabled'); }}
                />
                <span>启用主动推送</span>
              </label>
              <span className="form-hint">录入新条目时，AI 自动推送相关历史条目</span>
            </div>
            <div className="form-group">
              <label className="form-label">相似度阈值</label>
              <input
                type="range"
                className="form-input"
                style={{ padding: 0 }}
                value={settings.push?.similarityThreshold ?? 0.7}
                onChange={e => { updatePushConfig({ similarityThreshold: parseFloat(e.target.value) }); markDirty('push.similarityThreshold'); }}
                min="0.3" max="1" step="0.05"
              />
              <span className="form-hint">值越高要求越严格（当前: {(settings.push?.similarityThreshold ?? 0.7).toFixed(2)}）</span>
            </div>
          </div>
        );

      case 'todo':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">待办配置</h2>

            <div className="settings-subsection-title">倒计时</div>
            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.todo?.showCountdown ?? true}
                  onChange={e => { updateTodoConfig({ showCountdown: e.target.checked }); markDirty('todo.showCountdown'); }}
                />
                <span>显示倒计时条</span>
              </label>
            </div>
            <div className="form-group">
              <label className="form-label">倒计时格式</label>
              <select
                className="form-input glass"
                value={settings.todo?.countdownFormat ?? 'full'}
                onChange={e => { updateTodoConfig({ countdownFormat: e.target.value as 'full' | 'compact' | 'daysOnly' }); markDirty('todo.countdownFormat'); }}
              >
                <option value="full">完整格式 (天时分秒)</option>
                <option value="compact">简洁格式 (天时分)</option>
                <option value="daysOnly">仅天数</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">倒计时位置</label>
              <select
                className="form-input glass"
                value={settings.todo?.countdownPosition ?? 'aboveBottomNav'}
                onChange={e => { updateTodoConfig({ countdownPosition: e.target.value as 'aboveBottomNav' | 'pageTop' | 'floating' }); markDirty('todo.countdownPosition'); }}
              >
                <option value="aboveBottomNav">底栏上方</option>
                <option value="pageTop">页面顶部</option>
                <option value="floating">悬浮窗</option>
              </select>
            </div>

            <div className="settings-subsection-title">其他</div>
            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.todo?.confirmDelete ?? true}
                  onChange={e => { updateTodoConfig({ confirmDelete: e.target.checked }); markDirty('todo.confirmDelete'); }}
                />
                <span>删除前确认</span>
              </label>
            </div>
            <div className="form-group">
              <label className="form-label">回收站保留天数</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.todo?.recycleBinRetentionDays ?? 30}
                onChange={e => { updateTodoConfig({ recycleBinRetentionDays: Math.max(1, parseInt(e.target.value) || 30) }); markDirty('todo.recycleBinRetentionDays'); }}
                min="1" max="365" step="1"
              />
              <span className="form-hint">超过此天数的已删除待办将自动清除</span>
            </div>

            <div className="settings-subsection-title">高级</div>
            <button className="settings-item glass" onClick={() => navigate('/todo/manager')}>
              <div className="item-left">
                <span className="item-title">待办管理器</span>
                <span className="item-desc">时间轴视图 · 批量操作</span>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
            <button className="settings-item glass" onClick={() => navigate('/todo/templates')}>
              <div className="item-left">
                <span className="item-title">模板管理</span>
                <span className="item-desc">创建和应用待办模板</span>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
            <button className="settings-item glass" onClick={() => navigate('/todo/recycle-bin')}>
              <div className="item-left">
                <span className="item-title">回收站</span>
                <span className="item-desc">恢复或彻底删除待办</span>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
          </div>
        );

      case 'random':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">随机浏览</h2>
            <div className="form-group">
              <label className="form-label">每屏随机卡片数</label>
              <input
                type="number"
                className="form-input glass"
                value={settings.random?.cardsPerPage ?? 7}
                onChange={e => { updateRandomConfig({
                  cardsPerPage: Math.max(1, Math.min(50, parseInt(e.target.value) || 7)),
                }); markDirty('random.cardsPerPage'); }}
                min="1" max="50" step="1"
              />
              <span className="form-hint">推荐 5-10 张，根据屏幕大小调整</span>
            </div>
            <div className="form-group">
              <label className="form-label">图片附件展示模式</label>
              <div className="form-radio-group">
                <label className={`form-radio-card ${(settings.random?.attachmentDisplayMode ?? 'inline') === 'inline' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="attachmentDisplayMode"
                    value="inline"
                    checked={(settings.random?.attachmentDisplayMode ?? 'inline') === 'inline'}
                    onChange={() => { updateRandomConfig({ attachmentDisplayMode: 'inline' }); markDirty('random.attachmentDisplayMode'); }}
                  />
                  <span className="form-radio-title">原图直接展示</span>
                  <span className="form-radio-desc">卡片文本下方纵向堆叠图片，点击可全屏放大</span>
                </label>
                <label className={`form-radio-card ${(settings.random?.attachmentDisplayMode ?? 'inline') === 'badge' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="attachmentDisplayMode"
                    value="badge"
                    checked={(settings.random?.attachmentDisplayMode ?? 'inline') === 'badge'}
                    onChange={() => { updateRandomConfig({ attachmentDisplayMode: 'badge' }); markDirty('random.attachmentDisplayMode'); }}
                  />
                  <span className="form-radio-title">仅显示附件标识</span>
                  <span className="form-radio-desc">卡片只显示附件数量徽标，点击弹出画廊查看</span>
                </label>
              </div>
              <span className="form-hint">控制随机卡片中图片附件的展示方式</span>
            </div>
          </div>
        );

      case 'dataManager':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">数据管理</h2>
            <button className="settings-item glass" onClick={() => navigate('/data-manager/tags')}>
              <div className="item-left">
                <span className="item-icon"><IconDatabase /></span>
                <div>
                  <span className="item-title">数据管理器</span>
                  <span className="item-desc">标签 · 组 · 数据存储综合管理</span>
                </div>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
          </div>
        );

      case 'import':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">数据导入</h2>
            <button
              className="settings-item glass"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <div className="item-left">
                <span className="item-icon"><IconUpload /></span>
                <div>
                  <span className="item-title">选择 JSON 文件</span>
                  <span className="item-desc">
                    {importing ? '导入中...' : '增量导入条目数据'}
                  </span>
                </div>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            {importResult && (
              <div className="settings-detail glass">
                <div className="import-result">
                  <p>导入完成</p>
                  <p>新增: {importResult.imported} 条 · 跳过: {importResult.skipped} 条</p>
                  {importResult.errors.length > 0 && (
                    <p className="import-errors">
                      错误: {importResult.errors.join(', ')}
                    </p>
                  )}
                  <button className="import-close-btn" onClick={() => setImportResult(null)}>
                    关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'export':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">数据导出</h2>
            <button className="settings-item glass" onClick={() => navigate('/export')}>
              <div className="item-left">
                <span className="item-icon"><IconDatabase /></span>
                <div>
                  <span className="item-title">导出数据</span>
                  <span className="item-desc">{entries.length} 条记录可导出</span>
                </div>
              </div>
              <span className="item-arrow"><IconChevronRight /></span>
            </button>
          </div>
        );

      case 'backup':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">本地备份</h2>
            <div className="form-group">
              <button
                className="form-reset-btn"
                onClick={handleCreateBackup}
                disabled={backupBusy}
              >
                {backupBusy ? '备份中...' : '创建备份副本'}
              </button>
            </div>
            <div className="form-group">
              <button
                className="form-reset-btn"
                onClick={handleExportToDownload}
                disabled={backupBusy}
              >
                {backupBusy ? '导出中...' : '导出到 Download 目录'}
              </button>
            </div>

            {backupMessage && (
              <div className="form-hint">{backupMessage}</div>
            )}

            <div className="settings-subsection-title">备份历史</div>
            {backups.length === 0 ? (
              <div className="form-hint">暂无备份</div>
            ) : (
              <div className="backup-list">
                {backups.map(item => (
                  <div key={item.filename} className="backup-item">
                    <div className="backup-item-info">
                      <div className="backup-item-name">
                        <span className={`backup-type-badge ${item.manifest.type}`}>
                          {item.manifest.type === 'auto' ? '自动' : '手动'}
                        </span>
                        {new Date(item.manifest.timestamp).toLocaleString('zh-CN')}
                      </div>
                      <div className="backup-item-meta">
                        {item.manifest.entryCount} 条 · {item.manifest.todoCount} 待办 · {(item.size / 1024).toFixed(1)}KB
                      </div>
                    </div>
                    <div className="backup-item-actions">
                      <button
                        className="backup-action-btn restore"
                        onClick={() => handleRestoreFromBackup(item.filename)}
                        disabled={restoreBusy}
                        title="从该备份恢复"
                      >
                        <IconRestore />
                      </button>
                      <button
                        className="backup-action-btn delete"
                        onClick={() => handleDeleteBackup(item.filename)}
                        title="删除"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'restore':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">数据恢复</h2>
            <div className="settings-subsection-title">从 zip 文件增量恢复</div>
            <div className="form-group">
              <button
                className="form-reset-btn"
                onClick={() => zipFileInputRef.current?.click()}
                disabled={restoreBusy}
              >
                {restoreBusy ? '恢复中...' : '选择 zip 文件'}
              </button>
              <input
                ref={zipFileInputRef}
                type="file"
                accept=".zip,application/zip"
                style={{ display: 'none' }}
                onChange={handleZipFileSelect}
              />
            </div>

            {pendingZipFile && (
              <div className="pending-zip-info">
                <div className="form-hint">
                  已选择: {pendingZipFile.file.name}
                </div>
                {pendingZipFile.manifest && (
                  <div className="form-hint">
                    备份信息: {pendingZipFile.manifest.entryCount} 条记录 · {pendingZipFile.manifest.todoCount} 条待办
                    · {new Date(pendingZipFile.manifest.timestamp).toLocaleString('zh-CN')}
                  </div>
                )}
                <div className="form-group">
                  <button
                    className="form-reset-btn"
                    onClick={handleRestoreFromZip}
                    disabled={restoreBusy}
                  >
                    {restoreBusy ? '恢复中...' : '开始增量恢复'}
                  </button>
                  <button
                    className="form-reset-btn cancel"
                    onClick={() => setPendingZipFile(null)}
                    disabled={restoreBusy}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {restoreResult && (
              <div className="restore-result">
                <p>恢复完成</p>
                <p>条目: 新增 {restoreResult.entriesImported} 条 · 跳过 {restoreResult.entriesSkipped} 条</p>
                <p>待办: 新增 {restoreResult.todosImported} 条 · 跳过 {restoreResult.todosSkipped} 条</p>
                <p>标签: 新增 {restoreResult.tagsImported} · 跳过 {restoreResult.tagsSkipped}</p>
                <p>组: 新增 {restoreResult.groupsImported} · 跳过 {restoreResult.groupsSkipped}</p>
                {restoreResult.errors.length > 0 && (
                  <p className="import-errors">错误: {restoreResult.errors.join(', ')}</p>
                )}
                <button className="import-close-btn" onClick={() => setRestoreResult(null)}>关闭</button>
              </div>
            )}

            <div className="form-hint">
              💡 从副本恢复请点击「本地备份」中的对应备份项的恢复按钮
            </div>
          </div>
        );

      case 'cloud':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">云端备份</h2>
            <div className="form-hint" style={{ marginBottom: '12px' }}>
              {cloudConfig
                ? lastCloudBackupTs
                  ? `上次备份: ${new Date(lastCloudBackupTs).toLocaleString('zh-CN')}`
                  : '已配置 · 尚未备份'
                : 'Cloudflare D1 + R2 远程备份'}
            </div>

            <div className="settings-subsection-title">Cloudflare 配置</div>
            {editConfig && (
              <>
                <div className="form-group">
                  <label className="form-label">Account ID</label>
                  <input
                    type="text"
                    className="form-input glass"
                    value={editConfig.accountId}
                    onChange={e => setEditConfig({ ...editConfig, accountId: e.target.value })}
                    placeholder="Cloudflare Account ID"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">D1 Database ID</label>
                  <input
                    type="text"
                    className="form-input glass"
                    value={editConfig.d1DatabaseId}
                    onChange={e => setEditConfig({ ...editConfig, d1DatabaseId: e.target.value })}
                    placeholder="D1 数据库 ID"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">D1 API Token</label>
                  <input
                    type="password"
                    className="form-input glass"
                    value={editConfig.d1ApiToken}
                    onChange={e => setEditConfig({ ...editConfig, d1ApiToken: e.target.value })}
                    placeholder="需 D1 编辑权限"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">R2 Bucket 名称</label>
                  <input
                    type="text"
                    className="form-input glass"
                    value={editConfig.r2BucketName}
                    onChange={e => setEditConfig({ ...editConfig, r2BucketName: e.target.value })}
                    placeholder="如 yiyan-backups"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">R2 Access Key ID</label>
                  <input
                    type="text"
                    className="form-input glass"
                    value={editConfig.r2AccessKeyId}
                    onChange={e => setEditConfig({ ...editConfig, r2AccessKeyId: e.target.value })}
                    placeholder="R2 API Token 中的 Access Key ID"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">R2 Secret Access Key</label>
                  <input
                    type="password"
                    className="form-input glass"
                    value={editConfig.r2SecretAccessKey}
                    onChange={e => setEditConfig({ ...editConfig, r2SecretAccessKey: e.target.value })}
                    placeholder="R2 Secret Access Key"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">R2 自定义域名（可选）</label>
                  <input
                    type="text"
                    className="form-input glass"
                    value={editConfig.r2CustomDomain || ''}
                    onChange={e => setEditConfig({ ...editConfig, r2CustomDomain: e.target.value })}
                    placeholder="如 yiyanr2.8765777.xyz"
                  />
                  <span className="form-hint">配置后访问附件更快</span>
                </div>
                <div className="form-group" style={{ display: 'flex', gap: '8px' }}>
                  <button className="form-reset-btn" onClick={handleSaveCloudConfig}>
                    保存配置
                  </button>
                  {cloudConfig && (
                    <button className="form-reset-btn danger" onClick={handleClearCloudConfig}>
                      清除配置
                    </button>
                  )}
                </div>
                <div className="form-hint" style={{ marginTop: '4px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  ⚠️ Token 明文存储于本地 localStorage，仅适用于个人使用场景
                </div>
              </>
            )}

            {cloudConfig && (
              <>
                <div className="settings-subsection-title" style={{ marginTop: '16px' }}>操作</div>
                <div className="form-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="form-reset-btn"
                    onClick={handleTestCloud}
                    disabled={cloudBusy}
                  >
                    {cloudBusy ? '测试中...' : '测试连接'}
                  </button>
                  <button
                    className="form-reset-btn"
                    onClick={handleCloudBackup}
                    disabled={cloudBusy}
                  >
                    {cloudBusy ? '备份中...' : '增量备份'}
                  </button>
                  <button
                    className="form-reset-btn"
                    onClick={handleCloudRestore}
                    disabled={cloudBusy}
                  >
                    {cloudBusy ? '恢复中...' : '从云端恢复'}
                  </button>
                </div>

                {lastCloudBackupTs && (
                  <div className="form-hint">
                    上次备份: {new Date(lastCloudBackupTs).toLocaleString('zh-CN')}
                  </div>
                )}

                {cloudMessage && (
                  <div className="form-hint" style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>
                    {cloudMessage}
                  </div>
                )}

                {cloudBackupHistory.length > 0 && (
                  <>
                    <div className="settings-subsection-title" style={{ marginTop: '16px' }}>备份历史</div>
                    <div className="backup-list">
                      {cloudBackupHistory.slice(0, 10).map((item: any) => (
                        <div key={item.id} className="backup-item">
                          <div className="backup-item-info">
                            <div className="backup-item-name">
                              {new Date(item.timestamp).toLocaleString('zh-CN')}
                            </div>
                            <div className="backup-item-meta">
                              {item.entry_count} 条 · {item.todo_count} 待办 · v{item.app_version}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );

      case 'sync':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">设备互通</h2>

            {(isElectron() || nativeServerSupported) && (
              <>
                <div className="settings-subsection-title">接收服务</div>
                <div className="form-group">
                  {serverRunning ? (
                    <button
                      className="form-reset-btn danger"
                      onClick={handleStopServer}
                      disabled={serverBusy}
                    >
                      {serverBusy ? '停止中...' : '停止接收服务'}
                    </button>
                  ) : (
                    <button
                      className="form-reset-btn"
                      onClick={handleStartServer}
                      disabled={serverBusy}
                    >
                      {serverBusy ? '启动中...' : '启动接收服务'}
                    </button>
                  )}
                </div>
                {serverRunning && (
                  <div className="form-hint">
                    ✅ 接收服务运行中 · 监听 {localIp || '本机IP'}:{serverPort}
                    <br />
                    请告知发送方此 IP:端口
                  </div>
                )}
                {!serverRunning && (
                  <div className="form-hint">
                    💡 按需开启，其他设备可向你发送数据。不开启时不耗电。
                  </div>
                )}
              </>
            )}

            <div className="settings-subsection-title">发现设备</div>
            <div className="form-group sync-discover-row">
              <button
                className="form-reset-btn"
                onClick={handleDiscover}
                disabled={discovering}
              >
                {discovering ? '搜索中...' : '搜索设备'}
              </button>
            </div>

            <div className="sync-local-ip-row">
              <span className="sync-local-ip-label">本机 IP:</span>
              {localIpLoading ? (
                <span className="sync-local-ip-value loading">获取中...</span>
              ) : localIp ? (
                <>
                  <span className="sync-local-ip-value">{localIp}</span>
                  <button
                    type="button"
                    className="sync-local-ip-copy"
                    onClick={handleCopyLocalIp}
                    title="复制本机 IP"
                  >
                    {localIpCopied ? '已复制' : '复制'}
                  </button>
                </>
              ) : (
                <span
                  className="sync-local-ip-value empty"
                  role="button"
                  onClick={refreshLocalIp}
                  title="点击重试"
                >
                  未获取到 · 点击重试
                </span>
              )}
            </div>

            <div className="form-group sync-manual-row">
              <input
                type="text"
                className="form-input glass"
                placeholder="IP 地址"
                value={manualIp}
                onChange={e => setManualIp(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualAdd(); }}
              />
              <input
                type="number"
                className="form-input glass sync-port-input"
                placeholder="端口"
                value={manualPort}
                onChange={e => setManualPort(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleManualAdd(); }}
              />
              <button
                className="form-reset-btn"
                onClick={handleManualAdd}
                disabled={!manualIp || manualAdding}
                title="握手验证后添加设备"
              >
                {manualAdding ? '握手中...' : '连接'}
              </button>
            </div>

            {discoveredDevices.length > 0 && (
              <div className="sync-device-list">
                {discoveredDevices.map(device => (
                  <div key={device.id} className="sync-device-item">
                    <div className="sync-device-info">
                      <span className="sync-device-name">{device.name}</span>
                      <span className="sync-device-meta">{device.ip}:{device.port} · {device.type === 'phone' ? '手机' : '电脑'}</span>
                    </div>
                    <div className="sync-device-actions">
                      <button
                        className="sync-action-btn"
                        onClick={() => handleSendToDevice(device, true)}
                        disabled={syncBusy}
                        title="发送并导入"
                      >
                        发送+导入
                      </button>
                      <button
                        className="sync-action-btn secondary"
                        onClick={() => handleSendToDevice(device, false)}
                        disabled={syncBusy}
                        title="发送仅保存"
                      >
                        发送+保存
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {transferProgress && (
              <div className="sync-progress">
                <div className="sync-progress-bar">
                  <div
                    className="sync-progress-fill"
                    style={{ width: `${transferProgress.percent}%` }}
                  />
                </div>
                <div className="form-hint">
                  {transferProgress.status === 'transferring' && `传输中 ${transferProgress.percent.toFixed(0)}%`}
                  {transferProgress.status === 'completed' && '传输完成'}
                  {transferProgress.status === 'failed' && `传输失败: ${transferProgress.error}`}
                </div>
              </div>
            )}

            {syncMessage && <div className="form-hint">{syncMessage}</div>}

            <div className="settings-subsection-title">已信任设备</div>
            {trustedDevices.length === 0 ? (
              <div className="form-hint">暂无信任设备</div>
            ) : (
              <div className="sync-device-list">
                {trustedDevices.map(device => (
                  <div key={device.id} className="sync-device-item">
                    <div className="sync-device-info">
                      <span className="sync-device-name">{device.name}</span>
                      <span className="sync-device-meta">{device.ip}:{device.port}</span>
                    </div>
                    <button
                      className="sync-action-btn remove"
                      onClick={() => handleRemoveTrusted(device.id)}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
            )}

            {receiveDialog && (
              <div className="sync-receive-dialog-overlay">
                <div className="sync-receive-dialog glass">
                  <div className="sync-receive-title">收到数据</div>
                  <div className="sync-receive-info">
                    <div>来自: <strong>{receiveDialog.fromName}</strong></div>
                    <div>文件: {receiveDialog.filename}</div>
                    <div>大小: 约 {receiveDialog.dataSize} KB</div>
                  </div>
                  <div className="sync-receive-actions">
                    <button
                      className="form-reset-btn"
                      onClick={() => handleReceiveAction('import')}
                    >
                      导入到数据库
                    </button>
                    <button
                      className="form-reset-btn secondary"
                      onClick={() => handleReceiveAction('save_only')}
                    >
                      仅保存副本
                    </button>
                    <button
                      className="form-reset-btn cancel"
                      onClick={() => handleReceiveAction('reject')}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'prompts':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">提示词配置</h2>
            {(['tagSuggestion', 'relationSuggestion', 'dialogueContext', 'autoLink', 'groupSuggestion', 'connectionSuggestion'] as const).map(key => (
              <div key={key} className="form-group">
                <label className="form-label">{PROMPT_LABELS[key]}</label>
                <textarea
                  className="form-input glass"
                  style={{ minHeight: '80px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  value={settings.ai.prompts[key] ?? ''}
                  onChange={e => { updateAIConfig({
                    prompts: {
                      ...settings.ai.prompts,
                      [key]: e.target.value,
                    },
                  }); markDirty(`ai.prompts.${key}`); }}
                  rows={4}
                />
                <span className="form-hint">{PROMPT_HINTS[key]}</span>
              </div>
            ))}
            <div className="form-group">
              <button
                className="form-reset-btn"
                onClick={() => {
                  if (confirm('确定重置所有提示词为默认值？')) {
                    updateAIConfig({ prompts: DEFAULT_PROMPTS });
                    markDirty('ai.prompts');
                  }
                }}
              >
                重置提示词为默认
              </button>
            </div>
          </div>
        );

      case 'glm':
        return (
          <div className="settings-panel-content">
            <h2 className="panel-title">GLM 模型配置</h2>
            <div className="form-hint" style={{ marginBottom: '12px' }}>
              配置智谱 GLM 大模型，启用后可在 AI 功能中智能切换使用。
            </div>

            <div className="form-group">
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={settings.ai.glm?.enabled ?? false}
                  onChange={e => {
                    updateAIConfig({
                      glm: {
                        ...settings.ai.glm!,
                        enabled: e.target.checked,
                      },
                    });
                    markDirty('ai.glm.enabled');
                  }}
                />
                <span>启用 GLM 智能切换</span>
              </label>
              <span className="form-hint">启用后，AI 功能会根据任务类型自动选择 GLM 或主模型</span>
            </div>

            <div className="form-group">
              <label className="form-label">GLM API Key</label>
              <input
                type="password"
                className="form-input glass"
                value={settings.ai.glm?.apiKey ?? ''}
                onChange={e => {
                  updateAIConfig({
                    glm: {
                      ...settings.ai.glm!,
                      apiKey: e.target.value,
                    },
                  });
                  markDirty('ai.glm.apiKey');
                }}
                placeholder="智谱 API Key"
              />
            </div>

            <div className="form-group">
              <label className="form-label">GLM 模型名称</label>
              <input
                type="text"
                className="form-input glass"
                value={settings.ai.glm?.model ?? 'glm-4-flash'}
                onChange={e => {
                  updateAIConfig({
                    glm: {
                      ...settings.ai.glm!,
                      model: e.target.value,
                    },
                  });
                  markDirty('ai.glm.model');
                }}
                placeholder="glm-4-flash"
              />
              <span className="form-hint">推荐使用 glm-4-flash（免费额度大、速度快）</span>
            </div>

            <div className="form-group">
              <label className="form-label">GLM API Base URL</label>
              <input
                type="text"
                className="form-input glass"
                value={settings.ai.glm?.baseURL ?? 'https://open.bigmodel.cn/api/paas/v4'}
                onChange={e => {
                  updateAIConfig({
                    glm: {
                      ...settings.ai.glm!,
                      baseURL: e.target.value,
                    },
                  });
                  markDirty('ai.glm.baseURL');
                }}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
              />
              <span className="form-hint">智谱开放平台 API 地址，一般无需修改</span>
            </div>
          </div>
        );

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

      {/* 主体布局：左侧栏 + 右侧配置项 */}
      <div className="settings-layout">
        {/* 左侧导航栏 */}
        <nav className="settings-sidebar">
          {TAB_LIST.map(tab => (
            <button
              key={tab.key}
              className={`settings-nav-item ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 右侧配置面板 */}
        <main className="settings-content">
          {renderPanel()}
        </main>
      </div>

      {/* 底部保存按钮 */}
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

      <BottomNav />
    </div>
  );
}
