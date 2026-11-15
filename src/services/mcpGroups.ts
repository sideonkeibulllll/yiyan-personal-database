/**
 * MCP 分组（v3.6.0）
 *
 * 背景：Chat 的 MCP 面板原本把 4 个组硬编码在 ChatInputArea 里，加一个工具组就得改组件；
 * 工具涨到 30+ 之后也没法按自己的用法组合（比如「写作三件套」= 搜索卡片 + 读备忘录 + 提示词）。
 *
 * 设计边界（很重要）：
 * - 分组只是**选择层的视图**。真正决定发给模型什么工具的，仍然是
 *   session.mcpEnabledTools 这个扁平数组——所以改分组、删分组都不可能改坏运行时。
 * - `visible` = 该组是否启用（未启用的组不出现在 Chat 面板，等于整组下线）。
 * - 新对话永远是「零工具」起步，与分组配置无关（要靠用户自己在面板里点）。
 * - 内置组不可删除（可以停用、可以改工具集），自定义组随便删。
 * - 配置存在 settings.ai.mcpGroups；undefined 表示「从未配置过」→ 用本文件的内置定义。
 */
import type { McpGroupConfig } from '@/types';
import { ENTRY_TOOLS, MEMO_TOOLS, PROMPT_TOOLS, SOUL_TOOLS, TODO_TOOLS } from './chatBridge';

/** 出厂分组：与 v3.5.x 硬编码在 ChatInputArea 的 4 组保持一致，另加提示词组。
 *
 * 出厂全部启用（visible: true），新对话仍不带任何工具。
 */
export const DEFAULT_MCP_GROUPS: McpGroupConfig[] = [
  {
    id: 'entry',
    label: '数据卡片',
    icon: '📊',
    desc: '搜索 / 创建 / 编辑 / 标签 / 星标 / 删除',
    tools: [...ENTRY_TOOLS],
    builtin: true,
    visible: true,
  },
  {
    id: 'todo',
    label: '待办事项',
    icon: '✅',
    desc: '搜索 / 创建 / 编辑 / 完成 / 删除 / 标签管理',
    tools: [...TODO_TOOLS],
    builtin: true,
    visible: true,
  },
  {
    id: 'memo',
    label: '备忘录',
    icon: '📝',
    desc: '搜索 / 读取 / 新建 / 追加 / 删除',
    tools: [...MEMO_TOOLS],
    builtin: true,
    visible: true,
  },
  {
    id: 'soul',
    label: 'Soul 事实档案',
    icon: '🪞',
    desc: '让 AI 查看事实库并提议变更（需你确认）',
    tools: [...SOUL_TOOLS],
    builtin: true,
    visible: true,
  },
  {
    id: 'prompt',
    label: '提示词库',
    icon: '📋',
    desc: '列目录 / 读全文 / 新建或改写（改写需你确认）',
    tools: [...PROMPT_TOOLS],
    builtin: true,
    visible: true,
  },
];

/** 全部已知工具名（用于清洗脏数据、以及「全选」） */
export const ALL_MCP_TOOLS: string[] = Array.from(
  new Set(DEFAULT_MCP_GROUPS.flatMap(g => g.tools)),
);

const KNOWN_TOOL_SET = new Set(ALL_MCP_TOOLS);

function cloneGroup(g: McpGroupConfig): McpGroupConfig {
  return { ...g, tools: [...g.tools] };
}

/** 只保留已知工具名并去重（版本升级后删掉的工具不会变成幽灵工具） */
function sanitizeTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return Array.from(new Set(tools.filter((t): t is string => typeof t === 'string' && KNOWN_TOOL_SET.has(t))));
}

/**
 * 把 settings 里存的配置解析成完整分组列表。
 *
 * 合并规则：
 * - 内置组永远按 DEFAULT 的顺序出现在前面（用户改过的字段覆盖默认值，id 不丢）；
 * - 用户自己加的组按存储顺序跟在后面；
 * - 存的是空数组/非法值 → 视为「从未配置」，直接返回出厂定义。
 */
export function resolveMcpGroups(raw?: McpGroupConfig[] | null): McpGroupConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_MCP_GROUPS.map(cloneGroup);

  const byId = new Map<string, McpGroupConfig>();
  for (const g of raw) {
    if (g && typeof g.id === 'string') byId.set(g.id, g);
  }

  const merged: McpGroupConfig[] = [];
  for (const def of DEFAULT_MCP_GROUPS) {
    const saved = byId.get(def.id);
    if (!saved) {
      merged.push(cloneGroup(def));
      continue;
    }
    byId.delete(def.id);
    merged.push({
      id: def.id,
      label: (saved.label || def.label).trim(),
      icon: saved.icon || def.icon,
      desc: saved.desc ?? def.desc,
      tools: sanitizeTools(saved.tools),
      builtin: true,
      visible: saved.visible !== false,
    });
  }

  for (const saved of byId.values()) {
    merged.push({
      id: saved.id,
      label: (saved.label || '自定义组').trim(),
      icon: saved.icon || '🧩',
      desc: saved.desc,
      tools: sanitizeTools(saved.tools),
      builtin: false,
      visible: saved.visible !== false,
    });
  }

  return merged;
}

/** Chat 面板要渲染的组（未启用的组不出现，其工具也就无从勾选） */
export function visibleMcpGroups(raw?: McpGroupConfig[] | null): McpGroupConfig[] {
  return resolveMcpGroups(raw).filter(g => g.visible);
}

/** 生成自定义组的 id（g_ 前缀，避免和内置 id 撞） */
export function newCustomGroupId(): string {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
