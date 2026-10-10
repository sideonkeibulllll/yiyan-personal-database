/**
 * Chat Bridge — 基于 OpenAI 原生 function calling 的工具桥接层
 *
 * 提供 AI 在对话中操作记忆库的能力：
 * - 创建/搜索/编辑/星标/删除 卡片（条目）— 支持内容/来源/补充/标签/组/星标
 * - 列出现有标签/分组（帮助 AI 复用而非新建）
 * - 编辑组 / 编辑标签（支持批量）
 * - 创建/搜索/编辑/完成/删除 待办（编辑支持改标题/备注/起止时间/日期/今日标记/标签）
 * - 待办标签：列出/创建/改名/改色/删除（独立标签池，颜色可自定义）
 * - 备忘录：搜索/读取/新建/追加/覆写/删除
 * - 数据连线
 *
 * 批量操作：写操作参数统一升级为 ID 数组（`entryIds[]` / `todoIds[]` / `memoIds[]`），
 * 同时兼容旧的单值参数（`entryId` / `todoId`）。
 *
 * 危险操作（删除类）：见 `DANGEROUS_TOOLS`。执行前由界面层弹出确认按钮，
 * 用户确认后才真正执行；未确认时工具返回「用户取消」。
 *
 * 工作原理（agent loop）：
 * 1. 用户在对话中启用某类工具，工具 schema 通过 `tools` 字段传给模型
 * 2. 模型在流式响应中输出 `tool_calls`（结构化，非文本嵌入）
 * 3. 客户端流式期间累积 tool_call 增量，拿到完整调用后立即执行
 * 4. 执行结果作为 `role: 'tool'` + `tool_call_id` 消息追加
 * 5. 再次请求模型，让它基于结果继续生成；循环直到模型不再调用工具
 *
 * 这取代了原先基于 <tool> XML 标签 + 流式后解析的伪 MCP 方案，
 * 解决了「AI 看不到结果」「一次只能调一个」「无 agent loop」等弊端。
 */

import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { getAllMemos, getMemo, createMemo, saveMemo, deleteMemo } from '@/services/memoDatabase';
import { broadcastMemosChanged } from '@/services/memoEvents';
import { listMemories, saveMemory, updateMemory, deleteMemory } from '@/services/aiMemory';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import type { Entry, Todo, Link, TodoTag } from '@/types';

/** 把单值 / 数组参数统一成字符串数组 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/** 
 * 待办标签默认颜色（与待办编辑页「+ 新标签」的默认色一致）。
 * v2.10.0 前此处硬编码 '#4dabf7'，导致 AI 创建的标签全是蓝色。
 */
const DEFAULT_TODO_TAG_COLOR = '#f76707';

/** 校验十六进制颜色（#RGB / #RRGGBB），非法返回错误文案 */
function validateHexColor(color: string): string | null {
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return null;
  return `颜色格式无效："${color}"。请使用十六进制格式，如 #f76707（橙）、#4dabf7（蓝）、#fa5252（红）`;
}

/** 解析 ISO 8601 时间字符串，失败返回错误文案（不再静默忽略） */
function parseIsoTime(value: unknown, fieldName: string): { ts?: number; error?: string } {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return {};
  const parsed = Date.parse(str);
  if (isNaN(parsed)) {
    return { error: `${fieldName} 无法解析："${str}"。请使用 ISO 8601 格式（如 2026-10-11T15:00:00+08:00）` };
  }
  return { ts: parsed };
}

/** 工具元数据（仅用于内部描述，传给 API 时由 buildToolsPayload 转换） */
export interface BridgeTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      items?: { type: string };
    }>;
    required: string[];
  };
}

/** 工具调用结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * OpenAI / DeepSeek 兼容的 tool_call 增量结构。
 * 流式响应中 delta.tool_calls 数组每项的字段都可能分片到达，需要按 index 累积。
 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  /** 'function' | 'code' | ... 目前只处理 function */
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * 累积后的完整 tool_call（执行阶段使用）。
 */
