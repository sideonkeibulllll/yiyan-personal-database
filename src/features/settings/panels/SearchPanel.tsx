/**
 * 设置面板 - 联网搜索（v3.7.0）
 *
 * 从「AI 配置」里拆出来的独立子项（原来混在模型配置下面，改引擎要滚半天）：
 * 只放 `web_search` / `web_fetch` 两个 MCP 工具相关的东西 —— 用哪个引擎、秘塔 Key。
 *
 * 设计约定（v3.6.7 起）：**固定用一个引擎，不做自动降级**。所以这里没有「自动」选项，
 * 选谁就是谁；引擎失败会把上游原因直接返给 AI，用户一眼能看出是哪边的问题。
 */
import { useSettingsStore } from '@/stores/settingsStore';
import type { WebSearchEngineId } from '@/types';

interface SearchPanelProps {
  markDirty: (field: string) => void;
}

/** 两个引擎的说明（避免用户只看到名字不知道怎么选） */
const ENGINE_HINTS: Record<WebSearchEngineId, string> = {
  metaso: '中文检索质量好，每次搜索扣 3 credits（有免费额度）；官方要求绑 IP 白名单，换网络可能被拒。',
  deepseek: 'DeepSeek 自研搜索，结果带权威度与相关度评分；约 0.5 分 / 次（5 元 / 千次成功请求）。',
};

export function SearchPanel({ markDirty }: SearchPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);

  const engine: WebSearchEngineId = settings.ai.webSearch?.engine ?? 'metaso';
  const metasoKey = settings.ai.webSearch?.metasoKey ?? '';
  const deepseekKey = (settings.ai.providers?.deepseek?.apiKey ?? '').trim();
  const keyReady = engine === 'metaso' ? metasoKey.trim().length > 0 : deepseekKey.length > 0;

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">联网搜索</h2>

      <div className="form-group">
        <span className="form-hint">
          给对话里的两个工具用：<code>web_search</code>（搜索网页）、<code>web_fetch</code>（读网页正文）。
          需要在对话的 MCP 面板里勾上「联网搜索」这一组才会生效。
        </span>
      </div>

      <div className="form-group">
        <label className="form-label">搜索引擎</label>
        <select
          className="form-input glass"
          value={engine}
          onChange={e => {
            updateAIConfig({
              webSearch: {
                ...settings.ai.webSearch,
                engine: e.target.value as WebSearchEngineId,
              },
            });
            markDirty('ai.webSearch.engine');
          }}
        >
          <option value="metaso">秘塔 AI 搜索（每次 3 credits）</option>
          <option value="deepseek">DeepSeek 官方搜索（约 0.5 分 / 次）</option>
        </select>
        <span className="form-hint">{ENGINE_HINTS[engine]}</span>
        <span className="form-hint">
          固定用你选的这一个，失败不会自动换别家（避免「以为在用免费的，其实在花付费的」）。
        </span>
      </div>

      <div className="settings-subsection-title">秘塔</div>
      <div className="form-group">
        <label className="form-label">API Key</label>
        <input
          type="password"
          className="form-input glass"
          value={metasoKey}
          onChange={e => {
            updateAIConfig({
              webSearch: {
                ...settings.ai.webSearch,
                engine: settings.ai.webSearch?.engine ?? 'metaso',
                metasoKey: e.target.value,
              },
            });
            markDirty('ai.webSearch.metasoKey');
          }}
          placeholder="mk-..."
          spellCheck={false}
        />
        <span className="form-hint">
          在 metaso.cn 的 API 页面申请。搜索接口要绑 IP 白名单：家里宽带最稳，出门切流量时把上面的引擎换成 DeepSeek。
        </span>
      </div>

      <div className="settings-subsection-title">DeepSeek</div>
      <div className="form-group">
        <span className="form-hint">
          {deepseekKey.length > 0
            ? 'DeepSeek Key 已配置（与聊天共用一个，在「AI 配置 → DeepSeek 官方」里改）。'
            : '还没有 DeepSeek Key —— 到「AI 配置 → DeepSeek 官方」填一把，才能选它当搜索引擎。'}
        </span>
        <span className="form-hint">
          {keyReady
            ? `当前引擎（${engine === 'metaso' ? '秘塔' : 'DeepSeek'}）的 Key 已就绪。`
            : `当前引擎（${engine === 'metaso' ? '秘塔' : 'DeepSeek'}）还缺 Key，此时调用工具会直接报错并提示去哪里填。`}
        </span>
      </div>
    </div>
  );
}
