/**
 * 设置面板 - 本地备份
 *
 * 状态与备份逻辑由父组件 SettingsPage 持有，本组件只负责展示。
 */
import { IconRestore, IconTrash } from '@/components/icons';
import type { BackupItem } from '@/services/backupTypes';

interface BackupPanelProps {
  backups: BackupItem[];
  backupBusy: boolean;
  backupMessage: string;
  restoreBusy: boolean;
  onCreateBackup: () => void;
  onExportToDownload: () => void;
  onRestoreFromBackup: (filename: string) => void;
  onDeleteBackup: (filename: string) => void;
}

export function BackupPanel({
  backups,
  backupBusy,
  backupMessage,
  restoreBusy,
  onCreateBackup,
  onExportToDownload,
  onRestoreFromBackup,
  onDeleteBackup,
}: BackupPanelProps) {
  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">本地备份</h2>
      <div className="form-group">
        <button
          className="form-reset-btn"
          onClick={onCreateBackup}
          disabled={backupBusy}
        >
          {backupBusy ? '备份中...' : '创建备份副本'}
        </button>
      </div>
      <div className="form-group">
        <button
          className="form-reset-btn"
          onClick={onExportToDownload}
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
                  {item.format === 'indexed' ? '索引式 · ' : ''}
                  {item.manifest.entryCount} 条 · {item.manifest.todoCount} 待办 · {(item.size / 1024).toFixed(1)}KB
                </div>
              </div>
              <div className="backup-item-actions">
                <button
                  className="backup-action-btn restore"
                  onClick={() => onRestoreFromBackup(item.filename)}
                  disabled={restoreBusy}
                  title="从该备份恢复"
                >
                  <IconRestore />
                </button>
                <button
                  className="backup-action-btn delete"
                  onClick={() => onDeleteBackup(item.filename)}
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
}