export interface ResolvedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** 可用的工具列表 */
export const BRIDGE_TOOLS: BridgeTool[] = [
  {
    name: 'create_card',
    description: '创建一条新的记忆卡片（条目）。用户说了一条值得记住的内容时使用。支持设置来源、补充信息、标签、组、星标。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '卡片内容（必填）' },
        source: { type: 'string', description: '内容来源（可选，如网址、书名、说话人等）' },
        supplement: { type: 'string', description: '补充信息（可选，对该条目的额外说明）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签名列表（可选）' },
        groupName: { type: 'string', description: '所属组名（可选）' },
        isStarred: { type: 'boolean', description: '是否星标（可选，默认false）' },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_cards',
    description: '搜索记忆库中的卡片。支持关键字搜索、按标签筛选、按组筛选。返回匹配结果列表。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（可选，留空则返回全部）' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签名筛选（可选）' },
        groupName: { type: 'string', description: '按组名筛选（可选）' },
        isStarred: { type: 'boolean', description: '只看星标（可选）' },
        limit: { type: 'number', description: '返回数量上限，默认20' },
      },
      required: [],
    },
  },
  {
    name: 'list_tags',
    description: '列出记忆库中现有的所有标签（名称 + 使用数量）。创建/编辑卡片需要打标签前，务必先调用此工具查看已有标签，优先复用，避免标签越用越碎。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_groups',
    description: '列出记忆库中现有的所有分组。为卡片指定组名前先查看，避免拼写不一致产生重复分组。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'edit_card',
    description: '编辑一条或多条数据卡片的内容/来源/补充信息/星标状态。未提供的字段保持不变。',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '要编辑的卡片ID列表（至少1个）' },
        content: { type: 'string', description: '新的卡片内容（可选）' },
        source: { type: 'string', description: '新的来源（可选）' },
        supplement: { type: 'string', description: '新的补充信息（可选）' },
        isStarred: { type: 'boolean', description: '是否星标（可选）' },
      },
      required: ['entryIds'],
    },
  },
  {
    name: 'star_card',
    description: '批量设置或取消数据卡片的星标。星标会让卡片在随机页更常被抽到。',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '卡片ID列表（至少1个）' },
        isStarred: { type: 'boolean', description: 'true 设为星标，false 取消星标' },
      },
      required: ['entryIds', 'isStarred'],
    },
  },
  {
    name: 'edit_group',
    description: '编辑一条或多条卡片的所属组。可以设置或移除组归属（支持批量）。',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '条目ID列表（至少1个）' },
        groupName: { type: 'string', description: '组名称（留空表示移除组归属）' },
      },
      required: ['entryIds'],
    },
  },
  {
    name: 'edit_tags',
    description: '批量为一条或多条卡片添加或移除标签。',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '条目ID列表（至少1个）' },
        addTags: { type: 'array', items: { type: 'string' }, description: '要添加的标签名列表' },
        removeTags: { type: 'array', items: { type: 'string' }, description: '要移除的标签名列表' },
      },
      required: ['entryIds'],
    },
  },
  // === 待办 MCP 工具 ===
  {
    name: 'create_todo',
    description: '创建一条新的待办事项。用户提到了一个需要去做的事情时使用。支持设置时间、备注、标签。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '待办标题（必填）' },
        note: { type: 'string', description: '待办备注（可选）' },
        time: { type: 'string', description: '待办开始时间，ISO 8601 格式（如 2026-10-11T15:00:00+08:00；请先换算好再传入）（可选）' },
        folderDate: { type: 'string', description: '所在日期文件夹，YYYY-MM-DD 格式（可选，默认今天）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签名列表（可选；不存在的标签会自动创建，颜色默认橙色，可用 create_todo_tag 指定颜色）' },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_todos',
    description: '搜索待办事项。支持关键字搜索、按标签筛选、按日期筛选、按完成状态筛选。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（可选）' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签名筛选（可选）' },
        folderDate: { type: 'string', description: '按日期筛选，YYYY-MM-DD 格式（可选）' },
        isDone: { type: 'boolean', description: '按完成状态筛选（可选）' },
        limit: { type: 'number', description: '返回数量上限，默认20' },
      },
      required: [],
    },
  },
  {
    name: 'get_today_todos',
    description: '获取今天的待办概览（默认只返回未完成的）。用于快速了解用户今天的安排。',
    parameters: {
      type: 'object',
      properties: {
        includeDone: { type: 'boolean', description: '是否包含已完成（默认 false）' },
      },
      required: [],
    },
  },
  {
    name: 'complete_todo',
    description: '将一条或多条待办标记为已完成或重新激活（支持批量）。',
    parameters: {
      type: 'object',
      properties: {
        todoIds: { type: 'array', items: { type: 'string' }, description: '待办ID列表（至少1个）' },
        uncomplete: { type: 'boolean', description: '如果为 true 则重新激活，默认 false' },
      },
      required: ['todoIds'],
    },
  },
  {
    name: 'edit_todo',
    description: '编辑一条或多条待办的标题/备注/开始时间/结束时间/日期/今日标记/标签（支持批量）。未提供的字段保持不变。给待办改标签用 addTags/removeTags，改完无需删除重建。',
    parameters: {
      type: 'object',
      properties: {
        todoIds: { type: 'array', items: { type: 'string' }, description: '待办ID列表（至少1个）' },
        title: { type: 'string', description: '新的标题（可选）' },
        note: { type: 'string', description: '新的备注（可选）' },
        time: { type: 'string', description: '新的开始时间，ISO 8601 格式（如 2026-10-11T15:00:00+08:00；请先换算好再传入）（可选）' },
        endTime: { type: 'string', description: '新的结束时间，ISO 8601 格式（可选）' },
        folderDate: { type: 'string', description: '新的日期文件夹，YYYY-MM-DD 格式（可选）' },
        isToday: { type: 'boolean', description: '是否标记为「今日处理」（可选）' },
        addTags: { type: 'array', items: { type: 'string' }, description: '要添加的标签名列表（不存在的会自动创建）（可选）' },
        removeTags: { type: 'array', items: { type: 'string' }, description: '要移除的标签名列表（可选）' },
      },
      required: ['todoIds'],
    },
  },
  {
    name: 'list_todo_tags',
    description: '列出待办标签池中的所有标签（名称 + 颜色 + 使用数量）。给待办打标签、改标签颜色、删除标签前，先调用此工具查看已有标签，优先复用。注意：待办标签与卡片标签是两套独立系统。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_todo_tag',
    description: '创建一个待办标签（可指定颜色）。同名标签会直接复用已有记录，不会重复创建。用户说"新建一个XX颜色的XX标签"时使用。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '标签名称（必填）' },
        color: { type: 'string', description: '标签颜色，十六进制格式如 #f76707（可选；不传则用默认橙色）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_todo_tag',
    description: '修改一个待办标签的名称或颜色（至少提供一项）。用 tagId 或 tagName 指定要改的标签。改颜色示例：color="#f76707"。',
    parameters: {
      type: 'object',
      properties: {
        tagId: { type: 'string', description: '要修改的标签ID（与 tagName 二选一）' },
        tagName: { type: 'string', description: '要修改的标签名（与 tagId 二选一）' },
        name: { type: 'string', description: '新的标签名称（可选）' },
        color: { type: 'string', description: '新的标签颜色，十六进制格式如 #fa5252（可选）' },
      },
      required: [],
    },
  },
  {
    name: 'delete_todo_tag',
    description: '删除一个或多个待办标签（从标签池中彻底移除，待办上的该标签会被解除，但待办本身保留）。这是危险操作，执行前系统会自动向用户弹出确认按钮。',
    parameters: {
      type: 'object',
      properties: {
        tagIds: { type: 'array', items: { type: 'string' }, description: '要删除的标签ID列表' },
        tagNames: { type: 'array', items: { type: 'string' }, description: '要删除的标签名列表（与 tagIds 可混用）' },
      },
      required: [],
    },
  },
  {
    name: 'delete_todo',
    description: '删除一条或多条待办。这是危险操作，执行前系统会自动向用户弹出确认按钮，用户确认后才会真正删除。',
    parameters: {
      type: 'object',
      properties: {
        todoIds: { type: 'array', items: { type: 'string' }, description: '要删除的待办ID列表' },
      },
      required: ['todoIds'],
    },
  },
  // === 数据连线 MCP 工具 ===
  {
    name: 'link_cards',
    description: '将一个源数据卡片连接到 N 个目标数据卡片（N≥1）。建立连线后可以在查看连线时看到关联关系。',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '源数据卡片ID' },
        targetIds: { type: 'array', items: { type: 'string' }, description: '目标数据卡片ID列表（至少1个）' },
        description: { type: 'string', description: '连线描述（可选，说明为什么相关）' },
      },
      required: ['sourceId', 'targetIds'],
    },
  },
  {
    name: 'get_card_links',
    description: '查询指定数据卡片的连线关系。可以指定深度（depth）进行多级遍历，返回所有关联卡片及其连线。例如 depth=2 会返回直接连线（1级）和连线的连线（2级）的所有卡片。',
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: '要查询的数据卡片ID' },
        depth: { type: 'number', description: '遍历深度（默认1，只返回直接连线；2则返回1级+2级连线；以此类推）' },
        direction: { type: 'string', description: '方向过滤：all（默认，双向）、outgoing（只看出）、incoming（只看入）' },
        limit: { type: 'number', description: '每级返回数量上限，默认50' },
      },
      required: ['entryId'],
    },
  },
  {
    name: 'delete_card',
    description: '删除一条或多条数据卡片。这是危险操作，执行前系统会自动向用户弹出确认按钮，用户确认后才会真正删除。',
    parameters: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '要删除的卡片ID列表' },
      },
      required: ['entryIds'],
    },
  },
  // === 备忘录 MCP 工具 ===
  {
    name: 'search_memos',
    description: '搜索备忘录。支持关键字搜索标题与正文，返回备忘录列表（含 ID、标题、摘要、更新时间）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（可选，留空返回全部）' },
        limit: { type: 'number', description: '返回数量上限，默认10' },
      },
      required: [],
    },
  },
  {
    name: 'read_memo',
    description: '读取一篇备忘录的完整正文（超长会自动截断）。',
    parameters: {
      type: 'object',
      properties: {
        memoId: { type: 'string', description: '备忘录ID' },
      },
      required: ['memoId'],
    },
  },
  {
    name: 'create_memo',
    description: '新建一篇备忘录。用户说"记录到备忘录 / 帮我记一下"时使用。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题（可选，默认取正文首个 # 标题或"未命名"）' },
        content: { type: 'string', description: 'Markdown 正文（可选）' },
      },
      required: [],
    },
  },
  {
    name: 'append_memo',
    description: '在指定备忘录末尾追加一段内容（AI 做笔记 / 续写最常用）。',
    parameters: {
      type: 'object',
      properties: {
        memoId: { type: 'string', description: '备忘录ID' },
        content: { type: 'string', description: '要追加的 Markdown 内容' },
      },
      required: ['memoId', 'content'],
    },
  },
  {
    name: 'update_memo',
    description: '覆盖一篇备忘录的正文（整段替换）。会丢失原有内容，谨慎使用；追加内容请改用 append_memo。',
    parameters: {
      type: 'object',
      properties: {
        memoId: { type: 'string', description: '备忘录ID' },
        content: { type: 'string', description: '新的完整 Markdown 正文' },
        title: { type: 'string', description: '新的标题（可选）' },
      },
      required: ['memoId', 'content'],
    },
  },
  {
    name: 'delete_memo',
    description: '删除一篇或多篇备忘录。这是危险操作，执行前系统会自动向用户弹出确认按钮，用户确认后才会真正删除。',
    parameters: {
      type: 'object',
      properties: {
        memoIds: { type: 'array', items: { type: 'string' }, description: '要删除的备忘录ID列表' },
      },
      required: ['memoIds'],
    },
  },
  // === 长期记忆 MCP 工具（v2.11.0）===
  // 仅在 settings.context.enableLongTermMemory 打开时自动启用（不走 MCP 组勾选）。
  {
    name: 'save_ai_memory',
    description: '把一条关于用户的长期信息写入「长期记忆」（跨对话永久保留）。只在发现值得长期记住的内容时使用：用户的偏好、习惯、重要事实、长期目标、反复出现的需求等。不要记录：一次性任务、临时状态、敏感隐私（除非用户明确要求记住）。保存前可先用 list_ai_memories 查看已有记忆避免重复（调用方会自动忽略完全相同的内容）。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆内容，用一句简洁的话描述（例如：用户习惯在晚上整理当天的待办）' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_ai_memories',
    description: '列出全部长期记忆（ID / 内容 / 来源 / 更新时间）。用户问"你记住了我什么"、或在保存/修改前查重时使用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_ai_memory',
    description: '修改一条长期记忆的内容（用 memoryId 定位）。当记忆过时、不准确，或用户纠正你时使用。',
    parameters: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: '要修改的记忆 ID（先用 list_ai_memories 获取）' },
        content: { type: 'string', description: '新的记忆内容' },
      },
      required: ['memoryId', 'content'],
    },
  },
  {
    name: 'delete_ai_memory',
    description: '删除一条或多条长期记忆（按 ID）。这是危险操作，执行前系统会自动向用户弹出确认按钮，用户确认后才会真正删除。',
    parameters: {
      type: 'object',
      properties: {
        memoryIds: { type: 'array', items: { type: 'string' }, description: '要删除的记忆 ID 列表' },
      },
      required: ['memoryIds'],
    },
  },
];

