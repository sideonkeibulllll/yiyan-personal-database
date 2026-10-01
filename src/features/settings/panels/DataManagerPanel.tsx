/**
 * 设置面板 - 数据管理
 */
import { useNavigate } from 'react-router-dom';
import { IconDatabase, IconChevronRight } from '@/components/icons';

export function DataManagerPanel() {
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
    </div>
  );
}