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
    hasAttachment?: boolean;
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
  /** 长文本折叠阈值（字数），超过则折叠并显示「展开」按钮；0 表示不折叠 */
  contentCollapseLength: number;
}

/**
 * 「记忆来信」配置（v2.12.0，主动触达模块）
 *
 * ⚠️ 归属声明：本配置属于「通知体验」模块（见 services/notifyService.ts，
 * 该文件是唯一消费门面）。写入只允许走 settingsStore.updateNotifyConfig，
 * 读取渲染由 NotifyPanel 负责；任何其他位置引用本配置前先读 notifyService
 * 顶部的「对外契约」注释，避免散落式引用。
 *
 * 未来扩展方向（AI 写信人格、时间胶囊、待办提醒开关等）：向此结构**追加可选字段**，
 * 由 DEFAULT_SETTINGS / settingsStore 的 sanitizeNotify 兜底，保证旧配置向后兼容。
 */
export interface NotifySettings {
  /** 总开关（默认关；开启时才申请系统通知权限） */
  enabled: boolean;
  /** 投递窗口 · 起始小时（0-23，含） */
  windowStart: number;
  /** 投递窗口 · 结束小时（1-24，不含，22 表示「22:00 前」） */
  windowEnd: number;
  /** 每天投递条数（1-3） */
  dailyCount: number;
  /**
   * 来信候选筛选（v2.14.0）：限定「哪些卡可以被选为来信」。
   * 与随机页筛选同语义（标签 / 时间 / 星标），不填 = 全部卡片。
   * ⚠️ 与随机页的筛选**各自独立**（随机页存 localStorage，这里进设置/云备份）。
   * 结构见 utils/entryFilterState.ts 的 EntryFilterState（此处内联，保持本文件零依赖）。
   */
  filter?: {
    /** 选中的标签 id（空 = 不限标签） */
    tagIds: string[];
    /** 星标状态：undefined=全部 / true=仅星标 / false=仅未星标 */
    starred?: boolean;
    /** 时间范围（按修改时间；无 preset = 不限） */
    timeRange: { preset?: '1d' | '3d' | '7d' | 'custom'; from?: string; to?: string };
  };
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
  /** c: 图片附件列表（待办附件，删除待办时不保留） */
  attachments?: TodoAttachment[];
}

/** c: 待办图片附件 */
export interface TodoAttachment {
  id: string;
  todoId: string;
  /** 原图相对路径 */
  filePath: string;
  /** 缩略图相对路径 */
  thumbPath: string;
  /** MIME 类型 */
  mimeType: string;
  /** 排序序号 */
  sortOrder: number;
  /** 创建时间戳 */
  createdAt: number;
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

/**
 * Cloudflare 中转站配置（v2.7.0）
 *
 * 密钥不再打包进安装包：token 由用户在设置页手填，存在这里（settings → localStorage）。
 * 其余字段留空时回退到 config/cloudflare.ts 的默认值。
 */
export interface CloudConfig {
  /** 中转站地址（留空用默认） */
  url?: string;
  /** 中转站密钥 —— 唯一必填项 */
  token?: string;
  /** D1 逻辑库名（默认 memory） */
  db?: string;
  /** R2 逻辑桶名（默认 memory） */
  bucket?: string;
  /** R2 附件公开域名（留空用默认） */
  publicDomain?: string;
}

export interface Settings {
  ai: AIConfig;
  context: ContextConfig;
  push: PushConfig;
  random: RandomConfig;
  /** 待办配置 */
  todo: TodoConfig;
  /** 记忆来信（主动触达，v2.12.0） */
  notify: NotifySettings;
  /** Cloudflare 中转站配置（密钥手填） */
  cloud?: CloudConfig;
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
  /** 智能组建议配置 */
  smartGroup?: SmartGroupOptions;
  /** 连线建议配置 */
  connectionSuggestion?: ConnectionSuggestionOptions;
  /** GLM 模型配置（免费模型池，非 chat 场景自动轮询） */
  glm?: GLMConfig;
  /** Chat Soul 提示词（对话系统提示词） */
  chatSoul?: string;
  /** 数据选择器「最近」勾选项数量 */
  recentPickerCount?: number;
  /** 当前激活的付费提供商（v2.5.0 新增，缺省按 isDeepSeek 推导） */
  provider?: AIProviderId;
  /** 各付费提供商的独立配置（v2.5.0 新增，互不影响） */
  providers?: AIProvidersConfig;
}

/** 付费 AI 提供商 ID */
export type AIProviderId = 'deepseek' | 'siliconflow';

/** 单个提供商的独立配置 */
export interface ProviderEntry {
  /** 该提供商的 API Key（各自独立保存，切换时无需重填） */
  apiKey: string;
  /** API Base URL（不含结尾斜杠） */
  baseURL: string;
  /** 当前选用的模型 */
  model: string;
  /** 可选模型候选列表（用于设置页与 chat 页下拉） */
  models: string[];
}

/** 各提供商的配置集合 */
export type AIProvidersConfig = Record<AIProviderId, ProviderEntry>;

/** 提供商元信息（展示名 + 默认配置） */
export interface ProviderPreset {
  id: AIProviderId;
  /** 显示名称 */
  label: string;
  /** 默认 Base URL */
  baseURL: string;
  /** 默认模型 */
  defaultModel: string;
  /** 可选模型候选 */
  models: string[];
  /** API Key 输入框占位符 */
  keyPlaceholder: string;
}

/**
 * 内置提供商预设表（v2.5.0 新增）。
 * 切换提供商时用其 baseURL / defaultModel 自动填充。
 */
export const PROVIDER_PRESETS: Record<AIProviderId, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    keyPlaceholder: 'sk-...',
  },
  siliconflow: {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    models: ['deepseek-ai/DeepSeek-V4-Flash'],
    keyPlaceholder: 'sk-...',
  },
};