/** 所有工具名称 */
export const ALL_TOOL_NAMES = BRIDGE_TOOLS.map(t => t.name);

/** 按类型分组的工具名 */
export const ENTRY_TOOLS = [
  'create_card', 'search_cards', 'list_tags', 'list_groups',
  'edit_card', 'star_card', 'edit_group', 'edit_tags',
  'link_cards', 'get_card_links', 'delete_card',
];
export const TODO_TOOLS = [
  'create_todo', 'search_todos', 'get_today_todos',
  'complete_todo', 'edit_todo', 'delete_todo',
  'list_todo_tags', 'create_todo_tag', 'update_todo_tag', 'delete_todo_tag',
];
export const MEMO_TOOLS = [
  'search_memos', 'read_memo', 'create_memo',
  'append_memo', 'update_memo', 'delete_memo',
];
/** 长期记忆工具（v2.11.0）：跟随 enableLongTermMemory 开关自动启用，不走 MCP 组勾选 */
export const MEMORY_TOOLS = [
  'save_ai_memory', 'list_ai_memories', 'update_ai_memory', 'delete_ai_memory',
];

/** 需要用户确认后才执行的危险工具（删除类） */
export const DANGEROUS_TOOLS = new Set(['delete_card', 'delete_todo', 'delete_memo', 'delete_todo_tag', 'delete_ai_memory']);

/** 工具名 → 中文显示名（用于确认弹窗） */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  create_card: '创建卡片', search_cards: '搜索卡片', list_tags: '列出标签', list_groups: '列出分组',
  edit_card: '编辑卡片', star_card: '设置星标', edit_group: '编辑分组', edit_tags: '编辑标签',
  link_cards: '连接卡片', get_card_links: '查询连线', delete_card: '删除卡片',
  create_todo: '创建待办', search_todos: '搜索待办', get_today_todos: '今日待办',
  complete_todo: '完成待办', edit_todo: '编辑待办', delete_todo: '删除待办',
  list_todo_tags: '列出待办标签', create_todo_tag: '创建待办标签',
  update_todo_tag: '修改待办标签', delete_todo_tag: '删除待办标签',
  search_memos: '搜索备忘录', read_memo: '读取备忘录', create_memo: '新建备忘录',
  append_memo: '追加备忘录', update_memo: '覆写备忘录', delete_memo: '删除备忘录',
  save_ai_memory: '记住一条信息', list_ai_memories: '查看长期记忆',
  update_ai_memory: '修改长期记忆', delete_ai_memory: '删除长期记忆',
};

/**
 * 生成危险操作的确认摘要（展示在对话内的确认卡片上）。
 */
export function describeToolAction(toolName: string, args: Record<string, unknown>): string {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === 'string' && v ? 1 : 0);
  switch (toolName) {
    case 'delete_card': return `删除 ${count(args.entryIds)} 条数据卡片`;
    case 'delete_todo': return `删除 ${count(args.todoIds)} 条待办`;
    case 'delete_memo': return `删除 ${count(args.memoIds)} 篇备忘录`;
    case 'delete_ai_memory': return `删除 ${count(args.memoryIds ?? args.memoryId)} 条长期记忆`;
    case 'delete_todo_tag': {
      const names = [
        ...toStringArray(args.tagNames),
        ...toStringArray(args.tagIds),
      ];
      return names.length > 0
        ? `删除待办标签：${names.join('、')}`
        : '删除待办标签';
    }
    default: return `执行 ${TOOL_DISPLAY_NAMES[toolName] || toolName}`;
  }
}

/**
 * 生成传给 OpenAI/DeepSeek API 的 `tools` 字段（结构化工具 schema）。
 * 只包含用户启用的工具，传给 chat/completions 接口的 tools 参数。
 */
export function buildToolsPayload(enabledTools: string[]): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: BridgeTool['parameters'];
  };
}> {
  return BRIDGE_TOOLS
    .filter(t => enabledTools.includes(t.name))
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
}

/**
 * 累积流式 tool_call 增量。每次收到 delta.tool_calls 时调用，
 * 按 index 合并到 accumulator 中，返回更新后的 accumulator（同一引用，已原地更新）。
 *
 * 注意：arguments 是 JSON 字符串分片，需要字符串拼接而非解析。
 */
