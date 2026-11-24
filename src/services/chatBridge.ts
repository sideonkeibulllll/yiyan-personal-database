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
 * - Soul 事实档案（v3.4.0）：AI 提议变更（add/update/retire 变更组；确认卡片展示理由+逐项变更+更新后画像，用户确认后写入）+ 只读 list_soul_facts
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

import {
  listWorks, listWorkFiles, readWorkText, writeWorkText, writeWorkBinary,
  deleteWorkFile, createWork, renameWork, deleteWork, workExists, entryNameFor,
  readWorkTextRange, copyWorkFile, setWorkCover, sanitizeRelPath,
} from './workLibrary';
import { applyEdits, describeEditFailure, EDIT_MAX_PER_FILE } from './workPatch';
import { parseCoverMeta } from '@/utils/workCover';
import { includesWholeWord, isAsciiWordQuery } from '@/utils/workSearch';
import { isUploadPath, readUploadBase64, readUploadText } from './chatUploads';
import { bytesToBase64, drawTraeImage } from './traeImage';
import { buildWorkCatalog } from './workCatalog';
import { WORK_AI_GUIDE } from '@/utils/workAiBridge';
import { fetchPageText, searchWeb } from './webSearch';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { getAllMemos, getMemo, createMemo, saveMemo, deleteMemo } from '@/services/memoDatabase';
import { broadcastMemosChanged } from '@/services/memoEvents';
import { listMemories, saveMemory, updateMemory, deleteMemory } from '@/services/aiMemory';
import { createPrompt, getPrompt, listPromptsSorted, updatePrompt } from '@/services/promptLibrary';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Entry, Todo, Link, TodoTag, WebSearchEngineId } from '@/types';
import { splitKeywords, rankAndFilter, relevanceScore } from '@/utils/searchRank';
import { localDateKey } from '@/utils/localDate';
import {
  applySoulChanges,
  countSoulChanges,
  isSoulFactCategory,
  listSoulFacts,
  parseSoulChanges,
  previewSoulChanges,
  renderSoulPortraitForFacts,
} from '@/services/soulFacts';

/** 把单值 / 数组参数统一成字符串数组 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/* === v4.2.1: 作品内搜索的词边界（实现在 utils/workSearch.ts，纯函数可单测） === */

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
  // 纯日期（YYYY-MM-DD）按本地 00:00 解析：
  // Date.parse 规范会把纯日期当 UTC 午夜，北京时间下会偏成当天 08:00
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnly) {
    const y = Number(dateOnly[1]), m = Number(dateOnly[2]), d = Number(dateOnly[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      return { ts: dt.getTime() };
    }
  }
  const parsed = Date.parse(str);
  if (isNaN(parsed)) {
    return { error: `${fieldName} 无法解析："${str}"。请使用 ISO 8601 格式（如 2026-10-11T15:00:00+08:00）` };
  }
  return { ts: parsed };
}

/** 工具参数属性（v3.4.0：items 支持一层嵌套对象——update_soul 的变更组用） */
export interface ToolProperty {
  type: string;
  description: string;
  items?: {
    type: string;
    properties?: Record<string, ToolProperty>;
    required?: string[];
  };
}

