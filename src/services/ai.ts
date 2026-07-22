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
