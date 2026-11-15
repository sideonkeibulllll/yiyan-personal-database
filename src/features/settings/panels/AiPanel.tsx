/**
 * 设置面板 - AI 配置
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { MemoryManagerPanel } from './MemoryManagerPanel';
import { SoulManagerPanel } from './SoulManagerPanel';
import { listMemories } from '@/services/aiMemory';
import { countActiveSoulFacts } from '@/services/soulFacts';
import type { AIProviderId, ProviderEntry } from '@/types';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS, getProviderPreset, getEnabledModels } from '@/types';
import {
  parseCredential,
  fetchCreditsInfo,
  claimCheckin,
  type TraeCreditsInfo,
} from '@/services/aiProviders/trae';

interface AiPanelProps {
  markDirty: (field: string) => void;
}

/** 数值兜底：非法输入回落默认值，并夹紧到 [min, max] */
function clampNumber(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

export function AiPanel({ markDirty }: AiPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateContextConfig = useSettingsStore(state => state.updateContextConfig);
  const updatePushConfig = useSettingsStore(state => state.updatePushConfig);
  const [newModel, setNewModel] = useState('');
  // v2.11.0: 长期记忆管理面板（v3.4.0 起定位为「素材收件箱」）
  const [showMemoryManager, setShowMemoryManager] = useState(false);
  const [memoryCount, setMemoryCount] = useState(() => listMemories().length);
  // v3.4.0: Soul 事实库管理面板
  const [showSoulManager, setShowSoulManager] = useState(false);
  const [soulFactCount, setSoulFactCount] = useState(() => countActiveSoulFacts());
  // TRAE：积分余额与签到（仅在该提供商下初始化）
  const [credits, setCredits] = useState<TraeCreditsInfo | null>(null);
  const [creditsBusy, setCreditsBusy] = useState(false);
  const [creditsMsg, setCreditsMsg] = useState('');

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

  /* === TRAE：凭据解析 + 积分/签到 === */

  const traeCredential = useMemo(
    () => (providerId === 'trae' ? parseCredential(entry.apiKey) : null),
    [providerId, entry.apiKey],
  );

  /** 当前提供商实际可选的模型（受「启用」勾选约束，未配置时等于全量）。 */
  const selectableModels = getEnabledModels(entry);

  const refreshCredits = async () => {
    if (traeCredential === null) {
      setCreditsMsg('请先粘贴有效的 TRAE 凭据');
      return;
    }
    setCreditsBusy(true);
    setCreditsMsg('');
    try {
      setCredits(await fetchCreditsInfo(traeCredential));
    } catch (error) {
      setCreditsMsg(error instanceof Error ? error.message : '读取积分失败');
    } finally {
      setCreditsBusy(false);
    }
  };

  const handleCheckin = async () => {
    if (traeCredential === null) {
      setCreditsMsg('请先粘贴有效的 TRAE 凭据');
      return;
    }
    setCreditsBusy(true);
    setCreditsMsg('');
    try {
      const result = await claimCheckin(traeCredential);
      setCreditsMsg(
        result.credits > 0
          ? `签到成功，获得 ${result.credits} 积分`
          : result.message || '今日已签到',
      );
      setCredits(await fetchCreditsInfo(traeCredential));
    } catch (error) {
      setCreditsMsg(error instanceof Error ? error.message : '签到失败');
    } finally {
      setCreditsBusy(false);
    }
  };

  /** 切换某个模型的启用状态（取消勾选即从 chat 页下拉里移除）。 */
  const toggleModel = (name: string) => {
    const current = getEnabledModels(entry);
    const next = current.includes(name)
      ? current.filter(m => m !== name)
      : [...current, name];
    if (next.length === 0) return;
    // 当前选用的模型被取消时，自动切到剩下的第一个
    const nextSelected = next.includes(entry.model) ? entry.model : next[0];
    patchProvider({ enabledModels: next, model: nextSelected });
    markDirty('ai.providers');
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
        <label className="form-label">{providerId === 'trae' ? 'TRAE 凭据' : 'API Key'}</label>
        {providerId === 'trae' ? (
          <textarea
            className="form-input glass"
            rows={4}
            value={entry.apiKey}
            onChange={e => { patchProvider({ apiKey: e.target.value }); markDirty('ai.providers'); setCredits(null); setCreditsMsg(''); }}
            placeholder={preset.keyPlaceholder}
            spellCheck={false}
          />
        ) : (
          <input
            type="password"
            className="form-input glass"
            value={entry.apiKey}
            onChange={e => { patchProvider({ apiKey: e.target.value }); markDirty('ai.providers'); }}
            placeholder={preset.keyPlaceholder}
          />
        )}
        {providerId === 'trae' && (
          <span className="form-hint">
            粘贴含 access_token / refresh_token / machine_id / device_id 的 JSON，只存本机
          </span>
        )}
      </div>

      {/* TRAE：积分余额与每日签到 */}
      {providerId === 'trae' && (
        <>
          <div className="settings-subsection-title">TRAE 账户</div>
          <div className="form-group">
            <div className="model-manage-row">
              <span className="model-manage-name">
                {credits === null
                  ? '积分余额：未读取'
                  : `积分余额：${credits.totalBalance.toFixed(2)}｜今日签到：${credits.checkedIn ? '已签' : '未签'}`}
              </span>
              <button
                type="button"
                className="model-manage-add-btn"
                onClick={refreshCredits}
                disabled={creditsBusy || traeCredential === null}
              >
                刷新
              </button>
            </div>
            <div className="model-manage-row">
              <span className="model-manage-name">
                {credits === null ? '每日签到可得积分' : `今日可得：${credits.dailyCredits}`}
              </span>
              <button
                type="button"
                className="model-manage-add-btn"
                onClick={handleCheckin}
                disabled={creditsBusy || traeCredential === null || credits?.checkedIn === true}
              >
                {credits?.checkedIn === true ? '已签到' : '签到'}
              </button>
            </div>
            {creditsMsg.length > 0 && <span className="form-hint">{creditsMsg}</span>}
            <span className="form-hint">签到每天一次，积分用于 TRAE 模型的调用额度</span>
          </div>
        </>
      )}

      {/* TRAE 的接口地址固定，不给用户改的机会，免得填错 */}
      {providerId !== 'trae' && (
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
      )}

      <div className="form-group">
        <label className="form-label">模型</label>
        <select
          className="form-input glass"
          value={entry.model}
          onChange={e => { patchProvider({ model: e.target.value }); markDirty('ai.providers'); }}
        >
          {/* 若当前模型不在候选里（历史手填值），补一个选项避免它被吞掉 */}
          {!selectableModels.includes(entry.model) && entry.model && (
            <option value={entry.model}>{entry.model}</option>
          )}
          {selectableModels.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span className="form-hint">
          {providerId === 'trae'
            ? '只有下方勾选的模型会出现在这里，以及 chat 页的模型下拉中'
            : '选择该提供商下要使用的模型'}
        </span>
      </div>

      {/* TRAE：勾选要启用的模型（22 个模型全列出来太长，默认全开，按需关掉） */}
      {providerId === 'trae' && (
        <>
          <div className="settings-subsection-title">启用模型</div>
          <div className="form-group">
            {entry.models.map(name => {
              const checked = selectableModels.includes(name);
              return (
                <label key={name} className="model-manage-row" style={{ cursor: 'pointer' }}>
                  <span className="model-manage-name">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModel(name)}
                      style={{ marginRight: 8 }}
                    />
                    {name}
                  </span>
                </label>
              );
            })}
            <span className="form-hint">至少保留一个；取消勾选当前使用中的模型会自动切到剩下的第一个</span>
          </div>
        </>
      )}

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

      {/* v3.4.0: Soul 事实库（档案进化） */}
      <div className="settings-subsection-title">Soul 事实档案</div>
      <div className="form-group">
        <span className="form-hint">
          供 AI 了解你本人（与上面的 Chat Soul 不同——那份定义 AI 的角色风格）。
          只存事实与状态，不存指令与偏好；AI 只能提议变更，必须经你确认后才会写入。
        </span>
        <button
          className="settings-link-btn"
          type="button"
          onClick={() => setShowSoulManager(true)}
        >
          管理事实库（{soulFactCount} 条）
        </button>
        {(settings.ai.soul ?? '').trim() && (
          <span className="form-hint">
            检测到旧版档案文本（{(settings.ai.soul ?? '').length} 字，尚未整理）——可在「管理事实库」里用 AI 拆解为事实条目。
          </span>
        )}
      </div>

      {/* 工具调用上限（chat agent loop 预算） */}
      <div className="settings-subsection-title">工具调用</div>
      <div className="form-group">
        <label className="form-label">最大循环轮数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.toolOptions?.maxIterations ?? 12}
          onChange={e => { updateAIConfig({
            toolOptions: {
              ...settings.ai.toolOptions,
              maxIterations: clampNumber(parseInt(e.target.value), 1, 30, 12),
            },
          }); markDirty('ai.toolOptions.maxIterations'); }}
          min="1" max="30" step="1"
        />
        <span className="form-hint">单次对话最多几轮「模型请求 + 工具执行」（默认 12，范围 1~30）</span>
      </div>
      <div className="form-group">
        <label className="form-label">最大工具调用次数</label>
        <input
          type="number"
          className="form-input glass"
          value={settings.ai.toolOptions?.maxToolCalls ?? 20}
          onChange={e => { updateAIConfig({
            toolOptions: {
              ...settings.ai.toolOptions,
              maxToolCalls: clampNumber(parseInt(e.target.value), 1, 100, 20),
            },
          }); markDirty('ai.toolOptions.maxToolCalls'); }}
          min="1" max="100" step="1"
        />
        <span className="form-hint">单次对话累计的工具调用总预算（默认 20，范围 1~100）</span>
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
          <span>启用素材收件箱</span>
        </label>
        <span className="form-hint">
          AI 会把对话中值得留存的素材暂存到收件箱（全本地存储、不上传）。开启后对话中也会参考收件箱内容；
          素材可在「Soul 事实档案 → 管理事实库 → 从收件箱提炼」里升级为正式事实。
        </span>
        <button
          className="settings-link-btn"
          type="button"
          onClick={() => setShowMemoryManager(true)}
        >
          管理收件箱（{memoryCount} 条）
        </button>
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

      {/* v2.11.0: 长期记忆管理面板（素材收件箱） */}
      {showMemoryManager && (
        <MemoryManagerPanel
          onClose={() => { setShowMemoryManager(false); setMemoryCount(listMemories().length); }}
          onChanged={() => setMemoryCount(listMemories().length)}
        />
      )}

      {/* v3.4.0: Soul 事实库管理面板 */}
      {showSoulManager && (
        <SoulManagerPanel
          onClose={() => { setShowSoulManager(false); setSoulFactCount(countActiveSoulFacts()); }}
          onFactsChanged={() => setSoulFactCount(countActiveSoulFacts())}
        />
      )}
    </div>
  );
}