/** 工具元数据（仅用于内部描述，传给 API 时由 buildToolsPayload 转换） */
export interface BridgeTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolProperty>;
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
    description: '搜索记忆库中的卡片。支持关键字搜索、按标签筛选、按组筛选，结果按相关度排序。建议提供具体关键词；无任何条件的空搜索不会返回结果。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（可选但强烈建议提供；多个词用空格分隔，需全部命中）' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签名筛选（可选）' },
        groupName: { type: 'string', description: '按组名筛选（可选）' },
        isStarred: { type: 'boolean', description: '只看星标（可选）' },
        limit: { type: 'number', description: '返回数量上限，默认 8，最大 20' },
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
    description: '搜索待办事项。支持关键字搜索、按标签筛选、按日期筛选、按完成状态筛选，结果按相关度排序。建议提供具体关键词；仅想了解今天安排时请用 get_today_todos。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（可选但强烈建议；多个词用空格分隔，需全部命中）' },
        tags: { type: 'array', items: { type: 'string' }, description: '按标签名筛选（可选）' },
        folderDate: { type: 'string', description: '按日期筛选，YYYY-MM-DD 格式（可选）' },
        isDone: { type: 'boolean', description: '按完成状态筛选（可选）' },
        limit: { type: 'number', description: '返回数量上限，默认 10，最大 30' },
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
    description: '搜索备忘录。支持关键字搜索标题与正文，返回备忘录列表（含 ID、标题、摘要、更新时间）。必须提供搜索关键词。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键字（必填；多个词用空格分隔，需全部命中）' },
        limit: { type: 'number', description: '返回数量上限，默认 6，最大 20' },
      },
      required: ['query'],
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
  // === Soul 事实库 MCP 工具（v3.4.0）===
  // 结构化事实的增改废；属重要操作，执行前由界面层弹确认卡片（展示理由 + 逐项变更 + 更新后画像）。
  {
    name: 'update_soul',
    description: '提议变更「Soul 事实档案」——用户本人的长期事实库（记录身份/处境/状态/目标/经历，聊天与「怕了么」都会读取渲染后的画像）。当你发现关于用户的持久事实有新增、变化或过时时使用。\n只记「事实与状态」：不要记录指令、偏好或倾向（凡是「替 AI 决定怎么回应 / 怎么对待用户」的内容一律不写；「喜欢/讨厌某事物」这类倾向也不要写）。没有重要信息就不要调用，不要频繁提议。\n可以用 add 新增、update 修改、retire 废除（事实不再成立时；软删除保留历史）——一次调用可组合多项，等于一组变更、一张确认卡。不确定现状时先调用 list_soul_facts 查看。\n这是重要操作：系统会先向用户弹出确认卡片（展示 reason、逐项变更与更新后画像），用户确认后才写入，取消则不生效。',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '为什么变更、改了哪些（一两句话，会展示给用户看）' },
        add: {
          type: 'array',
          description: '新增的事实（每项一条独立事实，≤200 字）',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '事实正文（≤200 字）' },
              category: { type: 'string', description: '分类：identity 身份 / situation 处境 / state 状态 / goal 目标 / history 经历（默认 situation）' },
            },
            required: ['content'],
          },
        },
        update: {
          type: 'array',
          description: '修改现有事实（factId 与 matchText 二选一；matchText 须是现有事实中逐字出现且唯一的片段）',
          items: {
            type: 'object',
            properties: {
              factId: { type: 'string', description: '事实 ID（先用 list_soul_facts 获取）' },
              matchText: { type: 'string', description: '要修改的原文片段（唯一匹配；与 factId 二选一）' },
              content: { type: 'string', description: '改后的完整新内容' },
              category: { type: 'string', description: '可选：同时改分类' },
            },
            required: ['content'],
          },
        },
        retire: {
          type: 'array',
          description: '废除不再成立的事实（软删除，保留历史）',
          items: {
            type: 'object',
            properties: {
              factId: { type: 'string', description: '事实 ID（与 matchText 二选一）' },
              matchText: { type: 'string', description: '要废除的原文片段（唯一匹配）' },
            },
          },
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'list_soul_facts',
    description: '查看「Soul 事实档案」的全部事实（含 ID、分类、时间），只读、无副作用。修改或废除事实前先用它获取 factId 与原文。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '可选：只看某一类（identity/situation/state/goal/history）' },
        keyword: { type: 'string', description: '可选：按关键词过滤正文' },
      },
      required: [],
    },
  },
  {
    name: 'list_prompts',
    description: '查看「提示词库」目录（v3.6.0）。返回每条的 id、名称、场景、字数、使用次数，**不含正文**（单条正文常有一两千字，不要一次全读）。\n找提示词、确认某条是否存在、或想在回答里引用某条时先用它，再按需用 get_prompt 取全文。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '可选：按关键词过滤（匹配名称 / 场景 / 正文）' },
        includeArchived: { type: 'boolean', description: '可选：是否包含已归档的条目（默认 false）' },
      },
      required: [],
    },
  },
  {
    name: 'get_prompt',
    description: '读取一条提示词的完整正文（按 id 或标题定位，标题需唯一匹配）。只在确实需要原文时调用——如果用户只是问「有哪些提示词」，用 list_prompts 就够。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '提示词 id（与 title 二选一）' },
        title: { type: 'string', description: '提示词名称（与 id 二选一）' },
      },
      required: [],
    },
  },
  {
    name: 'save_prompt',
    description: '在「提示词库」里新建或改写一条提示词。传 id（或用 title 精确命中已有条目）= 改写，否则新建。\n只在用户明确要求「把这段存成提示词 / 改一下那条提示词」时使用：提示词是用户的长期资产，不要把闲聊结论或临时内容擅自塞进库里。\ncontent 必须是可直接拿来用的完整正文，不要加「以下是提示词」之类的包装、不要在正文里加解释。\n这是重要操作：系统会先弹确认卡片展示名称/场景/字数与覆盖情况，用户确认后才写入。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '可选：要改写的条目 id（不传则按 title 匹配或新建）' },
        title: { type: 'string', description: '提示词名称（列表与胶囊上显示的就是它）' },
        scene: { type: 'string', description: '可选：一句话场景说明（列表副标题）' },
        content: { type: 'string', description: '完整提示词正文（原样保存，不做变量替换）' },
      },
      required: ['title', 'content'],
    },
  },
  /* === v3.8.0: 文件与作品（一个作品 = 一个文件夹，入口 index.html / index.md / …） === */
  {
    name: 'list_works',
    description: '列出「文件与作品」里的全部作品：入口文件、是否网页、文件数、字节数、修改时间、**封面**（cover + coverSource）。想知道有哪些作品、哪个有封面、某作品存不存在时先调它。\n默认 cover 只认 mod.json 与约定的 cover.jpg/png（不读 html，快）；要把入口 html 里的 <meta name="cover"> 也算进来就传 with_cover_meta: true（会多读几次 html，作品多时慢一点）。',
    parameters: {
      type: 'object',
      properties: {
        with_cover_meta: { type: 'boolean', description: '可选：连 html <meta name="cover"> 一起解析（默认 false，省 IO）' },
      },
      required: [],
    },
  },
  {
    name: 'create_work',
    description: '新建一个作品（自动建文件夹与入口文件）。html 作品入口固定 index.html，md 笔记入口 index.md。也可以直接 write_file 写 index.html——作品不存在时会自动创建。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '作品名（沿用文件名风格，如 记账本.html 或 note.md）' },
        entry_content: { type: 'string', description: '入口文件初始内容（可选，默认空）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'rename_work',
    description: '重命名一个作品（连同它的全部文件一起改）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '原作品名' },
        new_name: { type: 'string', description: '新作品名' },
      },
      required: ['name', 'new_name'],
    },
  },
  {
    name: 'delete_work',
    description: '删除整个作品（含它的全部文件、版本快照与应用数据）。破坏性操作：系统会先弹确认卡片，用户确认后才真正删除。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '作品名' } },
      required: ['name'],
    },
  },
  {
    name: 'list_files',
    description: '列出某个作品内的全部文件（相对路径、字节数、修改时间）。',
    parameters: {
      type: 'object',
      properties: { work: { type: 'string', description: '作品名' } },
      required: ['work'],
    },
  },
  {
    name: 'read_file',
    description: '读取作品内某个文本文件（超过 20 万字符会截断并在结果里标注）。文件很大时用 offset/limit 按行读——不确定内容在哪，先用 search_in_work 定位行号再读那一段，别一上来读整本。图片不要用它读。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        path: { type: 'string', description: '相对路径，如 index.html 或 app.css' },
        offset: { type: 'number', description: '可选：起始行号（1-based），传了就按行读' },
        limit: { type: 'number', description: '可选：最多返回多少行，默认 400，最大 2000' },
      },
      required: ['work', 'path'],
    },
  },
  {
    name: 'write_file',
    description: '**新建**作品文件，或整体重写一个文件（同路径即覆盖）。**不需要用户确认**。\n⚠️ 改已有文件不要用它——用 edit_file 做局部替换；只有「整页重构 / 整份换掉」才用 write_file 重写全文。\n【封面】不要为了封面去改 html：画好图（draw_image）或把图搬进来（copy_file）之后，调 set_cover 写 mod.json 就行。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名（不存在会自动创建）' },
        path: { type: 'string', description: '相对路径，如 index.html、app.css' },
        content: { type: 'string', description: '完整文件内容（原样写入，不做转义）' },
      },
      required: ['work', 'path', 'content'],
    },
  },
  {
    name: 'write_image',
    description: '把一张 base64 图片写进作品文件夹（已有图片数据时用）。文生图请用 draw_image。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        path: { type: 'string', description: '相对路径，如 cover.jpg 或 assets/a.png' },
        base64: { type: 'string', description: '图片字节的 base64（不要 data: 前缀）' },
      },
      required: ['work', 'path', 'base64'],
    },
  },
  {
    name: 'delete_file',
    description: '删除作品内的一个文件。破坏性操作：系统会先弹确认卡片，用户确认后才真正删除。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        path: { type: 'string', description: '相对路径' },
      },
      required: ['work', 'path'],
    },
  },
  /* === v4.0.0: 批量写文件 + 生成目录页（让 AI 也能铺开多文件作品） === */
  {
    name: 'write_files',
    description: '一次写入多个文本文件（write_file 的批量版）。**做多文件作品就用它**：index.html + app.css + app.js + 子目录页面一次交齐。路径支持子目录（如 pages/a.html），目录会自动创建。\n批量上限 12 个文件 / 整批约 30 万字符，更大的作品分几批写。写完建议调 build_catalog 生成目录页。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名（不存在会自动创建）' },
        files: {
          type: 'array',
          description: '要写入的文件数组，按顺序写',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对路径，如 index.html 或 pages/a.html' },
              content: { type: 'string', description: '完整文件内容（原样写入，不做转义）' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['work', 'files'],
    },
  },
  /* === v4.2.0: 局部编辑 / 搜索 / 复制 / 封面声明（治「加一行也要重写全文」） === */
  {
    name: 'edit_file',
    description: '局部修改作品里的文本文件——只给「原文片段」和「替换成什么」，**不重写整份文件**。改已有文件一律优先用它：加一行 meta、改个颜色、调个函数、换句文案，都别用 write_file 把全文重打一遍（长文件重打必漏行）。\n规则：find 必须在文件里恰好出现 1 次；出现 0 次或多次会失败并回传附近行号，照着文件里的真实内容（含缩进、标点）多带 2~4 行上下文再试。要批量替换同一片段（如全站换字）就显式传 all: true。一个文件的多处 edits 按顺序应用；**任何一处失败整批都不写入**（原子），不会留下改了一半的文件。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        files: {
          type: 'array',
          description: '要修改的文件（最多 12 个），每个文件可带多处编辑（最多 10 处）',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对路径，如 index.html' },
              edits: {
                type: 'array',
                description: '按顺序应用的替换列表',
                items: {
                  type: 'object',
                  properties: {
                    find: { type: 'string', description: '要替换的原文（带上下文保证唯一；不要写省略号）' },
                    replace: { type: 'string', description: '替换成的内容（空字符串 = 删掉这段）' },
                    all: { type: 'boolean', description: 'true 表示允许 find 出现多次并全部替换（默认 false）' },
                  },
                  required: ['find', 'replace'],
                },
              },
            },
            required: ['path', 'edits'],
          },
        },
      },
      required: ['work', 'files'],
    },
  },
  {
    name: 'search_in_work',
    description: '在作品里搜文本，返回「文件:行号: 内容」。想改某个东西但不确定在哪、或文件很大不想通读时，**先搜再改**（比 read_file 读全文省得多）。默认忽略大小写：ASCII 词（如 cover、flex）走**整词匹配**——不会再把 discover / recovered 这种半截词捞进来；中文照旧按子串。传 regex: true 按正则解析；想强制关掉整词（搜子串）传 whole_word: false。同一个文件最多回 8 条，免得一个文件吃满名额。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        query: { type: 'string', description: '要找的内容（纯文本或正则）' },
        path: { type: 'string', description: '可选：只搜这个文件（相对路径）' },
        regex: { type: 'boolean', description: '按正则表达式匹配（默认 false）' },
        whole_word: { type: 'boolean', description: '可选：true 强制整词、false 强制子串；不传则 ASCII 词自动整词、中文自动子串' },
        max: { type: 'number', description: '最多返回多少条，默认 30，最大 80' },
      },
      required: ['work', 'query'],
    },
  },
  {
    name: 'read_upload',
    description: '按行读用户这次对话上传的文件（本地副本，路径形如 chat-files/…，聊天消息里会给）。聊天里的大文件只贴了开头，要看具体内容时用它；只是想把文件原样放进作品就直接 copy_file，不用读。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本地副本路径（chat-files/…）' },
        offset: { type: 'number', description: '起始行号，1-based，默认 1' },
        limit: { type: 'number', description: '最多返回多少行，默认 400，最大 2000' },
      },
      required: ['path'],
    },
  },
  {
    name: 'copy_file',
    description: '把已有文件**原样复制**进作品（字节级搬运，不经过你的输出，也不占上下文）。用户说「把刚上传的文件/图片放进作品」「把 A 作品里的图搬到 B」时**必须**用它——绝不要用 write_file 重新打一遍内容。\n源有两种：source="upload" + path（聊天消息里给出的 chat-files/… 路径）；source="work" + from_work + path（另一个作品里的文件）。默认不覆盖已有文件（重名会报错并给建议名），确实要覆盖传 overwrite: true。',
    parameters: {
      type: 'object',
      properties: {
        to_work: { type: 'string', description: '目标作品名（不存在会自动创建）' },
        files: {
          type: 'array',
          description: '要复制的文件列表（最多 12 个）',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'upload（聊天上传缓存）或 work（另一个作品）' },
              path: { type: 'string', description: '源文件路径：upload 用 chat-files/…；work 用作品内相对路径' },
              from_work: { type: 'string', description: 'source=work 时的源作品名' },
              as: { type: 'string', description: '可选：目标相对路径。不传则用原文件名放在作品根目录' },
              overwrite: { type: 'boolean', description: '目标已存在时是否覆盖（默认 false）' },
            },
            required: ['source', 'path'],
          },
        },
      },
      required: ['to_work', 'files'],
    },
  },
  {
    name: 'set_cover',
    description: '给作品设封面：只写 mod.json 的 cover 字段，**不动任何 html**。封面图必须是作品里已有的图片（先用 draw_image 画一张，或用 copy_file 把用户上传的图搬进来）。path 传空字符串表示取消封面。作品列表的封面优先级：mod.json > 入口 html 的 <meta name="cover"> > 约定文件名 cover.jpg/png。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        path: { type: 'string', description: '作品内图片相对路径（如 cover.jpg、assets/a.png）；空字符串取消封面' },
      },
      required: ['work', 'path'],
    },
  },
  {
    name: 'build_catalog',
    description: '给作品生成 / 更新目录页（入口页）。扫描作品内全部 html，按目录分组列成「卡片 + 搜索框」的页面，写成 index.html（这个名字被占用时退到 _index.html），同时写入 mod.json。\n写完多个页面后调它一次，散页面就变成结构完整的作品包；重复调用会原地更新同一张目录页，不会越堆越多。页面少于 2 个时不需要调。',
    parameters: {
      type: 'object',
      properties: {
        work: { type: 'string', description: '作品名' },
        featured: { type: 'string', description: '可选：把哪个页面置顶高亮（相对路径）。不传则自动判断' },
        description: { type: 'string', description: '可选：目录页顶部的一句话说明' },
      },
      required: ['work'],
    },
  },
  /* === v3.8.0: 画图（TRAE 文生图，约 8.8 积分/张，自动走积分最多的账号） === */
  {
    name: 'draw_image',
    description: '文生图并直接存进作品文件夹（TRAE seedream，1920x1920 约 8.8 积分/张，走账号倾向里积分最多的号）。画完返回保存路径。典型用法：给作品画封面——存成 cover.jpg，然后调 set_cover 设成封面（**不要**去改 html）。同一 prompt 有缓存不会重复扣费。纯几何/图标请直接写 SVG/CSS，别浪费积分。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述（英文更稳：主体、风格、光线、构图、白底等）' },
        work: { type: 'string', description: '保存到哪个作品' },
        path: { type: 'string', description: '保存的相对路径，默认 assets/gen-<时间>.jpg；画封面建议 cover.jpg' },
        image_size: { type: 'string', description: '尺寸，默认 1920x1920（像素下限）；也可用 2k/3k/4k' },
      },
      required: ['prompt', 'work'],
    },
  },
  /* === v3.6.7: 联网搜索（引擎由设置决定：秘塔 / DeepSeek 官方 Search） === */
  {
    name: 'web_search',
    description: '搜索互联网，返回标题、摘要和链接。用于获取实时或你不确定的信息（新闻、天气、价格、版本、赛事、政策、人物近况等）。搜索词要简洁具体，支持 site: / lang:zh / after:2025 等运算符。结果只是摘要，回答时请附来源链接；需要读某条结果的正文再用 web_fetch。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（如「原神 7.2 版本上线时间」）' },
        count: { type: 'number', description: '返回条数 1-8，默认 5' },
        ori_question: { type: 'string', description: '可选：用户的原始问题，帮助搜索引擎理解意图' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: '抓取一个网页并返回正文（最多约 6000 字）。用于 web_search 之后核实细节、读公告 / 文档 / 文章。只支持 http/https 公网地址。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '网页地址（http/https）' },
        max_chars: { type: 'number', description: '正文截断长度，默认 5000，最大 8000' },
      },
      required: ['url'],
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
/** Soul 事实库工具（v3.4.0）：走 MCP 组勾选（与数据卡片/待办/备忘录同机制） */
export const SOUL_TOOLS = [
  'update_soul',
  'list_soul_facts',
];
/** 提示词库工具（v3.6.0）：列目录 / 读全文 / 新建或改写；save_prompt 走危险确认 */
export const PROMPT_TOOLS = [
  'list_prompts',
  'get_prompt',
  'save_prompt',
];
/** 文件与作品工具（v3.8.0，v4.2.0 加局部编辑/搜索/复制/封面声明）：删除类需确认 */
export const FILE_TOOLS = [
  'list_works',
  'create_work',
  'rename_work',
  'delete_work',
  'list_files',
  'read_file',
  'write_file',
  'write_files',
  'edit_file',
  'search_in_work',
  'read_upload',
  'copy_file',
  'set_cover',
  'build_catalog',
  'write_image',
  'delete_file',
];
/** 画图工具（v3.8.0）：TRAE 文生图落盘（花积分，走账号倾向） */
export const IMAGE_TOOLS = [
  'draw_image',
];
/** 联网工具（v3.6.7）：搜索 / 抓网页正文；引擎在设置里选，不做自动降级 */
export const WEB_TOOLS = [
  'web_search',
  'web_fetch',
];

