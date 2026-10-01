/**
 * 设置面板 - GLM 模型配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useSettingsStore } from '@/stores/settingsStore';

interface GlmPanelProps {
  markDirty: (field: string) => void;
}

export function GlmPanel({ markDirty }: GlmPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">GLM 模型配置</h2>
      <div className="form-hint" style={{ marginBottom: '12px' }}>
        配置智谱 GLM 大模型，启用后可在 AI 功能中智能切换使用。
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.ai.glm?.enabled ?? false}
            onChange={e => {
              updateAIConfig({
                glm: {
                  ...settings.ai.glm!,
                  enabled: e.target.checked,
                },
              });
              markDirty('ai.glm.enabled');
            }}
          />
          <span>启用 GLM 智能切换</span>
        </label>
        <span className="form-hint">启用后，AI 功能会根据任务类型自动选择 GLM 或主模型</span>
      </div>

      <div className="form-group">
        <label className="form-label">GLM API Key</label>
        <input
          type="password"
          className="form-input glass"
          value={settings.ai.glm?.apiKey ?? ''}
          onChange={e => {
            updateAIConfig({
              glm: {
                ...settings.ai.glm!,
                apiKey: e.target.value,
              },
            });
            markDirty('ai.glm.apiKey');
          }}
          placeholder="智谱 API Key"
        />
      </div>

      {/* d: GLM 模型名称已移除，使用默认 glm-4-flash */}

      <div className="form-group">
        <label className="form-label">GLM API Base URL</label>
        <input
          type="text"
          className="form-input glass"
          value={settings.ai.glm?.baseURL ?? 'https://open.bigmodel.cn/api/paas/v4'}
          onChange={e => {
            updateAIConfig({
              glm: {
                ...settings.ai.glm!,
                baseURL: e.target.value,
              },
            });
            markDirty('ai.glm.baseURL');
          }}
          placeholder="https://open.bigmodel.cn/api/paas/v4"
        />
        <span className="form-hint">智谱开放平台 API 地址，一般无需修改</span>
      </div>
    </div>
  );
}