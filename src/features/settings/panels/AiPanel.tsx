/**
 * 设置面板 - AI 配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AIProviderId, ProviderEntry } from '@/types';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS, getProviderPreset } from '@/types';

interface AiPanelProps {
  markDirty: (field: string) => void;
}

export function AiPanel({ markDirty }: AiPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateContextConfig = useSettingsStore(state => state.updateContextConfig);
  const updatePushConfig = useSettingsStore(state => state.updatePushConfig);
  const [newModel, setNewModel] = useState('');

  // v2.5.1: openai 已移除，兜底为 deepseek
  const providerId: AIProviderId = settings.ai.provider || 'deepseek';
  const preset = getProviderPreset(providerId);
  const entry: ProviderEntry = settings.ai.providers?.[providerId] ?? {
    apiKey: settings.ai.apiKey,
    baseURL: settings.ai.baseURL,
    model: settings.ai.model,
    models: [...preset.models],
  };

  /** 更新当前提供商的某个字段（保持 providers 结构与扁平字段同步） */
  const patchProvider = (patch: Partial<ProviderEntry>) => {
    const next: ProviderEntry = { ...entry, ...patch };
    updateAIConfig({
      providers: { ...settings.ai.providers!, [providerId]: next },
      // 扁平字段同步，兼容未迁移的旧读取路径
      apiKey: next.apiKey,
      baseURL: next.baseURL,
      model: next.model,
      isDeepSeek: providerId === 'deepseek',
    });
  };

  /* === v2.5.1: 模型列表增删（仅硅基流动开放编辑） === */
  const addModel = () => {
    const name = newModel.trim();
    if (!name) return;
    if (entry.models.includes(name)) { setNewModel(''); return; }
    patchProvider({ models: [...entry.models, name] });
    setNewModel('');
    markDirty('ai.providers');
  };

  const removeModel = (name: string) => {
    // 至少保留 1 个模型
    if (entry.models.length <= 1) return;
    const next = entry.models.filter(m => m !== name);
    // 若删掉的正是当前选用模型，自动切到列表首个
    const nextSelected = entry.model === name ? next[0] : entry.model;
    patchProvider({ models: next, model: nextSelected });
    markDirty('ai.providers');
  };

  /** 切换到另一个提供商：自动填入该提供商的已存配置（无则用预设默认值） */
  const switchProvider = (id: AIProviderId) => {
    if (id === providerId) return;
    const p = PROVIDER_PRESETS[id];
    const target = settings.ai.providers?.[id] ?? {
      apiKey: '',
      baseURL: p.baseURL,
      model: p.defaultModel,
      models: [...p.models],
    };
    updateAIConfig({
      provider: id,
      providers: settings.ai.providers,
      apiKey: target.apiKey,
      baseURL: target.baseURL,
      model: target.model,
      isDeepSeek: id === 'deepseek',
    });
    markDirty('ai.provider');
  };

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">AI 配置</h2>

      <div className="form-group">
        <label className="form-label">AI 提供商</label>
        <select
          className="form-input glass"
          value={providerId}
          onChange={e => switchProvider(e.target.value as AIProviderId)}
        >
          {AI_PROVIDER_ORDER.map(id => (
            <option key={id} value={id}>{PROVIDER_PRESETS[id].label}</option>
          ))}
        </select>
        <span className="form-hint">每个提供商的配置独立保存，切换不会互相影响</span>
      </div>

      <div className="form-group">
        <label className="form-label">API Key</label>
        <input
          type="password"
          className="form-input glass"
          value={entry.apiKey}
          onChange={e => { patchProvider({ apiKey: e.target.value }); markDirty('ai.providers'); }}
          placeholder={preset.keyPlaceholder}
        />
      </div>

      <div className="form-group">
        <label className="form-label">API 地址</label>
        <input
          type="text"
          className="form-input glass"
          value={entry.baseURL}
          onChange={e => { patchProvider({ baseURL: e.target.value }); markDirty('ai.providers'); }}
          placeholder={preset.baseURL}
        />
      </div>

      <div className="form-group">
        <label className="form-label">模型</label>
        <select
          className="form-input glass"
          value={entry.model}
          onChange={e => { patchProvider({ model: e.target.value }); markDirty('ai.providers'); }}
        >
          {/* 若当前模型不在候选里（历史手填值），补一个选项避免它被吞掉 */}
          {!entry.models.includes(entry.model) && entry.model && (
            <option value={entry.model}>{entry.model}</option>
          )}
          {entry.models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="form-hint">选择该提供商下要使用的模型</span>
      </div>

      {/* v2.5.1: 模型列表编辑（仅硅基流动开放，其余提供商模型固定） */}
      {providerId === 'siliconflow' && (
        <>
          <div className="settings-subsection-title">管理模型列表</div>
          <div className="form-group">
            {entry.models.length === 0 && (
              <span className="form-hint">（暂无模型，请添加）</span>
            )}
            {entry.models.map(m => (
              <div key={m} className="model-manage-row">
                <span className="model-manage-name">{m}</span>
                <button
                  type="button"
                  className="model-manage-del"
                  onClick={() => removeModel(m)}
                  disabled={entry.models.length <= 1}
                  title={entry.models.length <= 1 ? '至少保留一个模型' : '删除'}
                >
                  删除
                </button>
              </div>
            ))}
            <span className="form-hint">至少保留一个模型；删除当前选用的模型会自动切到列表首个</span>
          </div>
          <div className="form-group">
            <label className="form-label">添加模型</label>
            <div className="model-manage-add">
              <input
                type="text"
                className="form-input glass"
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel(); } }}
                placeholder="如 deepseek-ai/DeepSeek-V4-Flash"
              />
              <button type="button" className="model-manage-add-btn" onClick={addModel}>
                添加
              </button>
            </div>
            <span className="form-hint">填入硅基流动支持的模型名，回车或点「添加」即可</span>
          </div>
        </>
      )}

      {providerId === 'deepseek' && (
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