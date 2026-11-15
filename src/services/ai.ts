/**
 * AI 服务 v2
 * 负责与 OpenAI 兼容 API 通信
 * v2 变更：
 * - e.1: 添加 suggestGroups 方法
 * - b.4: 添加 suggestConnections 方法
 * - e.4: 支持 GLM 模型智能切换
 * - e.2: chatSoul 系统提示注入
 */
import type { AIConfig, PromptConfig, GLMConfig, AIProviderId } from '@/types';
import { GLM_FREE_MODEL_POOL } from '@/types';
import { parseCredential, serializeCredential, traeChat } from '@/services/aiProviders/trae';

/**
 * 凭据轮换回调。
 *
 * TRAE 的 refresh_token 每次续期都会轮换，刷完必须写回设置，
 * 否则下次启动就是一把废钥匙。这里用模块级钩子避免 ai.ts 反向依赖
 * settings store（由 App 初始化时注册一次）。
 */
export type AICredentialUpdateHandler = (providerId: AIProviderId, apiKey: string) => void;

let credentialUpdateHandler: AICredentialUpdateHandler | null = null;

/** 注册凭据回写钩子（App 启动时调用一次）。 */
export function setAICredentialUpdateHandler(handler: AICredentialUpdateHandler | null): void {
  credentialUpdateHandler = handler;
}

/**
 * 把轮换后的 TRAE 凭据交给回写钩子。
 * 流式路径在 chatStream 里直接调用本函数，避免重复实现一遍钩子查找。
 */
export function notifyTraeCredentialRotated(credentialJson: string): void {
  credentialUpdateHandler?.('trae', credentialJson);
}

/** 解析后的生效请求参数 */
interface ResolvedEndpoint {
  model: string;
  baseURL: string;
  apiKey: string;
}

class AIService {
  private config: AIConfig | null = null;

  /** GLM 免费池轮询游标（进程内，跨调用递增） */
  private glmPoolCursor = 0;

  /**
   * 设置 AI 配置
   */
  setConfig(config: AIConfig): void {
    this.config = config;
  }

  /**
   * 获取当前配置
   */
  getConfig(): AIConfig | null {
    return this.config;
  }