/**
 * 需要用户确认后才执行的重要/危险工具。
 * 删除类：展示「将删除什么」摘要；
 * update_soul：展示理由 + 逐项变更 + 更新后画像预览（见 describeToolPreview）；
 * save_prompt：展示名称/场景/字数与「新建还是覆盖哪一条」。
 */
export const DANGEROUS_TOOLS = new Set(['delete_card', 'delete_todo', 'delete_memo', 'delete_todo_tag', 'delete_ai_memory', 'update_soul', 'save_prompt', 'delete_file', 'delete_work']);

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
  update_soul: '更新人格档案',
  list_prompts: '查看提示词库', get_prompt: '读取提示词', save_prompt: '保存提示词',
  list_works: '查看作品列表', create_work: '新建作品', rename_work: '重命名作品', delete_work: '删除作品',
  list_files: '列出作品文件', read_file: '读取文件', write_file: '写入文件', write_files: '批量写入文件',
  edit_file: '局部修改文件', search_in_work: '作品内搜索', read_upload: '读取上传文件',
  copy_file: '复制文件进作品', set_cover: '设置作品封面',
  build_catalog: '生成目录页', write_image: '写入图片',
  delete_file: '删除文件', draw_image: '绘制图片',
  web_search: '联网搜索', web_fetch: '读取网页',
};

