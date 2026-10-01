/**
 * 设置面板 - 待办配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { IconChevronRight } from '@/components/icons';

interface TodoPanelProps {
  markDirty: (field: string) => void;
}

export function TodoPanel({ markDirty }: TodoPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateTodoConfig = useSettingsStore(state => state.updateTodoConfig);
  const navigate = useNavigate();

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
}