/**
 * 设置面板 - 桌面组件样式（v2.15.0）
 *
 * 独立性声明：本面板是 services/widgetService 门面在 UI 层的消费方之一。
 * 样式存 settings.widget.styles（经 updateWidgetConfig 持久化 + 云备份），
 * 改动后立即 applyWidgetStyles() 下发原生重绘 —— 不直接触碰原生插件。
 *
 * ⚠️ 真·背景虚化（毛玻璃）在 AppWidget 上做不到：小组件由 launcher 进程绘制，
 *    无法跨窗口采样其背后内容。此处只能做「透亮融合」的半透明视觉近似。
 */
import { useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { isWidgetSupported, applyWidgetStyles } from '@/services/widgetService';
import type { WidgetStyle, WidgetStyleMap, WidgetStyleTarget } from '@/types';
import './WidgetStylePanel.css';

/** 可配置样式的组件（顺序即面板顺序） */
const TARGETS: { key: WidgetStyleTarget; label: string; hint: string }[] = [
  { key: 'memory', label: '记忆卡片', hint: '基础记忆卡片（每天自动换一张）' },
  { key: 'memoryRefresh', label: '记忆卡片 · 换一张', hint: '带「换一张」按钮的卡片' },
  { key: 'todo', label: '待办清单', hint: '1 大 + 5 小的待办橱窗' },
  { key: 'niko', label: 'niko 挂件', hint: '挂在绳子上的 niko' },
  { key: 'wheel', label: '转盘', hint: '可以「转动」的转盘' },
  { key: 'clock', label: '时钟', hint: '只显示时间的数字时钟（HH : mm）' },
];

/** 样式选项（swatch 颜色与原生 drawable 保持一致，用于直观预览） */
const STYLE_OPTIONS: { value: WidgetStyle; label: string; desc: string }[] = [
  { value: 'default', label: '默认', desc: '不透明深棕底' },
  { value: 'blend', label: '透亮', desc: '半透明，融入壁纸' },
  { value: 'ultra', label: '极致透明', desc: '几乎全透，字带投影' },
];

export function WidgetStylePanel() {
  const settings = useSettingsStore(state => state.settings);
  const updateWidgetConfig = useSettingsStore(state => state.updateWidgetConfig);
  const styles = settings.widget.styles;
  const nikoClock = settings.widget.nikoClock;

  const supported = isWidgetSupported();

  /** 切换某组件的样式：写配置 + 立即下发原生重绘 */
  const choose = useCallback((key: WidgetStyleTarget, value: WidgetStyle) => {
    if (styles[key] === value) return;
    const next: WidgetStyleMap = { ...styles, [key]: value };
    updateWidgetConfig({ styles: next });
    void applyWidgetStyles();
  }, [styles, updateWidgetConfig]);

  /** niko 底层时钟开关：与背景样式不互斥，可叠加 */
  const toggleNikoClock = useCallback(() => {
    updateWidgetConfig({ nikoClock: !nikoClock });
    void applyWidgetStyles();
  }, [nikoClock, updateWidgetConfig]);

  if (!supported) {
    return (
      <div className="settings-panel-content">
        <h2 className="panel-title">桌面组件样式</h2>
        <div className="widget-unsupported">
          桌面小组件仅安卓手机可用，样式设置在其它设备上不生效。
        </div>
      </div>
    );
  }

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">桌面组件样式</h2>
      <div className="form-hint">
        给每个桌面小组件单独挑一个外观；改完立即生效，不用重新添加小组件。
      </div>

      {TARGETS.map(target => (
        <div className="form-group" key={target.key}>
          <label className="form-label">{target.label}</label>
          <div className="widget-style-hint">{target.hint}</div>
          <div className="widget-style-options">
            {STYLE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`widget-style-opt ${styles[target.key] === opt.value ? 'active' : ''}`}
                onClick={() => choose(target.key, opt.value)}
                aria-pressed={styles[target.key] === opt.value}
              >
                <span className={`widget-style-swatch swatch-${opt.value}`} aria-hidden="true" />
                <span className="widget-style-opt-text">
                  <span className="widget-style-opt-name">{opt.label}</span>
                  <span className="widget-style-opt-desc">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* v2.16.0：niko 底层时钟开关（与上面的背景样式不互斥，可叠加） */}
      <div className="form-group">
        <label className="form-label">niko 挂件 · 时钟</label>
        <label className="widget-toggle-row">
          <input
            type="checkbox"
            checked={nikoClock}
            onChange={toggleNikoClock}
          />
          <span>在 niko 背后显示一个放大的时钟（HH : mm : ss）</span>
        </label>
        <span className="form-hint">
          时钟画在 niko 下方，会有种「niko 在前、时钟在后」的感觉。
          它和上面的「透亮 / 极致透明」可以同时开，互不影响。
        </span>
      </div>

      <div className="form-group">
        <span className="form-hint">
          「透亮」是半透明底（约七成深色）；「极致透明」几乎全透、最大程度露出壁纸，
          靠文字投影保证看得清。真正的背景虚化（毛玻璃）系统不支持，所以只能在这三档里调。
        </span>
      </div>
    </div>
  );
}
