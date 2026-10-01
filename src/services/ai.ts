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
    const active = this.getActiveProvider();
    if (!active.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    // e.4: 智能模型切换
    let model: string;
    let baseURL: string;
    let apiKey: string;

    if (options.isChat) {
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
