/**
 * 设置面板 - 云端备份
 *
 * 状态与云端备份逻辑由父组件 SettingsPage 持有，本组件只负责展示。
 */
interface CloudPanelProps {
  /** 云端备份模块是否已加载（懒加载完成后为 true） */
  moduleLoaded: boolean;
  moduleLoading: boolean;
  message: string;
  busy: boolean;
  lastBackupTs: number | null;
  backupHistory: any[];
  onLoadModule: () => void;
  onTestCloud: () => void;
  onCloudBackup: () => void;
  onCloudRestore: () => void;
}

export function CloudPanel({
  moduleLoaded,
  moduleLoading,
  message,
  busy,
  lastBackupTs,
  backupHistory,
  onLoadModule,
  onTestCloud,
  onCloudBackup,
  onCloudRestore,
}: CloudPanelProps) {
  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">云端备份</h2>
      {!moduleLoaded ? (
        <>
          <div className="form-hint" style={{ marginBottom: '12px' }}>
            Cloudflare D1 + R2 远程备份（中转站模式）
          </div>
          <div className="form-group">
            <button
              className="form-reset-btn"
              onClick={onLoadModule}
              disabled={moduleLoading}
            >
              {moduleLoading ? '加载中...' : '初始化云端备份模块'}
            </button>
          </div>
          <div className="form-hint" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            ℹ️ 点击按钮后才会加载云端备份模块，避免影响启动速度
          </div>
          {message && (
            <div className="form-hint" style={{ marginTop: '8px' }}>{message}</div>
          )}
        </>
      ) : (
        <>
          <div className="form-hint" style={{ marginBottom: '12px' }}>
            {lastBackupTs
              ? `上次备份: ${new Date(lastBackupTs).toLocaleString('zh-CN')}`
              : 'Cloudflare D1 + R2 · 中转站模式'}
          </div>

          <div className="settings-subsection-title">操作</div>
          <div className="form-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="form-reset-btn"
              onClick={onTestCloud}
              disabled={busy}
            >
              {busy ? '测试中...' : '测试连接'}
            </button>
            <button
              className="form-reset-btn"
              onClick={onCloudBackup}
              disabled={busy}
            >
              {busy ? '备份中...' : '增量备份'}
            </button>
            <button
              className="form-reset-btn"
              onClick={onCloudRestore}
              disabled={busy}
            >
              {busy ? '恢复中...' : '从云端恢复'}
            </button>
          </div>

          {lastBackupTs && (
            <div className="form-hint">
              上次备份: {new Date(lastBackupTs).toLocaleString('zh-CN')}
            </div>
          )}

          {message && (
            <div className="form-hint" style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>
              {message}
            </div>
          )}

          {backupHistory.length > 0 && (
            <>
              <div className="settings-subsection-title" style={{ marginTop: '16px' }}>备份历史</div>
              <div className="backup-list">
                {backupHistory.slice(0, 10).map((item: any) => (
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
}