export function accumulateToolCallDeltas(
  accumulator: Map<number, ResolvedToolCall>,
  deltas: ToolCallDelta[],
): Map<number, ResolvedToolCall> {
  for (const d of deltas) {
    if (d.index === undefined) continue;
    let entry = accumulator.get(d.index);
    if (!entry) {
      entry = { id: '', type: 'function', function: { name: '', arguments: '' } };
      accumulator.set(d.index, entry);
    }
    if (d.id) entry.id = d.id;
    if (d.type) entry.type = d.type as 'function';
    if (d.function) {
      if (d.function.name) entry.function.name += d.function.name;
      if (d.function.arguments) entry.function.arguments += d.function.arguments;
    }
  }
  return accumulator;
}

/**
 * 将解析完成的 arguments JSON 字符串安全解析为对象。
 * 解析失败返回空对象并打印警告（不再静默吞掉，方便调试）。
 */
export function parseToolArguments(argsStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsStr);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    console.warn('[chatBridge] 工具参数 JSON 解析失败:', err, '原始:', argsStr);
    return {};
  }
}

/** 执行工具调用 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const db = await getDatabase();
    const todoDb = await getTodoDatabase();

    switch (toolName) {
      case 'create_card': {
        const content = String(args.content || '');
        if (!content) return { success: false, error: 'content 不能为空' };

        const now = Date.now();
        const entryData: Omit<Entry, 'tags'> = {
          id: `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`,
          content,
          source: String(args.source || ''),
          supplement: String(args.supplement || ''),
          isStarred: Boolean(args.isStarred),
          createdAt: now,
          updatedAt: now,
          copyCount: 0,
        };

        // 处理组
        const groupName = String(args.groupName || '');
        if (groupName) {
          const groups = await db.getAllGroups();
          const existing = groups.find(g => g.name === groupName);
          if (existing) {
            entryData.groupId = existing.id;
          } else {
            const newGroup = await db.createGroup(groupName);
            entryData.groupId = newGroup.id;
          }
        }

        const entry = await db.createEntry(entryData);

        // 处理标签
        const tags = args.tags as string[] | undefined;
        if (tags && Array.isArray(tags)) {
          const allTags = await db.getAllTags();
          for (const tagName of tags) {
            let tag = allTags.find(t => t.name === tagName);
            if (!tag) {
              tag = await db.createTag(tagName);
            }
            await db.addTagToEntry(entry.id, tag.id);
          }
        }

        // 刷新 store
        await useEntryStore.getState().loadEntries();

        return {
          success: true,
          data: {
            id: entry.id,
            content: entry.content,
            source: entry.source,
            supplement: entry.supplement,
            groupName: groupName || null,
            tags: tags || [],
            isStarred: entry.isStarred,
            message: '卡片已创建',
          },
        };
      }

      case 'search_cards': {
        const query = String(args.query || '');
        const isStarred = args.isStarred as boolean | undefined;
        const groupName = String(args.groupName || '');
        const tagNames = (args.tags as string[]) || [];
        const limit = Number(args.limit) || 20;

        let results: Entry[] = [];

        // 按组筛选
        if (groupName) {
          const groups = await db.getAllGroups();
          const group = groups.find(g => g.name === groupName);
          if (group) {
            results = await db.getEntriesByGroupId(group.id);
          } else {
            return { success: true, data: { total: 0, results: [], message: `组 "${groupName}" 不存在` } };
          }
        }

        // 关键字搜索
        if (query) {
          const searched = await db.searchEntries(query, {
            isStarred: isStarred,
          });
          results = results.length > 0
            ? results.filter(e => searched.some(s => s.id === e.id))
            : searched;
        } else if (isStarred !== undefined) {
          const all = await db.getAllEntries();
          results = results.length > 0
            ? results.filter(e => e.isStarred === isStarred)
            : all.filter(e => e.isStarred === isStarred);
        }

        // 按标签筛选
        if (tagNames.length > 0) {
          const allTags = await db.getAllTags();
          const tagIds = tagNames.map(name => allTags.find(t => t.name === name)?.id).filter(Boolean) as string[];
          if (tagIds.length > 0) {
            const taggedEntries = new Set<string>();
            for (const tagId of tagIds) {
              const entries = await db.getEntriesByTagId(tagId);
              entries.forEach(e => taggedEntries.add(e.id));
            }
            results = results.filter(e => taggedEntries.has(e.id));
          }
        }

        return {
          success: true,
          data: {
            total: results.length,
            results: await Promise.all(results.slice(0, limit).map(async e => {
              const links = await db.getLinksByEntryId(e.id);
              return {
                id: e.id,
                content: e.content.length > 200 ? e.content.slice(0, 200) + '…' : e.content,
                source: e.source,
                isStarred: e.isStarred,
                createdAt: e.createdAt,
                linkCount: links.length,
              };
            })),
          },
        };
      }

      case 'list_tags': {
        const allTags = await db.getAllTags();
        const counts: { id: string; name: string; count: number }[] = [];
        for (const tag of allTags) {
          const entries = await db.getEntriesByTagId(tag.id);
          counts.push({ id: tag.id, name: tag.name, count: entries.length });
        }
        counts.sort((a, b) => b.count - a.count);
        return {
          success: true,
          data: {
            total: counts.length,
            tags: counts,
            message: counts.length > 0
              ? `共 ${counts.length} 个标签。打标签时优先复用这些名称。`
              : '当前没有任何标签。',
          },
        };
      }

      case 'list_groups': {
        const groups = await db.getAllGroups();
        return {
          success: true,
          data: {
            total: groups.length,
            groups: groups.map(g => ({ id: g.id, name: g.name })),
            message: groups.length > 0
              ? `共 ${groups.length} 个分组。指定组名时优先复用这些名称。`
              : '当前没有任何分组。',
          },
        };
      }

      case 'edit_card': {
        const entryIds = toStringArray(args.entryIds ?? args.entryId);
        if (entryIds.length === 0) return { success: false, error: 'entryIds 不能为空' };

        const hasContent = typeof args.content === 'string';
        const hasSource = typeof args.source === 'string';
        const hasSupplement = typeof args.supplement === 'string';
        const hasStar = typeof args.isStarred === 'boolean';
        if (!hasContent && !hasSource && !hasSupplement && !hasStar) {
          return { success: false, error: '至少要提供 content / source / supplement / isStarred 之一' };
        }

        const updates: Partial<Entry> = {};
        if (hasContent) updates.content = String(args.content);
        if (hasSource) updates.source = String(args.source);
        if (hasSupplement) updates.supplement = String(args.supplement);
        if (hasStar) updates.isStarred = Boolean(args.isStarred);

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const id of entryIds) {
          const entry = await db.getEntryById(id);
          if (!entry) { notFound.push(id); continue; }
          await db.updateEntry(id, updates);
          updated.push(id);
        }
        await useEntryStore.getState().loadEntries();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到可编辑的卡片' : undefined,
          data: {
            updatedCount: updated.length,
            updatedIds: updated,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已更新 ${updated.length} 条卡片${notFound.length > 0 ? `，${notFound.length} 条未找到` : ''}`,
          },
        };
      }

      case 'star_card': {
        const entryIds = toStringArray(args.entryIds ?? args.entryId);
        if (entryIds.length === 0) return { success: false, error: 'entryIds 不能为空' };
        const isStarred = Boolean(args.isStarred);

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const id of entryIds) {
          const entry = await db.getEntryById(id);
          if (!entry) { notFound.push(id); continue; }
          await db.updateEntry(id, { isStarred });
          updated.push(id);
        }
        await useEntryStore.getState().loadEntries();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到对应卡片' : undefined,
          data: {
            updatedCount: updated.length,
            isStarred,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已${isStarred ? '设为星标' : '取消星标'} ${updated.length} 条卡片`,
          },
        };
      }

      case 'edit_group': {
        const entryIds = toStringArray(args.entryIds ?? args.entryId);
        if (entryIds.length === 0) return { success: false, error: 'entryIds 不能为空' };

        const groupName = String(args.groupName || '');
        let groupId: string | undefined;

        if (groupName) {
          const groups = await db.getAllGroups();
          const existing = groups.find(g => g.name === groupName);
          if (existing) {
            groupId = existing.id;
          } else {
            const newGroup = await db.createGroup(groupName);
            groupId = newGroup.id;
          }
        }

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const id of entryIds) {
          const entry = await db.getEntryById(id);
          if (!entry) { notFound.push(id); continue; }
          await db.updateEntry(id, { groupId: groupId || undefined });
          updated.push(id);
        }
        await useEntryStore.getState().loadEntries();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到对应卡片' : undefined,
          data: {
            updatedCount: updated.length,
            groupName: groupName || '(已移除)',
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已更新 ${updated.length} 条卡片的组归属`,
          },
        };
      }

      case 'edit_tags': {
        const entryIds = toStringArray(args.entryIds ?? args.entryId);
        if (entryIds.length === 0) return { success: false, error: 'entryIds 不能为空' };

        const addTags = (args.addTags as string[]) || [];
        const removeTags = (args.removeTags as string[]) || [];

        let allTags = await db.getAllTags();

        // 预创建 addTags 中不存在的标签（避免每条卡片重复创建）
        for (const tagName of addTags) {
          if (!allTags.find(t => t.name === tagName)) {
            const tag = await db.createTag(tagName);
            allTags = [...allTags, tag];
          }
        }

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const entryId of entryIds) {
          const entry = await db.getEntryById(entryId);
          if (!entry) { notFound.push(entryId); continue; }
          for (const tagName of addTags) {
            const tag = allTags.find(t => t.name === tagName);
            if (tag) await db.addTagToEntry(entryId, tag.id);
          }
          for (const tagName of removeTags) {
            const tag = allTags.find(t => t.name === tagName);
            if (tag) await db.removeTagFromEntry(entryId, tag.id);
          }
          updated.push(entryId);
        }

        await useTagStore.getState().loadTags();
        await useEntryStore.getState().loadEntries();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到对应卡片' : undefined,
          data: {
            updatedCount: updated.length,
            addedTags: addTags,
            removedTags: removeTags,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已更新 ${updated.length} 条卡片的标签`,
          },
        };
      }

      case 'delete_card': {
        const entryIds = toStringArray(args.entryIds ?? args.entryId);
        if (entryIds.length === 0) return { success: false, error: 'entryIds 不能为空' };

        const deleted: string[] = [];
        const notFound: string[] = [];
        for (const id of entryIds) {
          const entry = await db.getEntryById(id);
          if (!entry) { notFound.push(id); continue; }
          await db.deleteEntry(id);
          deleted.push(id);
        }
        await useEntryStore.getState().loadEntries();

        return {
          success: deleted.length > 0,
          error: deleted.length === 0 ? '没有找到可删除的卡片' : undefined,
          data: {
            deletedCount: deleted.length,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已删除 ${deleted.length} 条卡片`,
          },
        };
      }

      case 'get_today_todos': {
        const includeDone = Boolean(args.includeDone);
        const today = new Date().toISOString().slice(0, 10);
        let todos = await todoDb.getAllTodos();
        todos = todos.filter((t: Todo) => t.folderDate === today);
        if (!includeDone) todos = todos.filter((t: Todo) => t.status !== 'done');
        return {
          success: true,
          data: {
            date: today,
            total: todos.length,
            todos: todos.map((t: Todo) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              startTime: t.startTime || null,
              note: t.note || null,
            })),
            message: `今天共有 ${todos.length} 条${includeDone ? '' : '未完成'}待办`,
          },
        };
      }

      case 'complete_todo': {
        const todoIds = toStringArray(args.todoIds ?? args.todoId);
        if (todoIds.length === 0) return { success: false, error: 'todoIds 不能为空' };
        const uncomplete = Boolean(args.uncomplete);

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const todoId of todoIds) {
          const todo = await todoDb.getTodoById(todoId);
          if (!todo) { notFound.push(todoId); continue; }
          if (uncomplete) {
            await todoDb.updateTodo(todoId, { status: 'pending', completedAt: undefined });
          } else {
            await todoDb.updateTodo(todoId, { status: 'done', completedAt: Date.now() });
          }
          updated.push(todoId);
        }
        await useTodoStore.getState().loadAllTodos();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到对应待办' : undefined,
          data: {
            updatedCount: updated.length,
            action: uncomplete ? '重新激活' : '标记完成',
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已${uncomplete ? '重新激活' : '完成'} ${updated.length} 条待办`,
          },
        };
      }

      case 'edit_todo': {
        const todoIds = toStringArray(args.todoIds ?? args.todoId);
        if (todoIds.length === 0) return { success: false, error: 'todoIds 不能为空' };

        const updates: Partial<Todo> = {};
        if (typeof args.title === 'string') updates.title = args.title;
        if (typeof args.note === 'string') updates.note = args.note;
        if (typeof args.folderDate === 'string' && args.folderDate) updates.folderDate = args.folderDate;
        if (typeof args.isToday === 'boolean') updates.isToday = args.isToday;

        const timeParsed = parseIsoTime(args.time, 'time');
        if (timeParsed.error) return { success: false, error: timeParsed.error };
        if (timeParsed.ts !== undefined) updates.startTime = timeParsed.ts;

        const endTimeParsed = parseIsoTime(args.endTime, 'endTime');
        if (endTimeParsed.error) return { success: false, error: endTimeParsed.error };
        if (endTimeParsed.ts !== undefined) updates.endTime = endTimeParsed.ts;

        const addTags = toStringArray(args.addTags);
        const removeTags = toStringArray(args.removeTags);

        if (Object.keys(updates).length === 0 && addTags.length === 0 && removeTags.length === 0) {
          return { success: false, error: '至少要提供 title / note / time / endTime / folderDate / isToday / addTags / removeTags 之一' };
        }

        // 预创建 addTags 中不存在的标签（避免每条待办重复创建）
        if (addTags.length > 0) {
          const allTags = await todoDb.getAllTodoTags();
          for (const tagName of addTags) {
            if (!allTags.find((t: TodoTag) => t.name === tagName)) {
              await todoDb.createTodoTag(tagName, DEFAULT_TODO_TAG_COLOR);
            }
          }
        }

        const updated: string[] = [];
        const notFound: string[] = [];
        for (const todoId of todoIds) {
          const todo = await todoDb.getTodoById(todoId);
          if (!todo) { notFound.push(todoId); continue; }

          const payload: Partial<Todo> = { ...updates };

          // 标签增删（v2.10.0）：取当前标签集，运算后整体回写；新添加的追加到末尾
          if (addTags.length > 0 || removeTags.length > 0) {
            const allTags = await todoDb.getAllTodoTags();
            const nameToId = new Map(allTags.map((t: TodoTag) => [t.name, t.id]));
            const removedIds = new Set(
              removeTags.map(n => nameToId.get(n)).filter((v): v is string => Boolean(v))
            );
            const nextIds = (todo.tagIds || []).filter(id => !removedIds.has(id));
            for (const tagName of addTags) {
              const id = nameToId.get(tagName);
              if (id && !nextIds.includes(id)) nextIds.push(id);
            }
            payload.tagIds = nextIds;
          }

          await todoDb.updateTodo(todoId, payload);
          updated.push(todoId);
        }
        await useTodoStore.getState().loadAllTodos();
        await useTodoTagStore.getState().loadTags();

        return {
          success: updated.length > 0,
          error: updated.length === 0 ? '没有找到对应待办' : undefined,
          data: {
            updatedCount: updated.length,
            addedTags: addTags.length > 0 ? addTags : undefined,
            removedTags: removeTags.length > 0 ? removeTags : undefined,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已更新 ${updated.length} 条待办`,
          },
        };
      }

      case 'list_todo_tags': {
        const allTags = await todoDb.getAllTodoTags();
        const allTodos = await todoDb.getAllTodos();
        // 内存统计使用数量（避免循环内逐标签查库）
        const usage = new Map<string, number>();
        for (const t of allTodos) {
          for (const tagId of (t.tagIds || [])) {
            usage.set(tagId, (usage.get(tagId) || 0) + 1);
          }
        }
        const tags = allTags.map((t: TodoTag) => ({
          id: t.id,
          name: t.name,
          color: t.color || null,
          todoCount: usage.get(t.id) || 0,
        }));
        tags.sort((a, b) => b.todoCount - a.todoCount);
        return {
          success: true,
          data: {
            total: tags.length,
            tags,
            message: tags.length > 0
              ? `共 ${tags.length} 个待办标签。给待办打标签时优先复用这些名称。`
              : '当前没有任何待办标签。',
          },
        };
      }

      case 'create_todo_tag': {
        const name = String(args.name || '').trim();
        if (!name) return { success: false, error: 'name 不能为空' };

        let color: string | undefined;
        if (typeof args.color === 'string' && args.color.trim()) {
          const colorErr = validateHexColor(args.color.trim());
          if (colorErr) return { success: false, error: colorErr };
          color = args.color.trim();
        }

        // 同名复用（createTodoTag 内部已有查重，这里显式处理以便告知 AI）
        const existing = (await todoDb.getAllTodoTags()).find((t: TodoTag) => t.name === name);
        if (existing) {
          return {
            success: true,
            data: {
              id: existing.id,
              name: existing.name,
              color: existing.color || null,
              existed: true,
              message: `标签"${name}"已存在（颜色：${existing.color || '未设置'}），已复用，未重复创建`,
            },
          };
        }

        const tag = await todoDb.createTodoTag(name, color || DEFAULT_TODO_TAG_COLOR);
        await useTodoTagStore.getState().loadTags();

        return {
          success: true,
          data: {
            id: tag.id,
            name: tag.name,
            color: tag.color || null,
            existed: false,
            message: `待办标签"${name}"已创建（颜色：${tag.color}）`,
          },
        };
      }

      case 'update_todo_tag': {
        const tagId = String(args.tagId || '');
        const tagName = String(args.tagName || '');
        if (!tagId && !tagName) return { success: false, error: '需要提供 tagId 或 tagName 来定位标签' };

        const allTags = await todoDb.getAllTodoTags();
        const target = tagId
          ? allTags.find((t: TodoTag) => t.id === tagId)
          : allTags.find((t: TodoTag) => t.name === tagName);
        if (!target) {
          return { success: false, error: `未找到待办标签：${tagId || tagName}` };
        }

        const tagUpdates: Partial<TodoTag> = {};
        if (typeof args.name === 'string' && args.name.trim()) {
          const newName = args.name.trim();
          if (newName !== target.name && allTags.some((t: TodoTag) => t.id !== target.id && t.name === newName)) {
            return { success: false, error: `已存在同名标签"${newName}"，不能重命名为重复名称（可用 delete_todo_tag 先删除或改用其他名称）` };
          }
          tagUpdates.name = newName;
        }
        if (typeof args.color === 'string' && args.color.trim()) {
          const colorErr = validateHexColor(args.color.trim());
          if (colorErr) return { success: false, error: colorErr };
          tagUpdates.color = args.color.trim();
        }
        if (Object.keys(tagUpdates).length === 0) {
          return { success: false, error: '至少要提供 name 或 color 之一' };
        }

        await todoDb.updateTodoTag(target.id, tagUpdates);
        await useTodoTagStore.getState().loadTags();

        const changed: string[] = [];
        if (tagUpdates.name) changed.push(`名称 → ${tagUpdates.name}`);
        if (tagUpdates.color) changed.push(`颜色 → ${tagUpdates.color}`);
        return {
          success: true,
          data: {
            id: target.id,
            name: tagUpdates.name || target.name,
            color: tagUpdates.color || target.color || null,
            message: `标签"${target.name}"已更新（${changed.join('，')}）`,
          },
        };
      }

      case 'delete_todo_tag': {
        const targetIds = toStringArray(args.tagIds);
        const targetNames = toStringArray(args.tagNames);
        if (targetIds.length === 0 && targetNames.length === 0) {
          return { success: false, error: '需要提供 tagIds 或 tagNames' };
        }

        const allTags = await todoDb.getAllTodoTags();
        const targets = new Map<string, TodoTag>();
        for (const id of targetIds) {
          const t = allTags.find((x: TodoTag) => x.id === id);
          if (t) targets.set(t.id, t);
        }
        for (const name of targetNames) {
          const t = allTags.find((x: TodoTag) => x.name === name);
          if (t) targets.set(t.id, t);
        }
        if (targets.size === 0) {
          return { success: false, error: `未找到要删除的标签：${[...targetNames, ...targetIds].join('、')}` };
        }

        const deletedNames: string[] = [];
        for (const t of targets.values()) {
          await todoDb.deleteTodoTag(t.id);
          deletedNames.push(t.name);
        }
        await useTodoTagStore.getState().loadTags();

        return {
          success: true,
          data: {
            deletedCount: deletedNames.length,
            deletedNames,
            message: `已删除待办标签：${deletedNames.join('、')}（相关待办上的该标签已解除，待办本身保留）`,
          },
        };
      }

      case 'delete_todo': {
        const todoIds = toStringArray(args.todoIds ?? args.todoId);
        if (todoIds.length === 0) return { success: false, error: 'todoIds 不能为空' };

        const deleted: string[] = [];
        const notFound: string[] = [];
        for (const todoId of todoIds) {
          const todo = await todoDb.getTodoById(todoId);
          if (!todo) { notFound.push(todoId); continue; }
          await todoDb.deleteTodo(todoId);
          deleted.push(todoId);
        }
        await useTodoStore.getState().loadAllTodos();

        return {
          success: deleted.length > 0,
          error: deleted.length === 0 ? '没有找到可删除的待办' : undefined,
          data: {
            deletedCount: deleted.length,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已删除 ${deleted.length} 条待办`,
          },
        };
      }

      case 'link_cards': {
        const sourceId = String(args.sourceId || '');
        if (!sourceId) return { success: false, error: 'sourceId 不能为空' };
        const targetIds = (args.targetIds as string[]) || [];
        if (!Array.isArray(targetIds) || targetIds.length === 0) {
          return { success: false, error: 'targetIds 不能为空，至少需要 1 个目标' };
        }
        const linkDesc = String(args.description || '') || undefined;

        // 验证源条目存在
        const sourceEntry = await db.getEntryById(sourceId);
        if (!sourceEntry) {
          return { success: false, error: `源条目 ${sourceId} 不存在` };
        }

        // 验证目标条目并创建连线
        const createdLinks: Link[] = [];
        const notFoundIds: string[] = [];
        for (const targetId of targetIds) {
          // 不允许自连
          if (targetId === sourceId) {
            notFoundIds.push(`${targetId}(不能自连)`);
            continue;
          }
          const targetEntry = await db.getEntryById(targetId);
          if (!targetEntry) {
            notFoundIds.push(targetId);
            continue;
          }
          const link = await db.createLink(sourceId, targetId, linkDesc);
          createdLinks.push(link);
        }

        return {
          success: true,
          data: {
            sourceId,
            sourceContent: sourceEntry.content.slice(0, 80),
            linkedCount: createdLinks.length,
            links: createdLinks.map(l => ({
              linkId: l.id,
              targetId: l.targetId,
              description: l.description,
            })),
            notFoundIds: notFoundIds.length > 0 ? notFoundIds : undefined,
            message: `已连接 ${createdLinks.length} 条目标数据${notFoundIds.length > 0 ? `，${notFoundIds.length} 条未找到` : ''}`,
          },
        };
      }

      case 'get_card_links': {
        const entryId = String(args.entryId || '');
        if (!entryId) return { success: false, error: 'entryId 不能为空' };
        const depth = Math.max(1, Math.min(Number(args.depth) || 1, 5));  // 限制 1-5 级
        const direction = String(args.direction || 'all') as 'all' | 'outgoing' | 'incoming';
        const limitPerLevel = Math.max(1, Math.min(Number(args.limit) || 50, 200));

        // 验证起始条目存在
        const startEntry = await db.getEntryById(entryId);
        if (!startEntry) {
          return { success: false, error: `条目 ${entryId} 不存在` };
        }

        // BFS 遍历
        const visited = new Set<string>([entryId]);  // 已访问的条目 ID
        const allLinks: { linkId: string; sourceId: string; targetId: string; description?: string; level: number }[] = [];
        const allEntries: { id: string; content: string; source?: string; level: number }[] = [
          { id: entryId, content: startEntry.content.slice(0, 100), source: startEntry.source, level: 0 },
        ];
        let currentLevel = 0;
        let currentFrontier: string[] = [entryId];

        while (currentLevel < depth && currentFrontier.length > 0) {
          const nextFrontier: string[] = [];
          for (const currentNode of currentFrontier) {
            // 获取该节点的所有连线
            const links = await db.getLinksByEntryId(currentNode);
            let addedThisLevel = 0;
            for (const link of links) {
              // 方向过滤
              const isOutgoing = link.sourceId === currentNode;
              const isIncoming = link.targetId === currentNode;
              if (direction === 'outgoing' && !isOutgoing) continue;
              if (direction === 'incoming' && !isIncoming) continue;

              // 确定对端节点
              const otherId = isOutgoing ? link.targetId : link.sourceId;
              if (visited.has(otherId)) continue;  // 避免环
              if (addedThisLevel >= limitPerLevel) break;

              visited.add(otherId);
              addedThisLevel++;
              allLinks.push({
                linkId: link.id,
                sourceId: link.sourceId,
                targetId: link.targetId,
                description: link.description,
                level: currentLevel + 1,
              });

              // 加载对端条目信息
              const otherEntry = await db.getEntryById(otherId);
              if (otherEntry) {
                allEntries.push({
                  id: otherEntry.id,
                  content: otherEntry.content.slice(0, 100),
                  source: otherEntry.source,
                  level: currentLevel + 1,
                });
              }
              nextFrontier.push(otherId);
            }
          }
          currentFrontier = nextFrontier;
          currentLevel++;
        }

        return {
          success: true,
          data: {
            startEntry: {
              id: entryId,
              content: startEntry.content.slice(0, 100),
            },
            depth,
            direction,
            totalLinks: allLinks.length,
            totalEntries: allEntries.length - 1,  // 减去起始条目
            links: allLinks,
            entries: allEntries,
            message: `查询完成：共 ${allLinks.length} 条连线，${allEntries.length - 1} 个关联条目（${depth} 级深度）`,
          },
        };
      }

      case 'create_todo': {
        const title = String(args.title || '');
        if (!title) return { success: false, error: 'title 不能为空' };

        const now = Date.now();
        const folderDate = String(args.folderDate || new Date().toISOString().slice(0, 10));
        const note = String(args.note || '');
        const timeParsed = parseIsoTime(args.time, 'time');
        if (timeParsed.error) {
          return { success: false, error: timeParsed.error };
        }
        const startTime = timeParsed.ts;

        const newTodo = await todoDb.createTodo({
          title,
          note: note || undefined,
          status: 'pending',
          startTime,
          isToday: false,
          createdAt: now,
          updatedAt: now,
          folderDate,
        });

        // 处理标签
        const tags = args.tags as string[] | undefined;
        if (tags && Array.isArray(tags)) {
          const allTags = await todoDb.getAllTodoTags();
          const tagIds: string[] = [];
          for (const tagName of tags) {
            let tag = allTags.find((t: any) => t.name === tagName);
            if (!tag) {
              tag = await todoDb.createTodoTag(tagName, DEFAULT_TODO_TAG_COLOR);
            }
            tagIds.push(tag.id);
          }
          if (tagIds.length > 0) {
            await todoDb.setTodoTags(newTodo.id, tagIds);
          }
        }

        await useTodoStore.getState().loadAllTodos();
        await useTodoTagStore.getState().loadTags();

        return {
          success: true,
          data: {
            id: newTodo.id,
            title,
            note: note || null,
            folderDate,
            startTime: startTime || null,
            tags: tags || [],
            message: '待办已创建',
          },
        };
      }

      case 'search_todos': {
        const query = String(args.query || '');
        const folderDate = String(args.folderDate || '');
        const isDone = args.isDone as boolean | undefined;
        const tagNames = (args.tags as string[]) || [];
        const limit = Number(args.limit) || 20;

        let results = await todoDb.getAllTodos();

        if (query) {
          const lower = query.toLowerCase();
          results = results.filter((t: Todo) =>
            t.title.toLowerCase().includes(lower) ||
            (t.note && t.note.toLowerCase().includes(lower))
          );
        }
        if (folderDate) {
          results = results.filter((t: Todo) => t.folderDate === folderDate);
        }
        if (isDone !== undefined) {
          results = results.filter((t: Todo) => (t.status === 'done') === isDone);
        }
        if (tagNames.length > 0) {
          const allTags = await todoDb.getAllTodoTags();
          const tagIds = tagNames.map(n => allTags.find((t: any) => t.name === n)?.id).filter(Boolean) as string[];
          if (tagIds.length > 0) {
            results = results.filter((t: Todo) =>
              t.tagIds?.some(id => tagIds.includes(id))
            );
          }
        }

        return {
          success: true,
          data: {
            total: results.length,
            results: results.slice(0, limit).map((t: Todo) => ({
              id: t.id,
              title: t.title,
              note: t.note ? (t.note.length > 100 ? t.note.slice(0, 100) + '…' : t.note) : null,
              folderDate: t.folderDate,
              startTime: t.startTime || null,
              status: t.status,
            })),
          },
        };
      }

      case 'search_memos': {
        const query = String(args.query || '').toLowerCase();
        const limit = Number(args.limit) || 10;
        const all = await getAllMemos();
        const filtered = query
          ? all.filter(m =>
              m.title.toLowerCase().includes(query) ||
              m.content.toLowerCase().includes(query))
          : all;
        return {
          success: true,
          data: {
            total: filtered.length,
            results: filtered.slice(0, limit).map(m => ({
              id: m.id,
              title: m.title,
              excerpt: m.content.replace(/\s+/g, ' ').slice(0, 120),
              updatedAt: m.updatedAt,
            })),
            message: `找到 ${filtered.length} 篇备忘录`,
          },
        };
      }

      case 'read_memo': {
        const memoId = String(args.memoId || '');
        if (!memoId) return { success: false, error: 'memoId 不能为空' };
        const memo = await getMemo(memoId);
        if (!memo) return { success: false, error: `备忘录 ${memoId} 不存在` };
        const truncated = memo.content.length > 4000;
        return {
          success: true,
          data: {
            id: memo.id,
            title: memo.title,
            content: truncated ? memo.content.slice(0, 4000) + '\n…(内容过长已截断)' : memo.content,
            updatedAt: memo.updatedAt,
            truncated,
          },
        };
      }

      case 'create_memo': {
        const content = String(args.content || '');
        let title = String(args.title || '');
        if (!title) {
          const m = content.match(/^#\s+(.+)$/m);
          title = m ? m[1].trim() : '未命名';
        }
        const memo = await createMemo(title, content);
        broadcastMemosChanged();
        return {
          success: true,
          data: {
            id: memo.id,
            title: memo.title,
            message: '备忘录已创建',
          },
        };
      }

      case 'append_memo': {
        const memoId = String(args.memoId || '');
        const content = String(args.content || '');
        if (!memoId) return { success: false, error: 'memoId 不能为空' };
        if (!content) return { success: false, error: 'content 不能为空' };
        const memo = await getMemo(memoId);
        if (!memo) return { success: false, error: `备忘录 ${memoId} 不存在` };
        const joiner = memo.content.trim().length > 0 ? '\n\n' : '';
        await saveMemo({ ...memo, content: memo.content + joiner + content });
        broadcastMemosChanged();
        return {
          success: true,
          data: {
            id: memoId,
            title: memo.title,
            message: '内容已追加到备忘录末尾',
          },
        };
      }

      case 'update_memo': {
        const memoId = String(args.memoId || '');
        const content = String(args.content || '');
        if (!memoId) return { success: false, error: 'memoId 不能为空' };
        const memo = await getMemo(memoId);
        if (!memo) return { success: false, error: `备忘录 ${memoId} 不存在` };
        const title = typeof args.title === 'string' && args.title ? args.title : memo.title;
        await saveMemo({ ...memo, content, title });
        broadcastMemosChanged();
        return {
          success: true,
          data: {
            id: memoId,
            title,
            message: '备忘录已覆写（原内容已被替换）',
          },
        };
      }

      case 'delete_memo': {
        const memoIds = toStringArray(args.memoIds ?? args.memoId);
        if (memoIds.length === 0) return { success: false, error: 'memoIds 不能为空' };

        const deleted: string[] = [];
        const notFound: string[] = [];
        for (const memoId of memoIds) {
          const memo = await getMemo(memoId);
          if (!memo) { notFound.push(memoId); continue; }
          await deleteMemo(memoId);
          deleted.push(memoId);
        }
        if (deleted.length > 0) broadcastMemosChanged();

        return {
          success: deleted.length > 0,
          error: deleted.length === 0 ? '没有找到可删除的备忘录' : undefined,
          data: {
            deletedCount: deleted.length,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已删除 ${deleted.length} 篇备忘录`,
          },
        };
      }

      // ==================== 长期记忆（v2.11.0）====================

      case 'save_ai_memory': {
        const content = String(args.content || '');
        const result = saveMemory(content, 'ai');
        if (!result.success || !result.memory) {
          return { success: false, error: result.error || '保存失败' };
        }
        return {
          success: true,
          data: {
            id: result.memory.id,
            content: result.memory.content,
            message: `已记住：${result.memory.content}`,
          },
        };
      }

      case 'list_ai_memories': {
        const memories = listMemories();
        return {
          success: true,
          data: {
            total: memories.length,
            memories: memories.map(m => ({
              id: m.id,
              content: m.content,
              source: m.source === 'user' ? '用户手动添加' : 'AI 保存',
              updatedAt: m.updatedAt,
            })),
            message: memories.length > 0
              ? `共 ${memories.length} 条长期记忆`
              : '暂无长期记忆',
          },
        };
      }

      case 'update_ai_memory': {
        const memoryId = String(args.memoryId || '');
        if (!memoryId) return { success: false, error: 'memoryId 不能为空' };
        const content = String(args.content || '');
        const result = updateMemory(memoryId, content);
        if (!result.success || !result.memory) {
          return { success: false, error: result.error || '更新失败' };
        }
        return {
          success: true,
          data: {
            id: result.memory.id,
            content: result.memory.content,
            message: `已更新记忆：${result.memory.content}`,
          },
        };
      }

      case 'delete_ai_memory': {
        const memoryIds = toStringArray(args.memoryIds ?? args.memoryId);
        if (memoryIds.length === 0) return { success: false, error: 'memoryIds 不能为空' };
        const deleted: string[] = [];
        const notFound: string[] = [];
        for (const id of memoryIds) {
          if (deleteMemory(id)) deleted.push(id);
          else notFound.push(id);
        }
        return {
          success: deleted.length > 0,
          error: deleted.length === 0 ? '没有找到要删除的记忆' : undefined,
          data: {
            deletedCount: deleted.length,
            notFoundIds: notFound.length > 0 ? notFound : undefined,
            message: `已删除 ${deleted.length} 条长期记忆`,
          },
        };
      }

      default:
        return { success: false, error: `未知工具: ${toolName}` };
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * 将工具结果格式化为 OpenAI 规范的 tool 角色消息（用于追加到 messages 数组）。
 * 字段说明：
 * - role: 'tool'
 * - tool_call_id: 对应触发本次执行的 tool_call.id
 * - content: 给模型看的执行结果文本
 *
 * 即使失败也用 role: 'tool'（在 content 里说明错误），不要用 'system' 等其他角色，
 * 否则 OpenAI/DeepSeek 会拒绝请求。
 */
export function formatToolResultMessage(
  result: ToolResult,
  toolCallId: string,
): { role: 'tool'; tool_call_id: string; content: string } {
  const content = result.success
    ? JSON.stringify({ success: true, data: result.data })
    : JSON.stringify({ success: false, error: result.error });
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  };
}

/**
 * 将工具结果格式化为 UI 展示用的简短摘要（用于聊天界面上的 tool 气泡）。
 */
export function formatToolResultForUI(result: ToolResult, toolName: string): string {
  if (!result.success) {
    return `❌ ${toolName} 执行失败：${result.error}`;
  }
  return `✅ ${toolName} 执行成功：${JSON.stringify(result.data)}`;
}
