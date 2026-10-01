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
      <h2 className="panel-title">GLM 免费模型池</h2>
      <div className="form-hint" style={{ marginBottom: '12px' }}>
        启用后，标签建议、分组建议、连线分析等<strong>简单任务</strong>会自动使用智谱的免费模型，
        按顺序轮询请求以分摊配额，<strong>不消耗你的付费额度</strong>。对话（Chat）仍使用上方设置的主模型。
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
          <span>启用 GLM 免费模型池</span>
        </label>
        <span className="form-hint">开启后无需手动选模型，系统会自动在免费模型间轮询</span>
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

      {/* 模型名不暴露给用户：由 GLM_FREE_MODEL_POOL 自动轮询 */}

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