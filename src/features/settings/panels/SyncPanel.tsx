/**
 * 设置面板 - 设备互通
 *
 * 状态与同步逻辑由父组件 SettingsPage 持有，本组件只负责展示。
 */
import { isElectron } from '@/services/electronAdapter';
import type {
  DiscoveredDevice,
  TrustedDevice,
  TransferProgress,
  SendRequest,
} from '@/services/backupTypes';

interface SyncReceiveDialog {
  request: SendRequest;
  fromName: string;
  filename: string;
  dataSize: number;
}

interface SyncPanelProps {
  nativeServerSupported: boolean;
  serverRunning: boolean;
  serverPort: number | null;
  serverBusy: boolean;
  localIp: string;
  localIpLoading: boolean;
  localIpCopied: boolean;
  manualIp: string;
  manualPort: string;
  manualAdding: boolean;
  discovering: boolean;
  syncBusy: boolean;
  discoveredDevices: DiscoveredDevice[];
  trustedDevices: TrustedDevice[];
  transferProgress: TransferProgress | null;
  syncMessage: string;
  receiveDialog: SyncReceiveDialog | null;
  onStartServer: () => void;
  onStopServer: () => void;
  onDiscover: () => void;
  onCopyLocalIp: () => void;
  onRefreshLocalIp: () => void;
  onManualIpChange: (value: string) => void;
  onManualPortChange: (value: string) => void;
  onManualAdd: () => void;
  onSendToDevice: (device: DiscoveredDevice, requestImport: boolean) => void;
  onRemoveTrusted: (deviceId: string) => void;
  onReceiveAction: (action: 'import' | 'save_only' | 'reject') => void;
}

export function SyncPanel({
  nativeServerSupported,
  serverRunning,
  serverPort,
  serverBusy,
  localIp,
  localIpLoading,
  localIpCopied,
  manualIp,
  manualPort,
  manualAdding,
  discovering,
  syncBusy,
  discoveredDevices,
  trustedDevices,
  transferProgress,
  syncMessage,
  receiveDialog,
  onStartServer,
  onStopServer,
  onDiscover,
  onCopyLocalIp,
  onRefreshLocalIp,
  onManualIpChange,
  onManualPortChange,
  onManualAdd,
  onSendToDevice,
  onRemoveTrusted,
  onReceiveAction,
}: SyncPanelProps) {
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
                onClick={onStopServer}
                disabled={serverBusy}
              >
                {serverBusy ? '停止中...' : '停止接收服务'}
              </button>
            ) : (
              <button
                className="form-reset-btn"
                onClick={onStartServer}
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
          onClick={onDiscover}
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
              onClick={onCopyLocalIp}
              title="复制本机 IP"
            >
              {localIpCopied ? '已复制' : '复制'}
            </button>
          </>
        ) : (
          <span
            className="sync-local-ip-value empty"
            role="button"
            onClick={onRefreshLocalIp}
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
          onChange={e => onManualIpChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onManualAdd(); }}
        />
        <input
          type="number"
          className="form-input glass sync-port-input"
          placeholder="端口"
          value={manualPort}
          onChange={e => onManualPortChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onManualAdd(); }}
        />
        <button
          className="form-reset-btn"
          onClick={onManualAdd}
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
                  onClick={() => onSendToDevice(device, true)}
                  disabled={syncBusy}
                  title="发送并导入"
                >
                  发送+导入
                </button>
                <button
                  className="sync-action-btn secondary"
                  onClick={() => onSendToDevice(device, false)}
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
                onClick={() => onRemoveTrusted(device.id)}
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
                onClick={() => onReceiveAction('import')}
              >
                导入到数据库
              </button>
              <button
                className="form-reset-btn secondary"
                onClick={() => onReceiveAction('save_only')}
              >
                仅保存副本
              </button>
              <button
                className="form-reset-btn cancel"
                onClick={() => onReceiveAction('reject')}
              >
                拒绝
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}