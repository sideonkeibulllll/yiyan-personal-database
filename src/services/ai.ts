/**
 * AI 服务 v2
 * 负责与 OpenAI 兼容 API 通信
 * v2 变更：
 * - e.1: 添加 suggestGroups 方法
 * - b.4: 添加 suggestConnections 方法
 * - e.4: 支持 GLM 模型智能切换
 * - e.2: chatSoul 系统提示注入
 */
import type { AIConfig, PromptConfig, GLMConfig } from '@/types';

class AIService {
  private config: AIConfig | null = null;

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
   * e.4: 获取智能切换的模型配置
   * 非 chat 场景下，如果 GLM 启用，智能切换到 GLM 模型
   */
  getSmartModel(): { model: string; baseURL: string; apiKey: string } {
    if (!this.config) {
      return { model: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com', apiKey: '' };
    }

    // e.4: 如果 GLM 启用，非 chat 场景智能切换
    if (this.config.glm?.enabled && this.config.glm.apiKey) {
      return {
        model: this.config.glm.model || 'glm-4-flash',
        baseURL: this.config.glm.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: this.config.glm.apiKey,
      };
    }

    return {
      model: this.config.model || 'deepseek-v4-flash',
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
    };
  }

  /**
   * 发送聊天请求
   * e.4: 支持智能模型切换（非 chat 场景）
   */
  async chat(options: {
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
    /** 是否为 chat 场景（false 时启用 GLM 智能切换） */
    isChat?: boolean;
  }): Promise<string> {
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    // e.4: 智能模型切换
    let model: string;
    let baseURL: string;
    let apiKey: string;

    if (options.isChat) {
      // chat 场景用主配置
      model = this.config.model || 'deepseek-v4-flash';
      baseURL = this.config.baseURL;
      apiKey = this.config.apiKey;
    } else {
      // 非 chat 场景智能切换
      const smart = this.getSmartModel();
      model = smart.model;
      baseURL = smart.baseURL;
      apiKey = smart.apiKey;
    }

    const isDeepSeek = this.config.isDeepSeek;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userMessage },
      ],
      temperature: options.temperature ?? (isDeepSeek ? 0.7 : 0.7),
      max_tokens: options.maxTokens ?? (isDeepSeek ? 2000 : 2000),
    };

    // DeepSeek 专属选项
    if (isDeepSeek && this.config.deepSeekOptions) {
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
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    const maxTags = this.config.smartTag?.maxTags ?? 6;
    const minTags = this.config.smartTag?.minTags ?? 1;

    const promptTemplate = customPrompt || this.config.smartTag?.tagSuggestPrompt ||
      `你是一个标签建议助手。请分析以下文本内容，结合用户最近使用过的标签，推荐 ${minTags}-${maxTags} 个合适的标签。

要求：
1. 标签简洁，2-6 个字
2. 优先复用最近使用过的标签
3. 从内容主题、情感、用途三个维度考虑
4. 避免过于宽泛的标签（如"其他"）
5. 只返回标签列表，每行一个，不要解释

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
      systemPrompt: '你是一个标签建议助手，只返回标签列表。',
      userMessage: prompt,
    });

    return result
      .split('\n')
      .map(tag => tag.trim().replace(/^[-*\d.]+\s*/, ''))
      .filter(tag => tag.length > 0 && tag.length <= 12)
      .slice(0, maxTags);
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
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    const promptTemplate = this.config.smartGroup?.groupSuggestPrompt ||
      this.config.prompts.groupSuggestion ||
      `你是一个分组建议助手。请分析以下条目内容，推荐 1-3 个合适的分组。

要求：
1. 分组名简洁，2-8 个字
2. 优先复用已有的分组
3. 从内容主题、用途、领域三个维度考虑
4. 只返回分组列表，每行一个，不要解释

已有分组：
{existingGroups}

条目内容：
{content}`;

    const prompt = promptTemplate
      .replace(/\{existingGroups\}/g, existingGroups.join(', '))
      .replace(/\{content\}/g, content)
      .replace(/\{recentEntries\}/g, recentEntries?.join('\n') || '');

    const result = await this.chat({
      systemPrompt: '你是一个分组建议助手，只返回分组列表。',
      userMessage: prompt,
    });

    return result
      .split('\n')
      .map(group => group.trim().replace(/^[-*\d.]+\s*/, ''))
      .filter(group => group.length > 0 && group.length <= 16)
      .slice(0, 3);
  }

  /**
   * b.4: 连线建议
   */
  async suggestConnections(
    entries: { id: string; content: string }[],
  ): Promise<{ sourceId: string; targetId: string; description: string }[]> {
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    const promptTemplate = this.config.connectionSuggestion?.connectionSuggestPrompt ||
      this.config.prompts.connectionSuggestion ||
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