/** 提供商的稳定遍历顺序 */
export const AI_PROVIDER_ORDER: AIProviderId[] = ['deepseek', 'siliconflow'];

/** 根据 ID 取预设（找不到回落到 deepseek） */
export function getProviderPreset(id: AIProviderId): ProviderPreset {
  return PROVIDER_PRESETS[id] || PROVIDER_PRESETS.deepseek;
}

/**
 * 从任意（可能是老版本的）AIConfig 推导出 providers 配置。
 *
 * 迁移规则：
 * - 若已存在 providers，逐项补全缺失字段（防止新版本新增 provider 后老数据缺项）
 * - 否则用旧版扁平字段（apiKey / baseURL / model）灌入「当前 provider」对应的槽位
 */
export function migrateAIConfig(config: AIConfig): AIConfig {
  // v2.5.1: openai 提供商已移除。老配置若指向 openai（或 isDeepSeek=false），一律回落到 deepseek，
  // 避免 providers 里出现已不存在的 key 导致读写 undefined。
  const rawProvider = config.provider as string | undefined;
  const providerId: AIProviderId =
    rawProvider === 'siliconflow' ? 'siliconflow'
      : rawProvider === 'deepseek' ? 'deepseek'
        : (rawProvider === 'openai' || config.isDeepSeek === false) ? 'deepseek'
          : (config.isDeepSeek ? 'deepseek' : 'deepseek');

  const existing = config.providers as Record<string, ProviderEntry> | undefined;
  const providers = {} as AIProvidersConfig;

  for (const id of AI_PROVIDER_ORDER) {
    const preset = PROVIDER_PRESETS[id];
    const prev = existing?.[id];
    // 老配置：只把旧扁平字段灌入当前 provider，其它用 preset 默认值
    const isLegacySlot = !prev && id === providerId;
    providers[id] = {
      apiKey: prev?.apiKey ?? (isLegacySlot ? (config.apiKey || '') : ''),
      baseURL: prev?.baseURL ?? (isLegacySlot && config.baseURL ? config.baseURL : preset.baseURL),
      model: prev?.model ?? (isLegacySlot && config.model ? config.model : preset.defaultModel),
      models: prev?.models?.length ? prev.models : [...preset.models],
    };
  }

  return {
    ...config,
    provider: providerId,
    isDeepSeek: providerId === 'deepseek',
    providers,
    // 扁平字段保持同步，供未迁移的旧代码路径读取
    apiKey: providers[providerId].apiKey,
    baseURL: providers[providerId].baseURL,
    model: providers[providerId].model,
  };
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
  /** AI 返回标签数量上限 */
  maxTags: number;
  /** AI 返回标签数量下限 */
  minTags: number;
}

/** 智能组建议配置 */
export interface SmartGroupOptions {
  /** 用于组建议的最近条目数量 */
  recentEntryCount: number;
  /** 组建议提示词 */
  groupSuggestPrompt: string;
}

/** 连线建议配置 */
export interface ConnectionSuggestionOptions {
  /** 用于连线建议的最近条目数量 */
  recentEntryCount: number;
  /** 连线建议提示词 */
  connectionSuggestPrompt: string;
}

/** GLM 模型配置（免费模型池） */
export interface GLMConfig {
  /** 是否启用 GLM 免费模型池（非 chat 场景自动轮询） */
  enabled: boolean;
  /** GLM API Key */
  apiKey: string;
  /** GLM 模型名称（保留字段，实际由 FREE_MODEL_POOL 轮询） */
  model: string;
  /** GLM API Base URL */
  baseURL: string;
}

/**
 * GLM 免费模型池（v2.5.0）。
 *
 * 设计初衷：这些是智谱提供的免费模型，无需用户手动选择，
 * 非 chat 场景（标签/分组/连线建议等简单任务）按顺序轮询请求，
 * 分摊单模型的配额压力。用户只需开关 + Key。
 */
export const GLM_FREE_MODEL_POOL: string[] = [
  'glm-4-flash',
  'glm-4-flash-250414',
  'glm-z1-flash',
];

export interface PromptConfig {
  tagSuggestion: string;
  relationSuggestion: string;
  dialogueContext: string;
  autoLink: string;
  /** 组建议提示词 */
  groupSuggestion: string;
  /** 连线建议提示词 */
  connectionSuggestion: string;
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

