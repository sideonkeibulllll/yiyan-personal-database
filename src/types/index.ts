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
  /** 图片附件列表（查询时联表填充，不影响文本属性） */
  attachments?: Attachment[];
}

/** 图片附件展示模式 */
export type AttachmentDisplayMode = 'inline' | 'badge';

/** 图片附件 */
export interface Attachment {
  id: string;
  entryId: string;
  /** 原图相对路径（相对于 Filesystem 根目录） */
  filePath: string;
  /** 缩略图相对路径 */
  thumbPath: string;
  /** MIME 类型，如 image/jpeg */
  mimeType: string;
  /** 排序序号（小在前） */
  sortOrder: number;
  /** 创建时间戳 */
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
  /** 标签颜色（hex 或 CSS 颜色名） */
  color?: string;
  /** 智能标签：保存的搜索条件 */
  isSmart?: boolean;
  /** 智能标签的搜索条件 */
  searchCriteria?: {
    keyword?: string;
    tagIds?: string[];
    isStarred?: boolean;
  };
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

export interface RandomConfig {
  /** 每屏随机卡片数 */
  cardsPerPage: number;
  /** 图片附件展示模式：inline=原图直接展示，badge=仅显示附件标识 */
  attachmentDisplayMode: AttachmentDisplayMode;
}

// ==================== 待办相关类型 ====================

/** 待办状态 */
export type TodoStatus = 'pending' | 'done';

/** 待办搜索时间筛选 */
export type TodoSearchTimeFilter = 'future' | 'expired' | 'expiredOverMonth' | 'all';

/** 待办项 */
export interface Todo {
  id: string;
  title: string;
  note?: string;
  status: TodoStatus;
  startTime?: number;
  endTime?: number;
  /** 今日处理（代替星标） */
  isToday: boolean;
  /** 标签 ID 列表 */
  tagIds?: string[];
  /** 标签对象列表（查询时联表填充） */
  tags?: TodoTag[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 软删除时间（回收站） */
  deletedAt?: number;
  /** 日期文件夹（YYYY-MM-DD） */
  folderDate: string;
}

/** 待办标签（独立标签池） */
export interface TodoTag {
  id: string;
  name: string;
  /** 标签颜色（hex 或 CSS 颜色名） */
  color?: string;
  createdAt: number;
}

/** 待办模板 */
export interface TodoTemplate {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** 模板中的待办项 */
export interface TodoTemplateItem {
  id: string;
  templateId: string;
  title: string;
  note?: string;
  /** 相对开始时间（分钟偏移，0 = 模板应用的当天 0 点） */
  startTime?: number;
  /** 相对结束时间（分钟偏移） */
  endTime?: number;
  isToday: boolean;
  /** 标签 ID 列表（JSON 字符串） */
  tagIds?: string;
  sortOrder: number;
}

/** 倒计时显示格式 */
export type CountdownFormat = 'full' | 'compact' | 'daysOnly';

/** 倒计时显示位置 */
export type CountdownPosition = 'aboveBottomNav' | 'pageTop' | 'floating';

/** 待办配置 */
export interface TodoConfig {
  /** 是否显示倒计时条 */
  showCountdown: boolean;
  /** 倒计时格式 */
  countdownFormat: CountdownFormat;
  /** 倒计时位置 */
  countdownPosition: CountdownPosition;
  /** 删除前确认 */
  confirmDelete: boolean;
  /** 回收站自动清理天数 */
  recycleBinRetentionDays: number;
}

/** 待办默认配置 */
export const DEFAULT_TODO_CONFIG: TodoConfig = {
  showCountdown: true,
  countdownFormat: 'full',
  countdownPosition: 'aboveBottomNav',
  confirmDelete: true,
  recycleBinRetentionDays: 30,
};

export interface Settings {
  ai: AIConfig;
  context: ContextConfig;
  push: PushConfig;
  random: RandomConfig;
  /** 待办配置 */
  todo: TodoConfig;
}

export interface AIConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  isDeepSeek: boolean;
  deepSeekOptions: DeepSeekOptions;
  prompts: PromptConfig;
  /** 智能标签功能配置 */
  smartTag?: SmartTagOptions;
}

export interface DeepSeekOptions {
  temperature: number;
  maxTokens: number;
}

/**
 * 智能标签功能配置
 */
export interface SmartTagOptions {
  /** 用于标签建议的最近标签数量 */
  recentTagCount: number;
  /** 标签建议专用提示词（独立于 prompts.tagSuggestion）*/
  tagSuggestPrompt: string;
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
    smartTag: {
      recentTagCount: 50,
      tagSuggestPrompt: `你是一个标签建议助手。请分析以下文本内容，结合用户最近使用过的标签，推荐 3-5 个合适的标签。

要求：
1. 标签简洁，2-6 个字
2. 优先复用最近使用过的标签
3. 从内容主题、情感、用途三个维度考虑
4. 避免过于宽泛的标签（如"其他"）
5. 只返回标签列表，每行一个，不要解释

用户最近使用过的标签：
{recentTags}

当前条目内容：
{content}`,
    },
  },
  context: {
    recentWindow: 20,
    enableLongTermMemory: false,
  },
  push: {
    enabled: false,
    similarityThreshold: 0.7,
  },
  random: {
    cardsPerPage: 7,
    attachmentDisplayMode: 'inline',
  },
  todo: DEFAULT_TODO_CONFIG,
};
