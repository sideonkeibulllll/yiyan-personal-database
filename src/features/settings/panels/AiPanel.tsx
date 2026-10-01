/**
 * 设置面板 - AI 配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useSettingsStore } from '@/stores/settingsStore';

interface AiPanelProps {
  markDirty: (field: string) => void;
}

export function AiPanel({ markDirty }: AiPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateContextConfig = useSettingsStore(state => state.updateContextConfig);
  const updatePushConfig = useSettingsStore(state => state.updatePushConfig);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">AI 配置</h2>

      <div className="form-group">
        <label className="form-label">API Key</label>
        <input
          type="password"
          className="form-input glass"
          value={settings.ai.apiKey}
          onChange={e => { updateAIConfig({ apiKey: e.target.value }); markDirty('ai.apiKey'); }}
          placeholder="sk-..."
        />
      </div>

      <div className="form-group">
        <label className="form-label">API 地址</label>
        <input
          type="text"
          className="form-input glass"
          value={settings.ai.baseURL}
          onChange={e => { updateAIConfig({ baseURL: e.target.value }); markDirty('ai.baseURL'); }}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      <div className="form-group">
        <label className="form-label">模型</label>
        {settings.ai.isDeepSeek ? (
          <select
            className="form-input glass"
            value={settings.ai.model}
            onChange={e => { updateAIConfig({ model: e.target.value }); markDirty('ai.model'); }}
          >
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          </select>
        ) : (
          <input
            type="text"
            className="form-input glass"
            value={settings.ai.model}
            onChange={e => { updateAIConfig({ model: e.target.value }); markDirty('ai.model'); }}
            placeholder="gpt-4o-mini"
          />
        )}
      </div>

      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.ai.isDeepSeek}
            onChange={e => {
              if (e.target.checked) {
                updateAIConfig({
                  isDeepSeek: true,
                  baseURL: 'https://api.deepseek.com',
                  model: 'deepseek-v4-flash',
                });
              } else {
                updateAIConfig({
                  isDeepSeek: false,
                  baseURL: 'https://api.openai.com/v1',
                  model: 'gpt-4o-mini',
                });
              }
              markDirty('ai.isDeepSeek');
            }}
          />
          <span>使用 DeepSeek 模型</span>
        </label>
      </div>

      {settings.ai.isDeepSeek && (
        <>
          <div className="form-group">
            <label className="form-label">Temperature</label>
            <input
              type="number"
              className="form-input glass"
              value={settings.ai.deepSeekOptions.temperature}
              onChange={e => { updateAIConfig({
                deepSeekOptions: {
                  ...settings.ai.deepSeekOptions,
                  temperature: parseFloat(e.target.value) || 0.7,
                },
              }); markDirty('ai.deepSeekOptions.temperature'); }}
              min="0" max="2" step="0.1"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Tokens</label>
            <input
              type="number"
              className="form-input glass"
              value={settings.ai.deepSeekOptions.maxTokens}
              onChange={e => { updateAIConfig({
                deepSeekOptions: {
                  ...settings.ai.deepSeekOptions,
                  maxTokens: parseInt(e.target.value) || 2000,
                },
              }); markDirty('ai.deepSeekOptions.maxTokens'); }}
              min="100" max="32000" step="100"
            />
          </div>
        </>
      )}

      {/* 智能标签配置 */}
      <div className="settings-subsection-title">智能标签</div>
      <div className="form-group">
        <label className="form-label">最近使用标签数量</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.smartTag?.recentTagCount ?? 50}
          onChange={e => { updateAIConfig({
            smartTag: {
              ...settings.ai.smartTag!,
              recentTagCount: parseInt(e.target.value) || 50,
              maxTags: settings.ai.smartTag?.maxTags ?? 6,
              minTags: settings.ai.smartTag?.minTags ?? 1,
              tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
            },
          }); markDirty('ai.smartTag.recentTagCount'); }}
          min="5" max="200" step="5"
        />
        <span className="form-hint">标签建议时发送给 AI 的最近标签数（越多越准，但耗 token）</span>
      </div>
      <div className="form-group">
        <label className="form-label">最大返回标签数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.smartTag?.maxTags ?? 6}
          onChange={e => { updateAIConfig({
            smartTag: {
              ...settings.ai.smartTag!,
              maxTags: parseInt(e.target.value) || 6,
              minTags: settings.ai.smartTag?.minTags ?? 1,
              recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
              tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
            },
          }); markDirty('ai.smartTag.maxTags'); }}
          min="1" max="20" step="1"
        />
        <span className="form-hint">AI 返回标签数量上限（默认 6）</span>
      </div>
      <div className="form-group">
        <label className="form-label">最小返回标签数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.smartTag?.minTags ?? 1}
          onChange={e => { updateAIConfig({
            smartTag: {
              ...settings.ai.smartTag!,
              minTags: parseInt(e.target.value) || 1,
              maxTags: settings.ai.smartTag?.maxTags ?? 6,
              recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
              tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
            },
          }); markDirty('ai.smartTag.minTags'); }}
          min="0" max="20" step="1"
        />
        <span className="form-hint">AI 返回标签数量下限（默认 1）</span>
      </div>
      {/* 标签建议提示词已移至「提示词」面板，避免重复 */}

      {/* e.1: 组建议配置（提示词已移至「提示词」面板） */}
      <div className="settings-subsection-title">智能组建议</div>
      <div className="form-group">
        <label className="form-label">最近条目数量</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.smartGroup?.recentEntryCount ?? 50}
          onChange={e => { updateAIConfig({
            smartGroup: {
              ...settings.ai.smartGroup!,
              recentEntryCount: parseInt(e.target.value) || 50,
              groupSuggestPrompt: settings.ai.smartGroup?.groupSuggestPrompt || '',
            },
          }); markDirty('ai.smartGroup.recentEntryCount'); }}
          min="5" max="500" step="5"
        />
        <span className="form-hint">用于组建议的最近条目数量（默认 50）</span>
      </div>
      {/* 组建议提示词已移至「提示词」面板，避免重复 */}

      {/* 连线建议配置 */}
      <div className="settings-subsection-title">连线建议</div>
      <div className="form-group">
        <label className="form-label">最近条目数量</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.connectionSuggestion?.recentEntryCount ?? 100}
          onChange={e => { updateAIConfig({
            connectionSuggestion: {
              ...settings.ai.connectionSuggestion!,
              recentEntryCount: parseInt(e.target.value) || 100,
              connectionSuggestPrompt: settings.ai.connectionSuggestion?.connectionSuggestPrompt || '',
            },
          }); markDirty('ai.connectionSuggestion.recentEntryCount'); }}
          min="10" max="1000" step="10"
        />
        <span className="form-hint">用于连线建议的最近条目数量（默认 100）</span>
      </div>

      {/* e.2: Chat Soul 提示词 */}
      <div className="settings-subsection-title">Chat Soul</div>
      <div className="form-group">
        <label className="form-label">Chat Soul 提示词</label>
        <textarea
          className="form-input glass"
          style={{ minHeight: '100px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
          value={settings.ai.chatSoul ?? ''}
          onChange={e => { updateAIConfig({ chatSoul: e.target.value }); markDirty('ai.chatSoul'); }}
          placeholder="对话系统提示词，定义 AI 的角色和风格"
          rows={5}
        />
        <span className="form-hint">用于定制 AI 对话时的角色性格和回复风格</span>
      </div>

      {/* f: 数据选择器配置 */}
      <div className="settings-subsection-title">数据选择器</div>
      <div className="form-group">
        <label className="form-label">「最近」勾选项数量</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.recentPickerCount ?? 30}
          onChange={e => { updateAIConfig({ recentPickerCount: parseInt(e.target.value) || 30 }); markDirty('ai.recentPickerCount'); }}
          min="5" max="200" step="5"
        />
        <span className="form-hint">数据选择器中「最近」区域显示的条目数（默认 30）</span>
      </div>

      {/* 上下文范围配置 */}
      <div className="settings-subsection-title">上下文范围</div>
      <div className="form-group">
        <label className="form-label">近期条目数量</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.context.recentWindow}
          onChange={e => { updateContextConfig({ recentWindow: Math.max(1, Math.min(200, parseInt(e.target.value) || 20)) }); markDirty('context.recentWindow'); }}
          min="1" max="200" step="1"
        />
        <span className="form-hint">AI 对话时参考的最近条目数（越大上下文越丰富，但耗 token）</span>
      </div>
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.context.enableLongTermMemory ?? false}
            onChange={e => { updateContextConfig({ enableLongTermMemory: e.target.checked }); markDirty('context.enableLongTermMemory'); }}
          />
          <span>启用长期记忆</span>
        </label>
        <span className="form-hint">启用后 AI 会参考更多历史条目，耗 token 更多</span>
      </div>

      {/* 主动推送配置 */}
      <div className="settings-subsection-title">主动推送</div>
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={settings.push?.enabled ?? false}
            onChange={e => { updatePushConfig({ enabled: e.target.checked }); markDirty('push.enabled'); }}
          />
          <span>启用主动推送</span>
        </label>
        <span className="form-hint">录入新条目时，AI 自动推送相关历史条目</span>
      </div>
      <div className="form-group">
        <label className="form-label">相似度阈值</label>
        <input
          type="range"
          className="form-input"
          style={{ padding: 0 }}
          value={settings.push?.similarityThreshold ?? 0.7}
          onChange={e => { updatePushConfig({ similarityThreshold: parseFloat(e.target.value) }); markDirty('push.similarityThreshold'); }}
          min="0.3" max="1" step="0.05"
        />
        <span className="form-hint">值越高要求越严格（当前: {(settings.push?.similarityThreshold ?? 0.7).toFixed(2)}）</span>
      </div>
    </div>
  );
}