  // e.2: 对话上下文提示词简化为仅提供 {currentEntry} {recentEntries} 字段
  dialogueContext: `你是一个个人知识管理助手。用户正在围绕一条笔记展开对话。
请基于以下上下文提供帮助：

【当前条目】
{currentEntry}

【近期关注】
{recentEntries}

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

  // e.1: 组建议提示词
  groupSuggestion: `你是一个分组建议助手。请分析以下条目内容，推荐 1-3 个合适的分组。
要求：
1. 分组名简洁，2-8 个字
2. 从内容主题、用途、领域三个维度考虑
3. 优先复用已有的分组
4. 只返回分组列表，每行一个，不要解释

已有分组：
{existingGroups}

最近条目内容：
{recentEntries}`,

  // b.4: 连线建议提示词
  connectionSuggestion: `你是一个知识关联发现助手。请分析以下条目，找出可能有关联的条目对。
要求：
1. 找出 3-5 组有关联的条目对
2. 用一句话描述每对条目的关联
3. 返回格式：ID1 → ID2: 关联描述

最近条目列表：
{entries}`,
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
      tagSuggestPrompt: `你是一个标签建议助手。请分析以下文本内容，结合用户最近使用过的标签，推荐 {minTags}-{maxTags} 个合适的标签。

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
      maxTags: 6,
      minTags: 1,
    },
    smartGroup: {
      recentEntryCount: 50,
      groupSuggestPrompt: `你是一个分组建议助手。请分析以下条目内容，推荐 1-3 个合适的分组。
要求：
1. 分组名简洁，2-8 个字
2. 从内容主题、用途、领域三个维度考虑
3. 优先复用已有的分组
4. 只返回分组列表，每行一个，不要解释

已有分组：
{existingGroups}

最近条目内容：
{recentEntries}`,
    },
    connectionSuggestion: {
      recentEntryCount: 100,
      connectionSuggestPrompt: `你是一个知识关联发现助手。请分析以下条目，找出可能有关联的条目对。
要求：
1. 找出 3-5 组有关联的条目对
2. 用一句话描述每对条目的关联
3. 返回格式：ID1 → ID2: 关联描述

最近条目列表：
{entries}`,
    },
    glm: {
      enabled: false,
      apiKey: '',
      model: 'glm-4-flash',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    },
    provider: 'deepseek',
    providers: {
      deepseek: {
        apiKey: '',
        baseURL: PROVIDER_PRESETS.deepseek.baseURL,
        model: PROVIDER_PRESETS.deepseek.defaultModel,
        models: [...PROVIDER_PRESETS.deepseek.models],
      },
      siliconflow: {
        apiKey: '',
        baseURL: PROVIDER_PRESETS.siliconflow.baseURL,
        model: PROVIDER_PRESETS.siliconflow.defaultModel,
        models: [...PROVIDER_PRESETS.siliconflow.models],
      },
    },
    chatSoul: '',
    recentPickerCount: 30,
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
    contentCollapseLength: 300,
  },
  /** 记忆来信（v2.12.0）：默认关闭，由用户在设置页主动开启（开启时才申请系统权限） */
  notify: {
    enabled: false,
    windowStart: 10,
    windowEnd: 22,
    dailyCount: 1,
  },
  todo: DEFAULT_TODO_CONFIG,
  // Cloudflare 中转站（v2.7.0）：密钥由用户手填，这里默认全空
  cloud: {
    url: '',
    token: '',
    db: 'memory',
    bucket: 'memory',
    publicDomain: '',
  },
};

/** ============ 决定转盘（v2.3.0） ============ */

/** 转盘选项 */
export interface WheelOption {
  /** 选项名（最长 12 字） */
  name: string;
  /** 权重 1–99，决定扇区角度占比 */
  weight: number;
}

/** 转盘历史记录（保留最近若干条） */
export interface WheelHistoryItem {
  /** 抽中的选项名 */
  text: string;
  /** 抽中时间戳 */
  time: number;
  /** 扇区索引（用于显示对应色点） */
  index: number;
}

/** 一个转盘（一条数据库记录） */
export interface Wheel {
  id: string;
  /** 转盘名 */
  name: string;
  /** 选项列表（内嵌 JSON 存储） */
  options: WheelOption[];
  /** 最近记录（内嵌 JSON 存储） */
  history: WheelHistoryItem[];
  /** 是否开启音效 */
  soundEnabled: boolean;
  /**
   * 抽中后是否把该选项从列表移除（"抽一个少一个"模式）。
   * 每个转盘独立记忆。移除到只剩 1 个时停止，GO 自动禁用。
   */
  removeAfterSpin?: boolean;
  createdAt: number;
  updatedAt: number;
  /** 软删除标记 */
  isDeleted?: number;
}

/** ============ 备忘录（v2.3.0） ============ */

/** 一篇备忘录 */
export interface MemoDoc {
  id: string;
  /** 标题（取正文首个 # 标题，或"未命名"） */
  title: string;
  /** Markdown 正文 */
  content: string;
  /** 上次聚焦的标题纯文本（进入时自动跳转到该 # 标题） */
  lastAnchor: string | null;
  createdAt: number;
  updatedAt: number;
  isDeleted?: number;
}
