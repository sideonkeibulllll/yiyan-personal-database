/**
 * 设置页面
 * AI 配置 + 数据管理器 + 数据导入 + 随机浏览配置
 */
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEntryStore } from '@/stores/entryStore';
import { BottomNav } from '@/components/BottomNav';
import { incrementalImport } from '@/utils/import';
import { DEFAULT_PROMPTS } from '@/types';
import type { PromptConfig } from '@/types';
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
  prepareZipForSend,
  sendZipToDevice,
  getLocalIp,
} from '@/services/syncService';
import type {
  DiscoveredDevice,
  TrustedDevice,
  TransferProgress,
} from '@/services/backupTypes';
import './SettingsPage.css';

/** 提示词标签 */
const PROMPT_LABELS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '标签建议提示词',
  relationSuggestion: '关联建议提示词',
  dialogueContext: '对话上下文提示词',
  autoLink: '自动连线提示词',
};

/** 提示词提示 */
const PROMPT_HINTS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '可用变量: {content} {context}',
  relationSuggestion: '可用变量: {contentA} {contentB}',
  dialogueContext: '可用变量: {longTermMemory} {recentEntries} {currentEntry}',
  autoLink: '可用变量: {newEntry} {candidates}',
};

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

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateRandomConfig = useSettingsStore(state => state.updateRandomConfig);
  const updateTodoConfig = useSettingsStore(state => state.updateTodoConfig);
  const updateContextConfig = useSettingsStore(state => state.updateContextConfig);
  const updatePushConfig = useSettingsStore(state => state.updatePushConfig);
  const entries = useEntryStore(state => state.entries);
  const [showAIConfig, setShowAIConfig] = useState(false);
  const [showRandomConfig, setShowRandomConfig] = useState(false);
  const [showTodoConfig, setShowTodoConfig] = useState(false);
  const [showContextConfig, setShowContextConfig] = useState(false);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [showRestorePanel, setShowRestorePanel] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
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

  // 同步状态
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('8443');
  const [syncBusy, setSyncBusy] = useState(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [localIp, setLocalIp] = useState('');
  const [localIpLoading, setLocalIpLoading] = useState(false);
  const [localIpCopied, setLocalIpCopied] = useState(false);

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

  // =====
  // 同步处理
  // =====

  const refreshTrustedDevices = () => {
    setTrustedDevices(getTrustedDevices());
  };

  // 获取本机 IP
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

  // 复制本机 IP 到剪贴板
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

  const handleManualAdd = () => {
    if (!manualIp) return;
    const port = parseInt(manualPort) || 8443;
    const device = createDeviceByIp(manualIp, port);
    setDiscoveredDevices(prev => {
      if (prev.find(d => d.id === device.id)) return prev;
      return [...prev, device];
    });
    setSyncMessage(`已添加设备: ${device.name}`);
  };

  const handleSendToDevice = async (device: DiscoveredDevice, requestImport: boolean) => {
    setSyncBusy(true);
    setTransferProgress(null);
    setSyncMessage(`正在准备数据发送到 ${device.name}...`);
    try {
      const { base64, filename, size } = await prepareZipForSend();
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

  return (
    <div className="settings-page">
      <main className="page-content">
        {/* AI 配置入口 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowAIConfig(!showAIConfig)}
          >
            <div className="item-left">
              <span className="item-icon"><IconBot /></span>
              <div>
                <span className="item-title">AI 配置</span>
                <span className="item-desc">
                  {settings.ai.apiKey ? '已配置' : '未配置'}
                </span>
              </div>
            </div>
            <span className="item-arrow">{showAIConfig ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showAIConfig && (
            <div className="settings-detail glass">
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input
                  type="password"
                  className="form-input glass"
                  value={settings.ai.apiKey}
                  onChange={e => updateAIConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">API 地址</label>
                <input
                  type="text"
                  className="form-input glass"
                  value={settings.ai.baseURL}
                  onChange={e => updateAIConfig({ baseURL: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">模型</label>
                {settings.ai.isDeepSeek ? (
                  <select
                    className="form-input glass"
                    value={settings.ai.model}
                    onChange={e => updateAIConfig({ model: e.target.value })}
                  >
                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input glass"
                    value={settings.ai.model}
                    onChange={e => updateAIConfig({ model: e.target.value })}
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
                      onChange={e => updateAIConfig({
                        deepSeekOptions: {
                          ...settings.ai.deepSeekOptions,
                          temperature: parseFloat(e.target.value) || 0.7,
                        },
                      })}
                      min="0"
                      max="2"
                      step="0.1"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Tokens</label>
                    <input
                      type="number"
                      className="form-input glass"
                      value={settings.ai.deepSeekOptions.maxTokens}
                      onChange={e => updateAIConfig({
                        deepSeekOptions: {
                          ...settings.ai.deepSeekOptions,
                          maxTokens: parseInt(e.target.value) || 2000,
                        },
                      })}
                      min="100"
                      max="32000"
                      step="100"
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
                  onChange={e => updateAIConfig({
                    smartTag: {
                      ...settings.ai.smartTag,
                      recentTagCount: parseInt(e.target.value) || 50,
                      tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
                    },
                  })}
                  min="5"
                  max="200"
                  step="5"
                />
                <span className="form-hint">标签建议时发送给 AI 的最近标签数（越多越准，但耗 token）</span>
              </div>
              <div className="form-group">
                <label className="form-label">标签建议提示词</label>
                <textarea
                  className="form-input glass"
                  style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  value={settings.ai.smartTag?.tagSuggestPrompt ?? ''}
                  onChange={e => updateAIConfig({
                    smartTag: {
                      recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
                      tagSuggestPrompt: e.target.value,
                    },
                  })}
                  placeholder="可用变量: {recentTags} {content}"
                  rows={6}
                />
                <span className="form-hint">变量: {`{recentTags}`} = 最近标签列表, {`{content}`} = 当前条目内容</span>
              </div>

              {/* 上下文范围配置 */}
              <div className="settings-subsection-title">上下文范围</div>
              <div className="form-group">
                <label className="form-label">近期条目数量</label>
                <input
                  type="number"
                  className="form-input glass"
                  value={settings.context.recentWindow}
                  onChange={e => updateContextConfig({ recentWindow: Math.max(1, Math.min(200, parseInt(e.target.value) || 20)) })}
                  min="1"
                  max="200"
                  step="1"
                />
                <span className="form-hint">AI 对话时参考的最近条目数（越大上下文越丰富，但耗 token）</span>
              </div>
              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.context.enableLongTermMemory ?? false}
                    onChange={e => updateContextConfig({ enableLongTermMemory: e.target.checked })}
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
                    onChange={e => updatePushConfig({ enabled: e.target.checked })}
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
                  onChange={e => updatePushConfig({ similarityThreshold: parseFloat(e.target.value) })}
                  min="0.3"
                  max="1"
                  step="0.05"
                />
                <span className="form-hint">值越高要求越严格（当前: {(settings.push?.similarityThreshold ?? 0.7).toFixed(2)}）</span>
              </div>

              {/* 提示词配置 */}
              <div className="settings-subsection-title">提示词配置</div>
              {(['tagSuggestion', 'relationSuggestion', 'dialogueContext', 'autoLink'] as const).map(key => (
                <div key={key} className="form-group">
                  <label className="form-label">{PROMPT_LABELS[key]}</label>
                  <textarea
                    className="form-input glass"
                    style={{ minHeight: '80px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                    value={settings.ai.prompts[key]}
                    onChange={e => updateAIConfig({
                      prompts: {
                        ...settings.ai.prompts,
                        [key]: e.target.value,
                      },
                    })}
                    rows={4}
                  />
                  <span className="form-hint">{PROMPT_HINTS[key]}</span>
                </div>
              ))}
              {/* 重置提示词按钮 */}
              <div className="form-group">
                <button
                  className="form-reset-btn"
                  onClick={() => {
                    if (confirm('确定重置所有提示词为默认值？')) {
                      updateAIConfig({ prompts: DEFAULT_PROMPTS });
                    }
                  }}
                >
                  重置提示词为默认
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 待办配置 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowTodoConfig(!showTodoConfig)}
          >
            <div className="item-left">
              <span className="item-icon"><IconClipboard /></span>
              <div>
                <span className="item-title">待办配置</span>
                <span className="item-desc">
                  {settings.todo?.showCountdown ? '倒计时已开启' : '倒计时已关闭'}
                </span>
              </div>
            </div>
            <span className="item-arrow">{showTodoConfig ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showTodoConfig && (
            <div className="settings-detail glass">
              {/* 倒计时配置 */}
              <div className="settings-subsection-title">倒计时</div>
              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.todo?.showCountdown ?? true}
                    onChange={e => updateTodoConfig({ showCountdown: e.target.checked })}
                  />
                  <span>显示倒计时条</span>
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">倒计时格式</label>
                <select
                  className="form-input glass"
                  value={settings.todo?.countdownFormat ?? 'full'}
                  onChange={e => updateTodoConfig({ countdownFormat: e.target.value as 'full' | 'compact' | 'daysOnly' })}
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
                  onChange={e => updateTodoConfig({ countdownPosition: e.target.value as 'aboveBottomNav' | 'pageTop' | 'floating' })}
                >
                  <option value="aboveBottomNav">底栏上方</option>
                  <option value="pageTop">页面顶部</option>
                  <option value="floating">悬浮窗</option>
                </select>
              </div>

              {/* 其他配置 */}
              <div className="settings-subsection-title">其他</div>
              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.todo?.confirmDelete ?? true}
                    onChange={e => updateTodoConfig({ confirmDelete: e.target.checked })}
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
                  onChange={e => updateTodoConfig({ recycleBinRetentionDays: Math.max(1, parseInt(e.target.value) || 30) })}
                  min="1"
                  max="365"
                  step="1"
                />
                <span className="form-hint">超过此天数的已删除待办将自动清除</span>
              </div>

              {/* 入口到待办管理器和模板 */}
              <div className="settings-subsection-title">高级</div>
              <button
                className="settings-item glass"
                onClick={() => navigate('/todo/manager')}
              >
                <div className="item-left">
                  <span className="item-title">待办管理器</span>
                  <span className="item-desc">时间轴视图 · 批量操作</span>
                </div>
                <span className="item-arrow"><IconChevronRight /></span>
              </button>
              <button
                className="settings-item glass"
                onClick={() => navigate('/todo/templates')}
              >
                <div className="item-left">
                  <span className="item-title">模板管理</span>
                  <span className="item-desc">创建和应用待办模板</span>
                </div>
                <span className="item-arrow"><IconChevronRight /></span>
              </button>
              <button
                className="settings-item glass"
                onClick={() => navigate('/todo/recycle-bin')}
              >
                <div className="item-left">
                  <span className="item-title">回收站</span>
                  <span className="item-desc">恢复或彻底删除待办</span>
                </div>
                <span className="item-arrow"><IconChevronRight /></span>
              </button>
            </div>
          )}
        </section>

        {/* 随机浏览配置 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowRandomConfig(!showRandomConfig)}
          >
            <div className="item-left">
              <span className="item-icon"><IconShuffle /></span>
              <div>
                <span className="item-title">随机浏览</span>
                <span className="item-desc">每屏 {settings.random?.cardsPerPage ?? 7} 张卡片</span>
              </div>
            </div>
            <span className="item-arrow">{showRandomConfig ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showRandomConfig && (
            <div className="settings-detail glass">
              <div className="form-group">
                <label className="form-label">每屏随机卡片数</label>
                <input
                  type="number"
                  className="form-input glass"
                  value={settings.random?.cardsPerPage ?? 7}
                  onChange={e => updateRandomConfig({
                    cardsPerPage: Math.max(1, Math.min(50, parseInt(e.target.value) || 7)),
                  })}
                  min="1"
                  max="50"
                  step="1"
                />
                <span className="form-hint">推荐 5-10 张，根据屏幕大小调整</span>
              </div>
            </div>
          )}
        </section>

        {/* 数据管理器 - 合并标签/组/数据存储 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/data-manager/tags')}
          >
            <div className="item-left">
              <span className="item-icon"><IconDatabase /></span>
              <div>
                <span className="item-title">数据管理器</span>
                <span className="item-desc">标签 · 组 · 数据存储综合管理</span>
              </div>
            </div>
            <span className="item-arrow"><IconChevronRight /></span>
          </button>
        </section>

        {/* 数据导入 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <div className="item-left">
              <span className="item-icon"><IconUpload /></span>
              <div>
                <span className="item-title">数据导入</span>
                <span className="item-desc">
                  {importing ? '导入中...' : '选择 JSON 文件增量导入'}
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
                <button
                  className="import-close-btn"
                  onClick={() => setImportResult(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 数据导出 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/export')}
          >
            <div className="item-left">
              <span className="item-icon"><IconDatabase /></span>
              <div>
                <span className="item-title">数据导出</span>
                <span className="item-desc">{entries.length} 条记录可导出</span>
              </div>
            </div>
            <span className="item-arrow"><IconChevronRight /></span>
          </button>
        </section>

        {/* ====== 数据备份 ====== */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => {
              setShowBackupPanel(!showBackupPanel);
              if (!showBackupPanel) refreshBackups();
            }}
          >
            <div className="item-left">
              <span className="item-icon"><IconBackup /></span>
              <div>
                <span className="item-title">数据备份</span>
                <span className="item-desc">创建副本 · 导出到公共目录</span>
              </div>
            </div>
            <span className="item-arrow">{showBackupPanel ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showBackupPanel && (
            <div className="settings-detail glass">
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

              {/* 备份历史列表 */}
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
          )}
        </section>

        {/* ====== 数据恢复 ====== */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowRestorePanel(!showRestorePanel)}
          >
            <div className="item-left">
              <span className="item-icon"><IconRestore /></span>
              <div>
                <span className="item-title">数据恢复</span>
                <span className="item-desc">从副本恢复 · 从 zip 增量导入</span>
              </div>
            </div>
            <span className="item-arrow">{showRestorePanel ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showRestorePanel && (
            <div className="settings-detail glass">
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
                💡 从副本恢复请点击上方“备份”中的对应备份项的恢复按钮
              </div>
            </div>
          )}
        </section>

        {/* ====== 数据互通 ====== */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => {
              setShowSyncPanel(!showSyncPanel);
              if (!showSyncPanel) {
                refreshTrustedDevices();
                refreshLocalIp();
              }
            }}
          >
            <div className="item-left">
              <span className="item-icon"><IconSync /></span>
              <div>
                <span className="item-title">数据互通</span>
                <span className="item-desc">局域网设备同步 · 发送/接收数据</span>
              </div>
            </div>
            <span className="item-arrow">{showSyncPanel ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showSyncPanel && (
            <div className="settings-detail glass">
              {/* 搜索设备 */}
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

              {/* 本机 IP 显示（方便告知对方） */}
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

              {/* 手动输入 IP */}
              <div className="form-group sync-manual-row">
                <input
                  type="text"
                  className="form-input glass"
                  placeholder="IP 地址"
                  value={manualIp}
                  onChange={e => setManualIp(e.target.value)}
                />
                <input
                  type="number"
                  className="form-input glass sync-port-input"
                  placeholder="端口"
                  value={manualPort}
                  onChange={e => setManualPort(e.target.value)}
                />
                <button className="form-reset-btn" onClick={handleManualAdd} disabled={!manualIp}>
                  添加
                </button>
              </div>

              {/* 发现的设备列表 */}
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

              {/* 传输进度 */}
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

              {/* 信任设备列表 */}
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
            </div>
          )}
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
