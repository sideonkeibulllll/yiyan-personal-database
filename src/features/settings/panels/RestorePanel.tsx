/**
 * 设置面板 - 数据恢复
 *
 * 状态与恢复逻辑由父组件 SettingsPage 持有，本组件只负责展示。
 */
import type { ChangeEvent, RefObject } from 'react';
import type { BackupManifest, RestoreResult } from '@/services/backupTypes';

interface RestorePanelProps {
  restoreBusy: boolean;
  restoreResult: RestoreResult | null;
  pendingZipFile: { file: File; manifest: BackupManifest | null } | null;
  zipFileInputRef: RefObject<HTMLInputElement>;
  onZipFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRestoreFromZip: () => void;
  onCancelPending: () => void;
  onCloseResult: () => void;
}

export function RestorePanel({
  restoreBusy,
  restoreResult,
  pendingZipFile,
  zipFileInputRef,
  onZipFileSelect,
  onRestoreFromZip,
  onCancelPending,
  onCloseResult,
}: RestorePanelProps) {
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
          onChange={onZipFileSelect}
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
              onClick={onRestoreFromZip}
              disabled={restoreBusy}
            >
              {restoreBusy ? '恢复中...' : '开始增量恢复'}
            </button>
            <button
              className="form-reset-btn cancel"
              onClick={onCancelPending}
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
          <button className="import-close-btn" onClick={onCloseResult}>关闭</button>
        </div>
      )}

      <div className="form-hint">
        💡 从副本恢复请点击「本地备份」中的对应备份项的恢复按钮
      </div>
    </div>
  );
}