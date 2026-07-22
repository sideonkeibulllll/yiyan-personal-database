/**
 * AI 服务
 * 负责与 OpenAI 兼容 API 通信
 */
import type { AIConfig, PromptConfig } from '@/types';

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
   * 发送聊天请求
   */
  async chat(options: {
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    const isDeepSeek = this.config.isDeepSeek;
    const model = this.config.model || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini');

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

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
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
   */
  async suggestTagsWithRecent(
    content: string,
    recentTags: string[],
    customPrompt?: string,
  ): Promise<string[]> {
    if (!this.config?.apiKey) {
      throw new Error('AI API Key 未配置');
    }

    const promptTemplate = customPrompt || this.config.smartTag?.tagSuggestPrompt ||
      `你是一个标签建议助手。请分析以下文本内容，结合用户最近使用过的标签，推荐 3-5 个合适的标签。\n\n要求：\n1. 标签简洁，2-6 个字\n2. 优先复用最近使用过的标签\n3. 从内容主题、情感、用途三个维度考虑\n4. 避免过于宽泛的标签（如"其他"）\n5. 只返回标签列表，每行一个，不要解释\n\n用户最近使用过的标签：\n{recentTags}\n\n当前条目内容：\n{content}`;

    const prompt = promptTemplate
      .replace('{recentTags}', recentTags.join(', '))
      .replace('{content}', content);

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
}

export const ai = new AIService();
export default ai;