/**
 * 生成危险操作的确认摘要（展示在对话内的确认卡片上）。
 */
/** save_prompt 的目标解析：显式 id 优先，其次按标题命中已有条目（用于「新建还是覆盖」判断） */
function resolvePromptTarget(args: Record<string, unknown>) {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (id) return getPrompt(id);
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  return title ? getPrompt(title) : null;
}

export function describeToolAction(toolName: string, args: Record<string, unknown>): string {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === 'string' && v ? 1 : 0);
  switch (toolName) {
    case 'delete_card': return `删除 ${count(args.entryIds)} 条数据卡片`;
    case 'delete_todo': return `删除 ${count(args.todoIds)} 条待办`;
    case 'delete_memo': return `删除 ${count(args.memoIds)} 篇备忘录`;
    case 'delete_ai_memory': return `删除 ${count(args.memoryIds ?? args.memoryId)} 条长期记忆`;
    case 'delete_file': return `删除「${String(args.work || '未命名')}」里的文件「${String(args.path || '')}」`;
    case 'delete_work': return `删除整个作品「${String(args.name || '未命名')}」（含全部文件与数据）`;
    case 'save_prompt': {
      const title = String(args.title || '').trim() || '未命名提示词';
      const chars = String(args.content || '').length;
      const target = resolvePromptTarget(args);
      return target
        ? `改写提示词「${title}」（${chars} 字，将覆盖原有「${target.title}」）`
        : `新建提示词「${title}」（${chars} 字）`;
    }
    case 'update_soul': {
      const reason = String(args.reason || '').trim();
      const counts = countSoulChanges(parseSoulChanges(args));
      const parts: string[] = [];
      if (counts.add) parts.push(`新增 ${counts.add} 条`);
      if (counts.update) parts.push(`修改 ${counts.update} 条`);
      if (counts.retire) parts.push(`废除 ${counts.retire} 条`);
      const action = parts.length > 0 ? parts.join(' · ') : '调整';
      return reason
        ? `更新你的人格档案（Soul）：${action}。理由：${reason}`
        : `更新你的人格档案（Soul）：${action}`;
    }
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
 * 生成确认卡片的「内容预览」（可选；界面层折叠展示）。
 * 目前仅 update_soul 使用：展示逐项变更清单 + 更新后的画像（注入态预览）。
 */
export function describeToolPreview(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'update_soul') {
    const outcome = previewSoulChanges(parseSoulChanges(args));
    const changed = outcome.added + outcome.updated + outcome.retired;
    if (changed === 0 && outcome.errors.length > 0) {
      return `⚠️ 本次变更无法执行：\n${outcome.errors.map(e => `· ${e}`).join('\n')}`;
    }
    const lines: string[] = ['【本次变更】'];
    for (const d of outcome.details) lines.push(`· ${d}`);
    if (outcome.errors.length > 0) {
      lines.push('【以下操作无法执行】');
      for (const e of outcome.errors) lines.push(`· ⚠️ ${e}`);
    }
    lines.push('');
    lines.push('——— 更新后画像（注入态预览）———');
    lines.push(renderSoulPortraitForFacts(outcome.next, 'chat') ?? '（暂无事实）');
    return lines.join('\n');
  }
  if (toolName === 'save_prompt') {
    const title = String(args.title || '').trim() || '未命名提示词';
    const scene = String(args.scene || '').trim();
    const content = String(args.content || '');
    const target = resolvePromptTarget(args);
    const lines: string[] = [];
    lines.push(target
      ? `【改写已有条目】${target.title}（原 ${target.content.length} 字）→ 新 ${content.length} 字`
      : `【新建条目】${title}（${content.length} 字）`);
    lines.push(`名称：${title}`);
    if (scene) lines.push(`场景：${scene}`);
    lines.push('');
    lines.push('——— 正文（前 300 字）———');
    lines.push(content.slice(0, 300) + (content.length > 300 ? '\n…（已截断）' : ''));
    return lines.join('\n');
  }
  return undefined;
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

/**
 * 联网搜索的引擎与 Key（v3.6.7）。
 *
 * 引擎完全由设置决定（不做自动降级）；DeepSeek Key 与「当前激活的提供商」无关：
 * 哪怕聊天走 TRAE / GLM，只要设置里存过 DeepSeek Key 就能用官方 Search / Fetch
 * （5 元 / 千次成功请求 ≈ 0.5 分/次）。
 */
function resolveWebSearchOptions(): {
  engine: WebSearchEngineId;
  metasoKey: string;
  deepseekKey: string;
} {
  const ai = useSettingsStore.getState().settings.ai;
  const configured = (ai.providers?.deepseek?.apiKey ?? '').trim();
  const legacy = ai.provider === 'deepseek' ? (ai.apiKey ?? '').trim() : '';
  return {
    engine: ai.webSearch?.engine ?? 'metaso',
    metasoKey: (ai.webSearch?.metasoKey ?? '').trim(),
    deepseekKey: configured.length > 0 ? configured : legacy,
  };
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
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));

        // 空条件不再放行全量（避免把整个库塞进上下文）
        if (!query && !groupName && isStarred === undefined && tagNames.length === 0) {
          return {
            success: true,
            data: {
              total: 0,
              results: [],
              message: '未提供搜索条件。请提供 query（关键词）或 tags / groupName / isStarred 进行筛选。',
            },
          };
        }

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

        // 关键字搜索（db.searchEntries 已带相关度排序：位置 / 次数 / 字段权重 + 星标与新鲜度微调）
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

        const total = results.length;
        const page = results.slice(0, limit);
        return {
          success: true,
          data: {
            total,
            returned: page.length,
            results: await Promise.all(page.map(async e => {
              const links = await db.getLinksByEntryId(e.id);
              const imageCount = e.attachments?.length ?? 0;
              return {
                id: e.id,
                content: e.content.length > 120 ? e.content.slice(0, 120) + '…' : e.content,
                source: e.source || undefined,
                isStarred: e.isStarred,
                linkCount: links.length,
                // v3.5.3: 让模型知道这条卡带图（图片本身不进上下文；
                // 需要看图时由用户手动发送，或向用户说明）
                ...(imageCount > 0 ? { images: imageCount } : {}),
              };
            })),
            ...(total > page.length
              ? { hint: `仅返回最相关的 ${page.length} 条（共匹配 ${total} 条）。需要更多结果时，请用更具体的关键词或 tags 筛选。` }
              : {}),
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
        // 本地日期（北京时间）；曾用 toISOString().slice(0,10) 取「今天」→ 凌晨 0-8 点会错成昨天
        const today = localDateKey();
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
        // 本地日期（北京时间）；曾用 toISOString().slice(0,10) → 凌晨创建的待办会落进昨天文件夹
        const folderDate = String(args.folderDate || localDateKey());
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
        const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));

        // 空条件不再放行全量（查看今天安排请用 get_today_todos）
        if (!query && !folderDate && isDone === undefined && tagNames.length === 0) {
          return {
            success: true,
            data: {
              total: 0,
              results: [],
              message: '未提供搜索条件。请提供 query（关键词）或 folderDate / tags / isDone 筛选；查看今天的安排请用 get_today_todos。',
            },
          };
        }

        let results = await todoDb.getAllTodos();

        // 多关键词（空格分隔，AND 语义）+ 相关度排序（与全站搜索一致）
        const keywords = query ? splitKeywords(query) : [];
        if (keywords.length > 0) {
          const lowered = keywords.map(k => k.toLowerCase());
          results = results.filter((t: Todo) =>
            lowered.every(kw =>
              t.title.toLowerCase().includes(kw) ||
              (t.note && t.note.toLowerCase().includes(kw))
            )
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

        const total = results.length;
        const ranked = keywords.length > 0
          ? rankAndFilter(results, (t: Todo) => relevanceScore(
              [
                { text: t.title, weight: 100 },
                { text: t.note || undefined, weight: 55 },
              ],
              keywords,
              { timestamp: t.updatedAt || t.createdAt },
            ))
          : results;
        const page = ranked.slice(0, limit);

        return {
          success: true,
          data: {
            total,
            returned: page.length,
            results: page.map((t: Todo) => ({
              id: t.id,
              title: t.title,
              note: t.note ? (t.note.length > 80 ? t.note.slice(0, 80) + '…' : t.note) : null,
              folderDate: t.folderDate,
              startTime: t.startTime || null,
              status: t.status,
            })),
            ...(total > page.length
              ? { hint: `仅返回最相关的 ${page.length} 条（共匹配 ${total} 条）。需要更多结果时，请用更具体的关键词或筛选条件。` }
              : {}),
          },
        };
      }

      case 'search_memos': {
        const query = String(args.query || '');
        const limit = Math.min(20, Math.max(1, Number(args.limit) || 6));
        const keywords = splitKeywords(query);

        if (keywords.length === 0) {
          return {
            success: true,
            data: { total: 0, results: [], message: '请提供搜索关键词（query）。' },
          };
        }

        const all = await getAllMemos();
        const lowered = keywords.map(k => k.toLowerCase());
        const filtered = all.filter(m =>
          lowered.every(kw =>
            m.title.toLowerCase().includes(kw) ||
            m.content.toLowerCase().includes(kw)
          )
        );
        // 多关键词（AND 语义）+ 相关度排序（标题权重高于正文）
        const ranked = rankAndFilter(filtered, m => relevanceScore(
          [
            { text: m.title, weight: 100 },
            { text: m.content, weight: 70 },
          ],
          keywords,
          { timestamp: m.updatedAt },
        ));
        const total = ranked.length;
        const page = ranked.slice(0, limit);

        return {
          success: true,
          data: {
            total,
            returned: page.length,
            results: page.map(m => ({
              id: m.id,
              title: m.title,
              excerpt: m.content.replace(/\s+/g, ' ').slice(0, 100),
              updatedAt: m.updatedAt,
            })),
            ...(total > page.length
              ? { hint: `仅返回最相关的 ${page.length} 篇（共匹配 ${total} 篇）。需要更多时请用更具体的关键词。` }
              : {}),
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

      case 'update_soul': {
        // 注意：本 case 只有在用户于确认卡片点击「确认执行」后才会被走到
        //（update_soul 已加入 DANGEROUS_TOOLS，ChatPage 会先 requestConfirm）。
        const outcome = applySoulChanges(parseSoulChanges(args), 'ai');
        if (!outcome.applied) {
          return {
            success: false,
            error: outcome.errors[0] || '没有可应用的变更（请检查 add/update/retire 参数）',
            data: { errors: outcome.errors.length > 0 ? outcome.errors : undefined },
          };
        }
        return {
          success: true,
          data: {
            added: outcome.added,
            updated: outcome.updated,
            retired: outcome.retired,
            totalActive: listSoulFacts().length,
            skipped: outcome.errors.length > 0 ? outcome.errors : undefined,
            message: `已更新人格档案：新增 ${outcome.added} 条 · 修改 ${outcome.updated} 条 · 废除 ${outcome.retired} 条`,
          },
        };
      }

      case 'list_soul_facts': {
        const category = typeof args.category === 'string' ? args.category.trim() : '';
        const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
        let facts = listSoulFacts();
        if (category && isSoulFactCategory(category)) {
          facts = facts.filter(f => f.category === category);
        }
        if (keyword) {
          facts = facts.filter(f => f.content.toLowerCase().includes(keyword));
        }
        return {
          success: true,
          data: {
            total: facts.length,
            facts: facts.map(f => ({
              id: f.id,
              content: f.content,
              category: f.category,
              updatedAt: localDateKey(new Date(f.updatedAt)),
            })),
            hint: facts.length === 0
              ? '档案里还没有事实（或没有符合过滤条件的事实）；可用 update_soul 的 add 提议新增'
              : undefined,
          },
        };
      }

      case 'list_prompts': {
        const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
        const includeArchived = args.includeArchived === true;
        let prompts = listPromptsSorted({ includeArchived });
        if (keyword) {
          prompts = prompts.filter(p =>
            p.title.toLowerCase().includes(keyword) ||
            (p.scene ?? '').toLowerCase().includes(keyword) ||
            p.content.toLowerCase().includes(keyword),
          );
        }
        const total = prompts.length;
        const page = prompts.slice(0, 30);
        return {
          success: true,
          data: {
            total,
            returned: page.length,
            prompts: page.map(p => ({
              id: p.id,
              title: p.title,
              scene: p.scene,
              chars: p.content.length,
              useCount: p.useCount ?? 0,
              ...(p.archived ? { archived: true } : {}),
            })),
            hint: total === 0
              ? '提示词库没有匹配项；可以在「设置 → 提示词库」新建，或让用户自己点「导入内置」'
              : total > page.length
                ? `共 ${total} 条，只返回前 ${page.length} 条；要正文请用 get_prompt`
                : '目录不含正文；需要某条原文时用 get_prompt（传 id 或标题），不要凭名称猜内容',
          },
        };
      }

      case 'get_prompt': {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        const titleArg = typeof args.title === 'string' ? args.title.trim() : '';
        const found = getPrompt(id || titleArg);
        if (!found) {
          return {
            success: false,
            error: `没找到这条提示词（${id || titleArg || '参数为空'}）；先用 list_prompts 看目录`,
          };
        }
        return {
          success: true,
          data: {
            id: found.id,
            title: found.title,
            scene: found.scene,
            chars: found.content.length,
            updatedAt: localDateKey(new Date(found.updatedAt)),
            content: found.content,
          },
        };
      }

      case 'save_prompt': {
        // 只有用户在确认卡片点了「确认执行」才会走到这里（save_prompt 在 DANGEROUS_TOOLS 里）
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        const content = typeof args.content === 'string' ? args.content : '';
        const scene = typeof args.scene === 'string' ? args.scene.trim() : undefined;
        if (!title || !content.trim()) {
          return { success: false, error: 'title 与 content 都必填' };
        }
        const target = resolvePromptTarget(args);
        if (target) {
          const next = updatePrompt(target.id, {
            title,
            content,
            ...(scene !== undefined ? { scene } : {}),
          });
          if (!next) return { success: false, error: '改写失败：条目已不存在' };
          return {
            success: true,
            data: {
              id: next.id,
              title: next.title,
              chars: next.content.length,
              mode: 'updated',
              message: `已改写提示词「${next.title}」（${next.content.length} 字）`,
            },
          };
        }
        const created = createPrompt({ title, content, scene });
        return {
          success: true,
          data: {
            id: created.id,
            title: created.title,
            chars: created.content.length,
            mode: 'created',
            message: `已新建提示词「${created.title}」（${created.content.length} 字）`,
          },
        };
      }

      case 'list_works': {
        const works = await listWorks();
        const withMeta = args.with_cover_meta === true;
        // v4.2.1：把封面带出来（mod.json / 约定名零额外 IO；html meta 只在显式要求时补读）
        let metaScanned = 0;
        const items = await Promise.all(works.map(async w => {
          let cover = w.cover;
          let coverSource: 'manifest' | 'file' | 'meta' | null = w.coverSource;
          if (!cover && withMeta && w.entry && /\.html?$/i.test(w.entry) && metaScanned < 20) {
            metaScanned += 1;
            try {
              const entryText = await readWorkText(w.name, w.entry);
              const fromMeta = entryText ? parseCoverMeta(entryText.text) : null;
              if (fromMeta && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(fromMeta)) {
                cover = fromMeta;
                coverSource = 'meta';
              }
            } catch {
              /* 单个失败不影响列表 */
            }
          }
          return {
            name: w.name,
            entry: w.entry ?? undefined,
            isHtml: w.isHtml,
            files: w.fileCount,
            bytes: w.size,
            mtime: w.mtime || undefined,
            cover: cover ?? undefined,
            coverSource: coverSource ?? undefined,
          };
        }));
        const withoutCover = items.filter(item => !item.cover).length;
        return {
          success: true,
          data: {
            total: items.length,
            works: items,
            hint: items.length === 0
              ? '还没有作品；可以 create_work 新建，或 write_file 直接写 index.html'
              : (withoutCover > 0 && !withMeta
                ? `${withoutCover} 个作品没有声明封面（cover 只认 mod.json 与 cover.jpg/png；html 里写 <meta name="cover"> 的要传 with_cover_meta: true 才看得到）`
                : undefined),
          },
        };
      }
      case 'create_work': {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return { success: false, error: 'name 必填' };
        const content = typeof args.entry_content === 'string' ? args.entry_content : '';
        const entry = entryNameFor(name);
        const saved = await createWork(name, entry, content);
        return {
          success: true,
          data: { name: saved, entry, message: `已创建作品「${saved}」（入口 ${entry}）` },
        };
      }
      case 'rename_work': {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        const newName = typeof args.new_name === 'string' ? args.new_name.trim() : '';
        if (!name || !newName) return { success: false, error: 'name / new_name 必填' };
        const saved = await renameWork(name, newName);
        return { success: true, data: { name: saved, message: `已改名为「${saved}」` } };
      }
      case 'delete_work': {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) return { success: false, error: 'name 必填' };
        await deleteWork(name);
        return { success: true, data: { name, message: `已删除作品「${name}」` } };
      }
      case 'list_files': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        if (!work) return { success: false, error: 'work 必填' };
        const files = await listWorkFiles(work);
        return {
          success: true,
          data: {
            work,
            total: files.length,
            files: files.map(f => ({ path: f.path, bytes: f.size, mtime: f.mtime || undefined })),
            hint: files.length === 0 ? '这个作品还没有文件；用 write_file 写 index.html 吧' : undefined,
          },
        };
      }
      case 'read_file': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        if (!work || !path) return { success: false, error: 'work / path 必填' };
        // v4.2.0：带 offset/limit 就按行读（大文件别整本灌进上下文）
        const rawOffset = Number(args.offset);
        const rawLimit = Number(args.limit);
        if (Number.isFinite(rawOffset) || Number.isFinite(rawLimit)) {
          const slice = await readWorkTextRange(
            work,
            path,
            Number.isFinite(rawOffset) ? rawOffset : 1,
            Number.isFinite(rawLimit) ? rawLimit : 400,
          );
          if (!slice) return { success: false, error: `文件不存在：${work}/${path}` };
          return {
            success: true,
            data: {
              name: work,
              path: slice.path,
              offset: slice.offset,
              lines: slice.lines,
              totalLines: slice.totalLines,
              chars: slice.chars,
              content: slice.text,
            },
          };
        }
        const file = await readWorkText(work, path);
        if (!file) return { success: false, error: `文件不存在：${work}/${path}` };
        return {
          success: true,
          data: {
            name: work,
            path: file.path,
            chars: file.text.length,
            truncated: file.truncated,
            content: file.text,
          },
        };
      }
      case 'write_file': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        const content = typeof args.content === 'string' ? args.content : '';
        if (!work || !path) return { success: false, error: 'work / path 必填' };
        if (!content.trim()) return { success: false, error: 'content 不能为空' };
        const existed = (await listWorkFiles(work)).some(f => f.path === path.replace(/\\/g, '/').replace(/^\/+/, ''));
        const saved = await writeWorkText(work, path, content, { reason: 'ai' });
        return {
          success: true,
          data: {
            name: work,
            path: saved,
            chars: content.length,
            mode: existed ? 'overwritten' : 'created',
            message: `${existed ? '已覆盖' : '已创建'}「${saved}」（${content.length} 字）`,
            aiGuide: /\.html?$/i.test(saved) ? WORK_AI_GUIDE : undefined,
          },
        };
      }
      case 'write_image': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        let base64 = typeof args.base64 === 'string' ? args.base64.trim() : '';
        if (!work || !path) return { success: false, error: 'work / path 必填' };
        if (!base64) return { success: false, error: 'base64 必填' };
        base64 = base64.replace(/^data:[^,]*,/, '');
        const saved = await writeWorkBinary(work, path, base64);
        return { success: true, data: { name: work, path: saved, message: `图片已写入「${saved}」` } };
      }
      case 'delete_file': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        if (!work || !path) return { success: false, error: 'work / path 必填' };
        await deleteWorkFile(work, path);
        return { success: true, data: { name: work, path, message: `已删除「${work}/${path}」` } };
      }
      case 'write_files': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        if (!work) return { success: false, error: 'work 必填' };
        const rawList = Array.isArray(args.files) ? (args.files as Array<Record<string, unknown>>) : [];
        if (rawList.length === 0) return { success: false, error: 'files 不能为空' };
        if (rawList.length > 12) {
          return { success: false, error: `一次最多 12 个文件，当前 ${rawList.length} 个，请分批发` };
        }
        const existing = new Set((await listWorkFiles(work)).map(f => f.path));
        const written: Array<{ path: string; chars: number; mode: string }> = [];
        const failed: Array<{ path: string; error: string }> = [];
        let totalChars = 0;
        for (const item of rawList) {
          const path = typeof item.path === 'string' ? item.path.trim() : '';
          const content = typeof item.content === 'string' ? item.content : '';
          if (!path) { failed.push({ path: '(空)', error: 'path 为空' }); continue; }
          if (!content.trim()) { failed.push({ path, error: 'content 为空' }); continue; }
          if (totalChars + content.length > 300_000) {
            failed.push({ path, error: '整批内容超过 30 万字符，请分批发' });
            break;
          }
          try {
            await writeWorkText(work, path, content, { reason: 'ai' });
            totalChars += content.length;
            written.push({
              path: path.replace(/\\/g, '/').replace(/^\/+/, ''),
              chars: content.length,
              mode: existing.has(path) ? 'overwritten' : 'created',
            });
          } catch (err) {
            failed.push({ path, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return {
          success: written.length > 0,
          data: {
            name: work,
            written: written.length,
            totalChars,
            files: written,
            failed: failed.length > 0 ? failed : undefined,
            message: `已写入 ${written.length} 个文件（${totalChars} 字）${failed.length ? `，${failed.length} 个失败` : ''}`,
            hint: '多个页面写完后可以调 build_catalog 生成目录页',
            aiGuide: written.some((f) => /\.html?$/i.test(f.path)) ? WORK_AI_GUIDE : undefined,
          },
          ...(written.length === 0 ? { error: '一个文件都没写成功' } : {}),
        };
      }
      case 'edit_file': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        if (!work) return { success: false, error: 'work 必填' };
        const rawFiles = Array.isArray(args.files) ? (args.files as Array<Record<string, unknown>>) : [];
        if (rawFiles.length === 0) return { success: false, error: 'files 不能为空' };
        if (rawFiles.length > 12) {
          return { success: false, error: `一次最多改 12 个文件，当前 ${rawFiles.length} 个，请分批发` };
        }

        const changed: Array<{
          path: string; edits: number; lines: number[]; charsBefore: number; charsAfter: number;
        }> = [];
        const failed: Array<{ path: string; error: string }> = [];
        let totalEdits = 0;

        for (const item of rawFiles) {
          const path = typeof item.path === 'string' ? item.path.trim() : '';
          const rawEdits = Array.isArray(item.edits) ? (item.edits as Array<Record<string, unknown>>) : [];
          if (!path) { failed.push({ path: '(空)', error: 'path 为空' }); continue; }
          if (rawEdits.length === 0) { failed.push({ path, error: 'edits 为空' }); continue; }
          if (rawEdits.length > EDIT_MAX_PER_FILE) {
            failed.push({ path, error: `单个文件最多 ${EDIT_MAX_PER_FILE} 处编辑，请拆分` });
            continue;
          }

          const file = await readWorkText(work, path);
          if (!file) { failed.push({ path, error: '文件不存在（新建文件请用 write_file / write_files）' }); continue; }

          const edits = rawEdits.map(edit => ({
            find: typeof edit.find === 'string' ? edit.find : '',
            replace: typeof edit.replace === 'string' ? edit.replace : '',
            all: edit.all === true,
          }));
          const result = applyEdits(file.text, edits);
          if (!result.ok) {
            failed.push({ path, error: describeEditFailure(result.failure) });
            continue;
          }
          if (result.text === file.text) { failed.push({ path, error: '替换后内容没有变化' }); continue; }

          await writeWorkText(work, path, result.text, { reason: 'ai' });
          totalEdits += result.applied.length;
          changed.push({
            path,
            edits: result.applied.length,
            lines: result.applied.flatMap(entry => entry.lines).slice(0, 20),
            charsBefore: result.before,
            charsAfter: result.after,
          });
        }

        if (changed.length === 0) {
          return {
            success: false,
            error: `一处都没改成：\n${failed.map(item => `· ${item.path}：${item.error}`).join('\n')}`,
          };
        }
        return {
          success: true,
          data: {
            name: work,
            files: changed,
            failed: failed.length > 0 ? failed : undefined,
            message: `改了 ${changed.length} 个文件、共 ${totalEdits} 处${failed.length > 0 ? `，${failed.length} 个失败` : ''}（没重写整份文件）`,
            hint: failed.length > 0
              ? '失败的都是原子作废的，按回执里的行号补上下文再调一次即可；已成功的不受影响'
              : undefined,
          },
        };
      }
      case 'search_in_work': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const query = typeof args.query === 'string' ? args.query : '';
        if (!work || !query) return { success: false, error: 'work / query 必填' };
        const only = typeof args.path === 'string' && args.path.trim()
          ? args.path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
          : '';
        const useRegex = args.regex === true;
        const rawMax = Number(args.max);
        const max = Number.isFinite(rawMax) ? Math.min(80, Math.max(1, Math.floor(rawMax))) : 30;

        let re: RegExp | null = null;
        if (useRegex) {
          try {
            re = new RegExp(query, 'i');
          } catch (err) {
            return { success: false, error: `正则无效：${(err as Error).message}` };
          }
        }
        // v4.2.1：ASCII 词默认整词匹配（治 discover / recovered 这种半截命中）
        const wholeWordArg = args.whole_word;
        const autoWholeWord = isAsciiWordQuery(query);
        const useWholeWord = !useRegex && (wholeWordArg === true || (wholeWordArg !== false && autoWholeWord));
        const mode: 'regex' | 'whole-word' | 'substring' = useRegex ? 'regex' : (useWholeWord ? 'whole-word' : 'substring');
        const needle = query.toLowerCase();
        const allFiles = await listWorkFiles(work);
        const targets = only ? allFiles.filter(file => file.path === only) : allFiles;
        if (targets.length === 0) return { success: false, error: `作品里没有这个文件：${only}` };

        /** 同一个文件最多回 8 条：否则一个 5000 行的 html 能把整页名额吃光 */
        const PER_FILE_MAX = 8;
        const hits: Array<{ path: string; line: number; text: string }> = [];
        let scanned = 0;
        let cappedFiles = 0;
        for (const file of targets) {
          if (hits.length >= max) break;
          // 二进制 / 超大文件跳过（搜了也没意义，还慢）
          if (/\.(png|jpe?g|gif|webp|bmp|ico|pdf|zip|gz|woff2?|ttf|otf|mp3|mp4|wav|webm)$/i.test(file.path)) continue;
          if (file.size > 2_000_000) continue;
          const content = await readWorkText(work, file.path);
          if (!content) continue;
          scanned += 1;
          const rows = content.text.split('\n');
          let fileHits = 0;
          for (let i = 0; i < rows.length && hits.length < max; i++) {
            const row = rows[i]!;
            const matched = re
              ? re.test(row)
              : (useWholeWord ? includesWholeWord(row, query) : row.toLowerCase().includes(needle));
            if (!matched) continue;
            if (fileHits >= PER_FILE_MAX) { cappedFiles += 1; break; }
            hits.push({ path: file.path, line: i + 1, text: row.trim().slice(0, 200) });
            fileHits += 1;
          }
        }
        return {
          success: true,
          data: {
            work,
            query,
            mode,
            hits,
            scanned,
            cappedFiles: cappedFiles > 0 ? cappedFiles : undefined,
            truncated: hits.length >= max,
            message: hits.length > 0
              ? `找到 ${hits.length} 处（扫了 ${scanned} 个文本文件，${mode === 'whole-word' ? '整词匹配' : mode === 'regex' ? '正则匹配' : '子串匹配'}）`
                + (cappedFiles > 0 ? `；有 ${cappedFiles} 个文件命中超过 ${PER_FILE_MAX} 条，只回了前 ${PER_FILE_MAX} 条 —— 缩小关键词或指定 path 更准` : '')
              : `没找到${mode === 'whole-word' ? '（当前是整词匹配，想搜子串就传 whole_word: false）' : ''}，换个更短的关键词试试`,
          },
        };
      }
      case 'read_upload': {
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        if (!path) return { success: false, error: 'path 必填' };
        if (!isUploadPath(path)) {
          return { success: false, error: '只能读聊天上传缓存（路径以 chat-files/ 开头，聊天消息里会给）' };
        }
        const rawOffset = Number(args.offset);
        const rawLimit = Number(args.limit);
        const slice = await readUploadText(
          path,
          Number.isFinite(rawOffset) ? rawOffset : 1,
          Number.isFinite(rawLimit) ? rawLimit : 400,
        );
        if (!slice) {
          return { success: false, error: `读不到：${path}（可能已被 60 天缓存清理，或不是文本文件）` };
        }
        return {
          success: true,
          data: {
            path: slice.path,
            offset: slice.offset,
            lines: slice.lines,
            totalLines: slice.totalLines,
            truncated: slice.truncated,
            content: slice.text,
          },
        };
      }
      case 'copy_file': {
        const toWork = typeof args.to_work === 'string' ? args.to_work.trim() : '';
        const rawList = Array.isArray(args.files) ? (args.files as Array<Record<string, unknown>>) : [];
        if (!toWork) return { success: false, error: 'to_work 必填' };
        if (rawList.length === 0) return { success: false, error: 'files 不能为空' };
        if (rawList.length > 12) return { success: false, error: `一次最多复制 12 个文件，请分批发` };

        const existing = new Set((await listWorkFiles(toWork)).map(file => file.path));
        const copied: Array<{ from: string; path: string; bytes: number; source: string }> = [];
        const failed: Array<{ path: string; error: string }> = [];

        for (const item of rawList) {
          const source = item.source === 'work' ? 'work' : 'upload';
          const path = typeof item.path === 'string' ? item.path.trim() : '';
          const fromWork = typeof item.from_work === 'string' ? item.from_work.trim() : '';
          const overwrite = item.overwrite === true;
          if (!path) { failed.push({ path: '(空)', error: 'path 为空' }); continue; }

          const baseName = path.replace(/\\/g, '/').split('/').pop() || 'file';
          const target = sanitizeRelPath(
            typeof item.as === 'string' && item.as.trim() ? item.as.trim() : baseName,
          );
          if (!target) { failed.push({ path, error: '目标路径为空' }); continue; }
          if (existing.has(target) && !overwrite) {
            failed.push({ path, error: `目标已存在：${target}（换个别名 as，或传 overwrite: true）` });
            continue;
          }

          if (source === 'work') {
            if (!fromWork) { failed.push({ path, error: 'source=work 时必须给 from_work' }); continue; }
            const hit = await copyWorkFile(fromWork, path, toWork, target);
            if (!hit) { failed.push({ path, error: `源文件不存在：${fromWork}/${path}` }); continue; }
            existing.add(target);
            copied.push({ from: hit.from, path: target, bytes: hit.bytes, source: 'work' });
            continue;
          }

          if (!isUploadPath(path)) {
            failed.push({ path, error: 'source=upload 的 path 必须是 chat-files/… （聊天消息里给的本地副本路径）' });
            continue;
          }
          const base64 = await readUploadBase64(path);
          if (!base64) { failed.push({ path, error: '读不到源文件（可能已被 60 天缓存清理）' }); continue; }
          await writeWorkBinary(toWork, target, base64);
          existing.add(target);
          copied.push({
            from: path,
            path: target,
            bytes: Math.floor((base64.length * 3) / 4),
            source: 'upload',
          });
        }

        if (copied.length === 0) {
          return {
            success: false,
            error: `一个都没复制成功：\n${failed.map(item => `· ${item.path}：${item.error}`).join('\n')}`,
          };
        }
        return {
          success: true,
          data: {
            name: toWork,
            copied,
            total: copied.length,
            failed: failed.length > 0 ? failed : undefined,
            message: `已原样复制 ${copied.length} 个文件进「${toWork}」（字节级，没经过重写）`,
          },
        };
      }
      case 'set_cover': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const path = typeof args.path === 'string' ? args.path.trim() : '';
        if (!work) return { success: false, error: 'work 必填' };
        if (path) {
          const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
          if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(clean)) {
            return { success: false, error: '封面必须是图片文件（png / jpg / webp / svg / bmp）' };
          }
          const files = await listWorkFiles(work);
          if (!files.some(file => file.path === clean)) {
            return { success: false, error: `作品里没有这个图片：${clean}（先用 draw_image 画，或 copy_file 把图搬进来）` };
          }
        }
        await setWorkCover(work, path || null);
        return {
          success: true,
          data: {
            name: work,
            cover: path || null,
            message: path
              ? `封面已设为「${path}」（写进 mod.json，html 一个字节都没动）`
              : '封面已取消',
          },
        };
      }
      case 'build_catalog': {
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        if (!work) return { success: false, error: 'work 必填' };
        const featured = typeof args.featured === 'string' && args.featured.trim() ? args.featured.trim() : undefined;
        const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : undefined;
        const result = await buildWorkCatalog(work, { featured, description });
        if (!result.ok) return { success: false, error: result.message };
        return {
          success: true,
          data: {
            name: work,
            entry: result.entry,
            pages: result.pages,
            files: result.files,
            overwritten: result.overwritten,
            message: result.message,
          },
        };
      }
      case 'draw_image': {
        const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const work = typeof args.work === 'string' ? args.work.trim() : '';
        const size = typeof args.image_size === 'string' && args.image_size.trim() ? args.image_size.trim() : '1920x1920';
        if (!prompt || !work) return { success: false, error: 'prompt / work 必填' };
        const path = typeof args.path === 'string' && args.path.trim()
          ? args.path.trim()
          : `assets/gen-${Date.now()}.jpg`;
        const result = await drawTraeImage({ prompt, imageSize: size });
        const saved = await writeWorkBinary(work, path, bytesToBase64(result.bytes));
        return {
          success: true,
          data: {
            name: work,
            path: saved,
            cached: result.cached,
            uid: result.uid,
            bytes: result.bytes.length,
            message: `${result.cached ? '命中缓存（未扣积分）' : '已生成'}「${saved}」`
              + `，账号 ${result.uid.slice(-6)}。要当封面就调 set_cover（work="${work}"，path="${path}"），不要改 html`,
          },
        };
      }

      /* === v3.6.7: 联网搜索 === */
      case 'web_search': {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) return { success: false, error: 'query 必填' };
        const rawCount = Number(args.count);
        const count = Number.isFinite(rawCount) ? Math.min(8, Math.max(1, Math.floor(rawCount))) : 5;
        const oriQuestion = typeof args.ori_question === 'string' ? args.ori_question.trim() : undefined;
        const outcome = await searchWeb(query, { ...resolveWebSearchOptions(), count, oriQuestion });
        return {
          success: true,
          data: {
            engine: outcome.engine,
            query: outcome.query,
            count: outcome.hits.length,
            results: outcome.hits,
            hint: outcome.hits.length === 0 ? '没有搜到结果，换个更具体的说法再试一次' : undefined,
          },
        };
      }
      case 'web_fetch': {
        const url = typeof args.url === 'string' ? args.url.trim() : '';
        if (!url) return { success: false, error: 'url 必填' };
        const rawMax = Number(args.max_chars);
        const maxChars = Number.isFinite(rawMax) ? Math.min(8000, Math.max(500, Math.floor(rawMax))) : 5000;
        const page = await fetchPageText(url, { ...resolveWebSearchOptions(), maxChars });
        return {
          success: true,
          data: {
            engine: page.engine,
            url: page.url,
            title: page.title.length > 0 ? page.title : undefined,
            chars: page.chars,
            truncated: page.truncated,
            text: page.text,
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
