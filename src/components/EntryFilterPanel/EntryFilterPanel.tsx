/**
 * 条目筛选面板（共享组件，v2.14.0）
 *
 * 随机页 / 记忆来信（设置面板）共用的筛选 UI：星标三态 + 时间范围 + 标签选择（含反选）。
 *
 * 设计要点：
 *  - **纯受控组件**：只通过 value / onChange 通信，不读写任何存储（持久化各调用方自理）
 *  - **两种形态**：
 *      · 默认（弹层）：底部抽屉 + 遮罩，随机页用这种
 *      · `inline`：直接嵌在设置面板里（记忆来信用这种，不弹层）
 *  - 所有筛选变更即时 onChange（供调用方即时生效）
 *
 * ⚠️ 依赖：components/TagSelector（标签选择）、utils/timeRangeFilter（时间换算）、
 *         utils/entryFilterState（类型与纯函数）。
 */
import { useTagStore } from '@/stores/tagStore';
import { TIME_RANGE_PRESETS } from '@/utils/timeRangeFilter';
import { invertTagIds } from '@/utils/entryFilterState';
import type { EntryFilterState } from '@/utils/entryFilterState';
import type { TimeRangePreset } from '@/utils/timeRangeFilter';
import { TagSelector } from '@/components/TagSelector';
import './EntryFilterPanel.css';

interface EntryFilterPanelProps {
  /** 当前筛选条件 */
  value: EntryFilterState;
  /** 筛选变更（即时回调；调用方据此重算） */
  onChange: (next: EntryFilterState) => void;
  /** 内嵌模式：不渲染遮罩/抽屉外壳与标题栏（直接嵌进设置页） */
  inline?: boolean;
  /** 弹层模式下的关闭回调（inline 模式忽略） */
  onClose?: () => void;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const StarFilledIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const StarOutlineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export function EntryFilterPanel({ value, onChange, inline = false, onClose }: EntryFilterPanelProps) {
  const tags = useTagStore(state => state.tags);

  /** 星标变更 */
  const setStarred = (starred: boolean | undefined) => {
    onChange({ ...value, starred });
  };

  /** 时间预设（点已激活项 = 取消） */
  const setTimePreset = (preset: TimeRangePreset) => {
    const next = value.timeRange.preset === preset ? {} : { preset };
    onChange({ ...value, timeRange: next });
  };

  /** 自定义日期变更 */
  const setCustomDate = (field: 'from' | 'to', v: string) => {
    onChange({
      ...value,
      timeRange: { ...value.timeRange, preset: 'custom', [field]: v || undefined },
    });
  };

  /** 清除时间筛选 */
  const clearTimeRange = () => {
    onChange({ ...value, timeRange: {} });
  };

  /** 标签选择（TagSelector 回调） */
  const setTagIds = (tagIds: string[]) => {
    onChange({ ...value, tagIds });
  };

  /** 反选标签：全部标签中未选中的变成选中 */
  const handleInvertTags = () => {
    const allTagIds = tags.map(t => t.id);
    setTagIds(invertTagIds(allTagIds, value.tagIds));
  };

  const body = (
    <>
      {/* 星标筛选 */}
      <div className="filter-section">
        <label className="filter-label">星标状态</label>
        <div className="star-filter">
          <button className={value.starred === undefined ? 'active' : ''} onClick={() => setStarred(undefined)}>
            全部
          </button>
          <button className={value.starred === true ? 'active' : ''} onClick={() => setStarred(true)}>
            <StarFilledIcon /> 已星标
          </button>
          <button className={value.starred === false ? 'active' : ''} onClick={() => setStarred(false)}>
            <StarOutlineIcon /> 未星标
          </button>
        </div>
      </div>

      {/* 时间范围（按修改时间） */}
      <div className="filter-section">
        <label className="filter-label">时间范围（修改时间）</label>
        <div className="time-range-row">
          {TIME_RANGE_PRESETS.map(p => (
            <button
              key={p.key}
              className={value.timeRange.preset === p.key ? 'active' : ''}
              onClick={() => setTimePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button
            className={value.timeRange.preset === 'custom' ? 'active' : ''}
            onClick={() => onChange({ ...value, timeRange: { ...value.timeRange, preset: 'custom' } })}
          >
            自由选择
          </button>
        </div>
        {value.timeRange.preset === 'custom' && (
          <div className="time-range-custom">
            <input
              type="date"
              className="time-range-date"
              value={value.timeRange.from || ''}
              onChange={e => setCustomDate('from', e.target.value)}
            />
            <span className="time-range-sep">至</span>
            <input
              type="date"
              className="time-range-date"
              value={value.timeRange.to || ''}
              onChange={e => setCustomDate('to', e.target.value)}
            />
          </div>
        )}
        {value.timeRange.preset && (
          <button className="time-range-clear" onClick={clearTimeRange}>
            清除时间筛选
          </button>
        )}
      </div>

      {/* 标签筛选 */}
      <div className="filter-section">
        <div className="filter-label-row">
          <label className="filter-label">标签筛选</label>
          <button className="filter-invert-btn" onClick={handleInvertTags} type="button" title="反选标签">
            反选
          </button>
        </div>
        <TagSelector selectedTagIds={value.tagIds} onSelectionChange={setTagIds} />
      </div>
    </>
  );

  if (inline) {
    return <div className="entry-filter-inline">{body}</div>;
  }

  return (
    <div className="filter-overlay" onClick={onClose}>
      <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <h3>筛选条件</h3>
          <button onClick={onClose}><CloseIcon /></button>
        </div>
        {body}
      </div>
    </div>
  );
}
