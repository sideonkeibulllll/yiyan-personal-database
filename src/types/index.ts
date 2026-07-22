/**
 * 类型定义
 */

export interface Entry {
  id: string;
  content: string;
  source?: string;
  groupId?: string;
  supplement?: string;
  isStarred: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  copyCount: number;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export interface Group {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  description?: string;
  createdAt: number;
}

export interface Settings {
  ai: AIConfig;
  context: ContextConfig;
  push: PushConfig;
}

export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  isDeepSeek: boolean;
  deepSeekOptions: DeepSeekOptions;
  prompts: PromptConfig;
}

export interface DeepSeekOptions {
  temperature: number;
  maxTokens: number;
}

export interface PromptConfig {
  tagSuggestion: string;
  relationSuggestion: string;
  dialogueContext: string;
  autoLink: string;
}

export interface ContextConfig {
  recentWindow: number;
  tagContext?: string;
  enableLongTermMemory: boolean;
}

export interface PushConfig {
  enabled: boolean;
  similarityThreshold: number;
}

export const DEFAULT_PROMPTS: PromptConfig = {
  tagSuggestion: `你是一个标签建议助手。请分析以下文本内容，推荐 3-5 个合适的标签。
要求：
1. 标签简洁，2-6 个字
2. 从内容主题、情感、用途三个维度考虑
3. 避免过于宽泛的标签（如"其他"）
4. 只返回标签列表，每行一个，不要解释

上下文（最近录入的内容）：
{context}

当前条目内容：
{content}`,

  relationSuggestion: `你是一个知识关联助手。请分析以下两条内容的关系。
请用一句话描述它们之间的关联性（如"反驳了"、"扩展了"、"举例了"、"同一主题不同角度"等）。
如果认为没有明显关联，请说"无明显关联"。

条目A：{contentA}

条目B：{contentB}`,

  dialogueContext: `你是一个个人知识管理助手。用户正在围绕一条笔记展开对话。
请基于以下上下文提供帮助：

【长效记忆】
{longTermMemory}

【近期关注】
{recentEntries}

【当前条目】
{currentEntry}

请记住：
1. 你的角色是辅助思考，不是代替思考
2. 回答简洁有洞察
3. 可以主动指出与其他条目的潜在关联
4. 语气友好自然`,

  autoLink: `请分析新录入的内容是否与数据库中已有的条目高度相关。
如果相关，请列出最相关的 3 条，并简要说明关联原因。
如果不相关，返回"未发现明显关联"。

新条目：{newEntry}

候选条目（最近 50 条）：
{candidates}`,
};

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    apiKey: '',
    model: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com',
    isDeepSeek: true,
    deepSeekOptions: {
      temperature: 0.7,
      maxTokens: 2000,
    },
    prompts: DEFAULT_PROMPTS,
  },
  context: {
    recentWindow: 20,
    enableLongTermMemory: false,
  },
  push: {
    enabled: false,
    similarityThreshold: 0.7,
  },
};
