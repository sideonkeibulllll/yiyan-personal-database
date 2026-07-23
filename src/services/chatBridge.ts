/**
 * Chat Bridge — MCP 风格的底层框架桥梁通道
 * 
 * 提供 AI 在对话中操作记忆库的能力：
 * - 创建卡片（条目）— 支持内容/来源/补充/标签/组/星标
 * - 搜索卡片 — 支持关键字/标签/组筛选，返回结果列表
 * - 编辑组 — 设置或移除组归属
 * - 编辑标签 — 添加或移除标签
 * 
 * 工作原理：
 * 1. 用户通过 MCP 面板选择要注入的工具信息
 * 2. 选中的工具定义注入系统提示词
 * 3. AI 回复中使用 <tool> XML 标签调用工具
 * 4. 流式结束后解析工具调用，执行操作，将结果作为 tool_result 消息追加
 * 5. AI 在下一轮对话中可以看到工具结果
 */

import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import type { Entry, Todo } from '@/types';

/** 工具定义 */
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
    name: 'edit_group',
    description: '编辑条目的所属组。可以设置或移除组归属。',
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: '条目ID' },
        groupName: { type: 'string', description: '组名称（留空表示移除组归属）' },
      },
      required: ['entryId'],
    },
  },
  {
    name: 'edit_tags',
    description: '编辑条目的标签。可以添加或移除标签。',
    parameters: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: '条目ID' },
        addTags: { type: 'array', items: { type: 'string' }, description: '要添加的标签名列表' },
        removeTags: { type: 'array', items: { type: 'string' }, description: '要移除的标签名列表' },
      },
      required: ['entryId'],
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
        time: { type: 'string', description: '待办时间，ISO 8601 格式或自然语言如"明天下午3点"（可选）' },
        folderDate: { type: 'string', description: '所在日期文件夹，YYYY-MM-DD 格式（可选，默认今天）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签名列表（可选）' },
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
    name: 'complete_todo',
    description: '将一条待办标记为已完成或重新激活。',
    parameters: {
      type: 'object',
      properties: {
        todoId: { type: 'string', description: '待办ID' },
        uncomplete: { type: 'boolean', description: '如果为 true 则重新激活，默认 false' },
      },
      required: ['todoId'],
    },
  },
];

/** 所有工具名称 */
export const ALL_TOOL_NAMES = BRIDGE_TOOLS.map(t => t.name);

/** 按类型分组的工具名 */
export const ENTRY_TOOLS = ['create_card', 'search_cards', 'edit_group', 'edit_tags'];
export const TODO_TOOLS = ['create_todo', 'search_todos', 'complete_todo'];

/** 生成工具定义的系统提示词片段（只包含选中的工具） */
export function getToolsSystemPrompt(enabledTools: string[]): string {
  const tools = BRIDGE_TOOLS.filter(t => enabledTools.includes(t.name));
  if (tools.length === 0) return '';

  const toolsDesc = tools.map(t => {
    const params = Object.entries(t.parameters.properties)
      .map(([key, val]) => `${key}(${val.type}): ${val.description}`)
      .join(', ');
    const required = t.parameters.required.length > 0 ? `\n  必填: ${t.parameters.required.join(', ')}` : '';
    return `- ${t.name}: ${t.description}\n  参数: ${params}${required}`;
  }).join('\n');

  return `
你可以使用以下工具操作用户的记忆库：

${toolsDesc}

## 工具调用格式
当你需要调用工具时，在回复中独占一行使用以下 XML 格式：
<tool name="工具名">{"参数名": "值"}</tool>

示例：
<tool name="create_card">{"content": "今天学到了 MCP 协议", "tags": ["学习", "MCP"]}</tool>

<tool name="search_cards">{"query": "MCP", "limit": 5}</tool>

## 规则
1. 工具调用必须独占一行
2. 一次只能调用一个工具
3. 调用工具后，系统会执行操作并在下一轮对话中返回结果
4. 如果用户没有明确要求操作记忆库，不要主动调用工具
5. 可以在普通回复中混合工具调用
`;
}

