/**
 * 设置面板 - 随机浏览配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useSettingsStore } from '@/stores/settingsStore';

interface RandomPanelProps {
  markDirty: (field: string) => void;
}

export function RandomPanel({ markDirty }: RandomPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateRandomConfig = useSettingsStore(state => state.updateRandomConfig);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">随机浏览</h2>
      <div className="form-group">
        <label className="form-label">每屏随机卡片数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.random?.cardsPerPage ?? 7}
          onChange={e => { updateRandomConfig({
            cardsPerPage: Math.max(1, Math.min(50, parseInt(e.target.value) || 7)),
          }); markDirty('random.cardsPerPage'); }}
          min="1" max="50" step="1"
        />
        <span className="form-hint">推荐 5-10 张，根据屏幕大小调整</span>
      </div>
      <div className="form-group">
        <label className="form-label">图片附件展示模式</label>
        <div className="form-radio-group">
          <label className={`form-radio-card ${(settings.random?.attachmentDisplayMode ?? 'inline') === 'inline' ? 'active' : ''}`}>
            <input
              type="radio"
              name="attachmentDisplayMode"
              value="inline"
              checked={(settings.random?.attachmentDisplayMode ?? 'inline') === 'inline'}
              onChange={() => { updateRandomConfig({ attachmentDisplayMode: 'inline' }); markDirty('random.attachmentDisplayMode'); }}
            />
            <span className="form-radio-title">原图直接展示</span>
            <span className="form-radio-desc">卡片文本下方纵向堆叠图片，点击可全屏放大</span>
          </label>
          <label className={`form-radio-card ${(settings.random?.attachmentDisplayMode ?? 'inline') === 'badge' ? 'active' : ''}`}>
            <input
              type="radio"
              name="attachmentDisplayMode"
              value="badge"
              checked={(settings.random?.attachmentDisplayMode ?? 'inline') === 'badge'}
              onChange={() => { updateRandomConfig({ attachmentDisplayMode: 'badge' }); markDirty('random.attachmentDisplayMode'); }}
            />
            <span className="form-radio-title">仅显示附件标识</span>
            <span className="form-radio-desc">卡片只显示附件数量徽标，点击弹出画廊查看</span>
          </label>
        </div>
        <span className="form-hint">控制随机卡片中图片附件的展示方式</span>
      </div>
      <div className="form-group">
        <label className="form-label">长文本折叠字数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.random?.contentCollapseLength ?? 300}
          onChange={e => { updateRandomConfig({
            contentCollapseLength: Math.max(0, Math.min(5000, parseInt(e.target.value) || 0)),
          }); markDirty('random.contentCollapseLength'); }}
          min="0" max="5000" step="50"
        />
        <span className="form-hint">超过该字数的卡片内容将折叠，点击「展开」查看全文；设为 0 表示不折叠</span>
      </div>
    </div>
  );
}