  /**
   * 取当前激活的付费提供商配置。
   *
   * 优先读 providers[provider]，缺失时回落到旧扁平字段（apiKey/baseURL/model），
   * 保证未迁移的老配置也能工作。
   */
  getActiveProvider(): ResolvedEndpoint {
    const cfg = this.config;
    if (!cfg) {
      return { model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com', apiKey: '' };
    }

    const providerId: AIProviderId = cfg.provider || (cfg.isDeepSeek ? 'deepseek' : 'deepseek');
    const entry = cfg.providers?.[providerId];

    return {
      model: entry?.model || cfg.model || 'deepseek-v4-flash',
      baseURL: entry?.baseURL || cfg.baseURL || 'https://api.deepseek.com',
      apiKey: entry?.apiKey || cfg.apiKey || '',
    };
  }

  /**
   * 从 GLM 免费模型池按轮询取下一个模型。
   * 池中每个模型轮转使用，分摊免费配额。
   */
  private nextGlmModel(): string {
    const pool = GLM_FREE_MODEL_POOL;
    const model = pool[this.glmPoolCursor % pool.length];
    this.glmPoolCursor = (this.glmPoolCursor + 1) % pool.length;
    return model;
  }

  /**
   * e.4 / v2.5.0: 获取非 chat 场景使用的配置。
   *
   * GLM 启用且配了 Key 时，改用 GLM 免费模型池（自动轮询），
   * 否则回落到当前激活的付费提供商。
   */
  getSmartModel(): ResolvedEndpoint {
    const cfg = this.config;
    if (!cfg) {
      return { model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com', apiKey: '' };
    }

    if (cfg.glm?.enabled && cfg.glm.apiKey) {
      return {
        model: this.nextGlmModel(),
        baseURL: cfg.glm.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: cfg.glm.apiKey,
      };
    }

    return this.getActiveProvider();
  }

  /**
   * 走 TRAE 通道（内部仍读 SSE，对外表现为非流式一次性返回）。
   *
   * 返回 `null` 表示本轮不可用（额度耗尽 / 网络失败），调用方应当回落到
   * GLM 免费池；凭据格式错误则直接抛异常，因为那是需要用户动手修的配置问题。
   */
  private async chatViaTrae(
    options: { systemPrompt: string; userMessage: string; temperature?: number; maxTokens?: number },
    model: string,
  ): Promise<string | null> {
    const raw = this.config?.providers?.trae?.apiKey ?? '';
    const credential = parseCredential(raw);
    if (credential === null) {
      throw new Error(
        'TRAE 凭据格式不正确：需要包含 access_token / refresh_token / machine_id / device_id 的 JSON',
      );
    }

    const body: Record<string, unknown> = {
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userMessage },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2000,
    };

    try {
      return await traeChat({
        credential,
        model,
        body,
        onCredentialRotated: (next) => {
          credentialUpdateHandler?.('trae', serializeCredential(next));
        },
      });
    } catch (error) {
      console.warn('[ai] TRAE 调用失败，回落到 GLM 免费池：', error);
      return null;
    }
  }

  /**
   * 发送聊天请求
   * e.4: 支持智能模型切换（非 chat 场景）
   * v2.5.0: 支持多提供商（provider）解析
   */
  async chat(options: {
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
    /** 是否为 chat 场景（false 时启用 GLM 智能切换） */
    isChat?: boolean;
  }): Promise<string> {
    // TRAE 走独立协议（非 OpenAI 兼容）。成功就直接返回；失败则记一条警告，
    // 继续往下走 GLM 免费池 / 付费提供商，保证功能不会因为额度用尽而断掉。
    //
    // 省积分策略：标签建议 / 关系建议 / 自动连线这类非 chat 的高频小任务，
    // 只要 GLM 免费池可用就走 GLM，把积分留给真正的对话；
    // 没配 GLM 时非 chat 也只能走 TRAE，否则这些功能会直接失败。
    /** TRAE 不可用而 GLM 可兜底时置真，强制本轮走免费池而不是回到 TRAE 的端点 */
    let forceSmart = false;

    if (this.config?.provider === 'trae') {
      const entry = this.config.providers?.trae;
      const raw = entry?.apiKey ?? '';
      if (raw.trim().length === 0) {
        throw new Error('TRAE 凭据未配置：请在 设置 → AI 中粘贴 TRAE 凭据 JSON');
      }
      const glmAvailable = Boolean(this.config.glm?.enabled && this.config.glm.apiKey);
      const preferTrae = options.isChat === true || !glmAvailable;
      if (preferTrae) {
        const viaTrae = await this.chatViaTrae(options, entry?.model || 'DeepSeek-V4-Pro');
        if (viaTrae !== null) return viaTrae;
        // TRAE 失败：有 GLM 就用 GLM 收尾，绝不能用 OpenAI 协议去打 TRAE 的端点
        if (glmAvailable) forceSmart = true;
      }
    }

    const active = this.getActiveProvider();
    if (!active.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    // e.4: 智能模型切换
    let model: string;
    let baseURL: string;
    let apiKey: string;

    if (options.isChat && !forceSmart) {
      // chat 场景用当前激活的付费提供商
      model = active.model;
      baseURL = active.baseURL;
      apiKey = active.apiKey;
    } else {
      // 非 chat 场景智能切换（GLM 免费池优先）
      const smart = this.getSmartModel();
      model = smart.model;
      baseURL = smart.baseURL;
      apiKey = smart.apiKey;
    }

    // DeepSeek 专属参数仅在「DeepSeek 官方提供商」下生效
    const isDeepSeek = (this.config?.provider
      ? this.config.provider === 'deepseek'
      : this.config?.isDeepSeek) === true;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userMessage },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2000,
    };

    // DeepSeek 专属选项
    if (isDeepSeek && this.config?.deepSeekOptions) {
      if (this.config.deepSeekOptions.temperature !== undefined) {
        body.temperature = this.config.deepSeekOptions.temperature;
      }
      if (this.config.deepSeekOptions.maxTokens !== undefined) {
        body.max_tokens = this.config.deepSeekOptions.maxTokens;
      }
    }

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error?.message || `AI 请求失败: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * 标签建议
   */
  async suggestTags(content: string, context: string, prompts: PromptConfig): Promise<string[]> {
    const prompt = prompts.tagSuggestion
      .replace('{content}', content)
      .replace('{context}', context);

    const result = await this.chat({
      systemPrompt: '你是一个标签建议助手，只返回标签列表。',
      userMessage: prompt,
    });

    return result
      .split('\n')
      .map(tag => tag.trim().replace(/^[-*\d.]+\s*/, ''))
      .filter(tag => tag.length > 0 && tag.length <= 12)
      .slice(0, 5);
  }

  /**
   * 标签建议（带最近使用标签）
   * b.1: 改为 1-6 个
   */
  async suggestTagsWithRecent(
    content: string,
    recentTags: string[],
    customPrompt?: string,
  ): Promise<string[]> {
    if (!this.getActiveProvider().apiKey && !this.config?.glm?.apiKey) {
      throw new Error('AI API Key 未配置');
    }
    const config = this.config!;

    const maxTags = config.smartTag?.maxTags ?? 6;
    const minTags = config.smartTag?.minTags ?? 1;

    const promptTemplate = customPrompt || config.smartTag?.tagSuggestPrompt ||
      `你是一个标签建议助手。请分析以下文本内容，从用户最近使用过的标签中选出 ${minTags}-${maxTags} 个最合适的标签。

重要规则：
1. 只能从「用户最近使用过的标签」列表中选择，不要创建新标签
2. 如果已有标签中没有合适的，返回 "无合适标签"
3. 从内容主题、情感、用途三个维度选择最匹配的已有标签

用户最近使用过的标签：
{recentTags}

当前条目内容：
{content}`;

    const prompt = promptTemplate
      .replace(/\{recentTags\}/g, recentTags.join(', '))
      .replace(/\{content\}/g, content)
      .replace(/\{minTags\}/g, String(minTags))
      .replace(/\{maxTags\}/g, String(maxTags));

    const result = await this.chat({
      systemPrompt: '你是一个标签建议助手，只返回标签列表。只能从已有标签中选择。',
      userMessage: prompt,
    });

    const parsed = result
      .split('\n')
      .map(tag => tag.trim().replace(/^[-*\d.]+\s*/, ''))
      .filter(tag => tag.length > 0 && tag.length <= 12);

    // b.8: 只保留与已有标签完全匹配的建议
    const existingSet = new Set(recentTags);
    const matched = parsed.filter(t => existingSet.has(t));

    // 如果没有匹配到任何已有标签，返回空数组
    return matched.length > 0 ? matched.slice(0, maxTags) : [];
  }

  /**
   * 关联建议
   */
  async suggestRelation(contentA: string, contentB: string, prompts: PromptConfig): Promise<string> {
    const prompt = prompts.relationSuggestion
      .replace('{contentA}', contentA)
      .replace('{contentB}', contentB);

    return this.chat({
      systemPrompt: '你是一个知识关联分析助手。',
      userMessage: prompt,
    });
  }

  /**
   * e.1: 组建议
   */
  async suggestGroups(
    content: string,
    existingGroups: string[],
    recentEntries?: string[],
  ): Promise<string[]> {
    if (!this.getActiveProvider().apiKey && !this.config?.glm?.apiKey) {
      throw new Error('AI API Key 未配置');
    }
    const config = this.config!;

    const promptTemplate = config.smartGroup?.groupSuggestPrompt ||
      config.prompts.groupSuggestion ||
      `你是一个分组建议助手。请分析以下条目内容，从已有的分组中选出 1-3 个合适的分组。

重要规则：
1. 只能从「已有分组」列表中选择，不要创建新分组
2. 如果已有分组中没有合适的，返回 "无合适分组"
3. 从内容主题、用途、领域三个维度选择最匹配的已有分组

已有分组：
{existingGroups}

条目内容：
{content}`;

    const prompt = promptTemplate
      .replace(/\{existingGroups\}/g, existingGroups.join(', '))
      .replace(/\{content\}/g, content)
      .replace(/\{recentEntries\}/g, recentEntries?.join('\n') || '');

    const result = await this.chat({
      systemPrompt: '你是一个分组建议助手，只返回分组列表。只能从已有分组中选择。',
      userMessage: prompt,
    });

    const parsed = result
      .split('\n')
      .map(group => group.trim().replace(/^[-*\d.]+\s*/, ''))
      .filter(group => group.length > 0 && group.length <= 16);

    // b.8: 只保留与已有分组完全匹配的建议
    const existingSet = new Set(existingGroups);
    const matched = parsed.filter(g => existingSet.has(g));

    // 如果没有匹配到任何已有分组，返回空数组而不是创建新分组
    return matched.length > 0 ? matched.slice(0, 3) : [];
  }

  /**
   * b.4: 连线建议
   */
  async suggestConnections(
    entries: { id: string; content: string }[],
  ): Promise<{ sourceId: string; targetId: string; description: string }[]> {
    if (!this.getActiveProvider().apiKey && !this.config?.glm?.apiKey) {
      throw new Error('AI API Key 未配置');
    }
    const config = this.config!;

    const promptTemplate = config.connectionSuggestion?.connectionSuggestPrompt ||
      config.prompts.connectionSuggestion ||
      `你是一个知识关联发现助手。请分析以下条目，找出可能有关联的条目对。

要求：
1. 找出 3-5 组有关联的条目对
2. 用一句话描述每对条目的关联
3. 返回格式：ID1 → ID2: 关联描述

最近条目列表：
{entries}`;

    const entriesText = entries.map(e => `[${e.id}] ${e.content.slice(0, 100)}`).join('\n');
    const prompt = promptTemplate.replace(/\{entries\}/g, entriesText);

    const result = await this.chat({
      systemPrompt: '你是一个知识关联发现助手。',
      userMessage: prompt,
    });

    // 解析返回结果
    const suggestions: { sourceId: string; targetId: string; description: string }[] = [];
    const lines = result.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/\[?([^\]]+)\]?\s*[→>\-]\s*\[?([^\]:]+)\]?\s*:?\s*(.*)/);
      if (match) {
        const [, id1, id2, desc] = match;
        suggestions.push({
          sourceId: id1.trim(),
          targetId: id2.trim(),
          description: (desc || '').trim(),
        });
      }
    }

    return suggestions;
  }
}

export const ai = new AIService();
export default ai;
