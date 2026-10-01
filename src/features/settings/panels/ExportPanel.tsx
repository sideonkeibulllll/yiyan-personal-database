/**
 * 设置面板 - 数据导出
 */
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { IconDatabase, IconChevronRight } from '@/components/icons';

export function ExportPanel() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);

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
}