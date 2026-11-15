/**
 * 设置面板 - 数据管理
 *
 * v3.6.1：导入 / 导出 / 数据恢复 不再是顶层导航项，统一从这里进
 * （导航从 17 项压到 14 项，移动端首页只需 4 个分组）。
 * 这三个面板本身没变，只是入口挪进来，旧深链 `?tab=import` 依然可用。
 */
import { useNavigate } from 'react-router-dom';
import { IconDatabase, IconChevronRight, IconUpload, IconDownload, IconRestore } from '@/components/icons';

interface DataManagerPanelProps {
  /** 切到对应设置面板（导入 / 导出 / 恢复都还是独立面板） */
  onOpenTab?: (tab: 'import' | 'export' | 'restore') => void;
}

export function DataManagerPanel({ onOpenTab }: DataManagerPanelProps) {
  const navigate = useNavigate();

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

      <button className="settings-item glass" onClick={() => onOpenTab?.('import')}>
        <div className="item-left">
          <span className="item-icon"><IconUpload /></span>
          <div>
            <span className="item-title">导入数据</span>
            <span className="item-desc">从 JSON 增量合并，重复项自动跳过</span>
          </div>
        </div>
        <span className="item-arrow"><IconChevronRight /></span>
      </button>

      <button className="settings-item glass" onClick={() => onOpenTab?.('export')}>
        <div className="item-left">
          <span className="item-icon"><IconDownload /></span>
          <div>
            <span className="item-title">导出数据</span>
            <span className="item-desc">导出为 JSON，可存档或迁移</span>
          </div>
        </div>
        <span className="item-arrow"><IconChevronRight /></span>
      </button>

      <button className="settings-item glass" onClick={() => onOpenTab?.('restore')}>
        <div className="item-left">
          <span className="item-icon"><IconRestore /></span>
          <div>
            <span className="item-title">恢复数据</span>
            <span className="item-desc">从本地备份或 zip 快照还原</span>
          </div>
        </div>
        <span className="item-arrow"><IconChevronRight /></span>
      </button>
    </div>
  );
}
