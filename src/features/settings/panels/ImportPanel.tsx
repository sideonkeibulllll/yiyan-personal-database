/**
 * 设置面板 - 数据导入
 *
 * 状态与导入逻辑由父组件 SettingsPage 持有，本组件只负责展示。
 */
import type { ChangeEvent, RefObject } from 'react';
import { IconUpload, IconChevronRight } from '@/components/icons';
import type { ImportResult } from '@/features/datamanager/types';

interface ImportPanelProps {
  importResult: ImportResult | null;
  importing: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onCloseResult: () => void;
}

export function ImportPanel({
  importResult,
  importing,
  fileInputRef,
  onFileSelect,
  onCloseResult,
}: ImportPanelProps) {
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
        onChange={onFileSelect}
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
            <button className="import-close-btn" onClick={onCloseResult}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}