/** 解析 AI 回复中的工具调用 */
export interface ParsedToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  beforeText: string;
  afterText: string;
}

export function parseToolCall(response: string): ParsedToolCall | null {
  const regex = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/;
  const match = response.match(regex);
  if (!match) return null;

  const toolName = match[1];
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(match[2].trim());
  } catch {
    args = {};
  }

  const matchStart = match.index ?? 0;
  const beforeText = response.slice(0, matchStart).trim();
  const afterText = response.slice(matchStart + match[0].length).trim();

  return {
    toolName,
    arguments: args,
    beforeText,
    afterText,
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
            results: results.slice(0, limit).map(e => ({
              id: e.id,
              content: e.content.length > 200 ? e.content.slice(0, 200) + '…' : e.content,
              source: e.source,
              isStarred: e.isStarred,
              createdAt: e.createdAt,
            })),
          },
        };
      }

      case 'edit_group': {
        const entryId = String(args.entryId || '');
        if (!entryId) return { success: false, error: 'entryId 不能为空' };

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

        await db.updateEntry(entryId, { groupId: groupId || undefined });
        await useEntryStore.getState().loadEntries();

        return {
          success: true,
          data: {
            entryId,
            groupName: groupName || '(已移除)',
            message: '组已更新',
          },
        };
      }

      case 'edit_tags': {
        const entryId = String(args.entryId || '');
        if (!entryId) return { success: false, error: 'entryId 不能为空' };

        const addTags = (args.addTags as string[]) || [];
        const removeTags = (args.removeTags as string[]) || [];
        const allTags = await db.getAllTags();

        for (const tagName of addTags) {
          let tag = allTags.find(t => t.name === tagName);
          if (!tag) {
            tag = await db.createTag(tagName);
          }
          await db.addTagToEntry(entryId, tag.id);
        }

        for (const tagName of removeTags) {
          const tag = allTags.find(t => t.name === tagName);
          if (tag) {
            await db.removeTagFromEntry(entryId, tag.id);
          }
        }

        await useTagStore.getState().loadTags();
        await useEntryStore.getState().loadEntries();

        return {
          success: true,
          data: {
            entryId,
            addedTags: addTags,
            removedTags: removeTags,
            message: '标签已更新',
          },
        };
      }

      case 'complete_todo': {
        const todoId = String(args.todoId || '');
        if (!todoId) return { success: false, error: 'todoId 不能为空' };
        const uncomplete = Boolean(args.uncomplete);

        if (uncomplete) {
          await todoDb.updateTodo(todoId, { status: 'pending', completedAt: undefined });
        } else {
          await todoDb.updateTodo(todoId, { status: 'done', completedAt: Date.now() });
        }
        await useTodoStore.getState().loadAllTodos();

        return {
          success: true,
          data: {
            todoId,
            action: uncomplete ? '重新激活' : '标记完成',
            message: '待办状态已更新',
          },
        };
      }

      case 'create_todo': {
        const title = String(args.title || '');
        if (!title) return { success: false, error: 'title 不能为空' };

        const now = Date.now();
        const folderDate = String(args.folderDate || new Date().toISOString().slice(0, 10));
        const note = String(args.note || '');
        const timeStr = String(args.time || '');
        let startTime: number | undefined;
        if (timeStr) {
          const parsed = Date.parse(timeStr);
          if (!isNaN(parsed)) startTime = parsed;
        }

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
              tag = await todoDb.createTodoTag(tagName, '#4dabf7');
            }
            tagIds.push(tag.id);
          }
          if (tagIds.length > 0) {
            await todoDb.setTodoTags(newTodo.id, tagIds);
          }
        }

        await useTodoStore.getState().loadAllTodos();

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

/** 将工具结果格式化为 AI 可读的字符串 */
export function formatToolResult(result: ToolResult): string {
  if (!result.success) {
    return `<tool_result success="false" error="${result.error}" />`;
  }

  return `<tool_result success="true">${JSON.stringify(result.data)}</tool_result>`;
}
