/**
 * Chat 页面工具函数与常量
 */
import type { ChatSession } from './chatTypes';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS } from '@/types';

/** 旧 key，仅用于兼容性检查 */
const SESSIONS_KEY = 'yiyan_chat_sessions';

/** 同步加载会话：仅用于初始化 state，后续 useEffect 会从 DB 重新加载 */
export function loadSessionsSync(): ChatSession[] {
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

export function createId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function generateTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 20) return trimmed || '新对话';
  return trimmed.slice(0, 20) + '…';
}

/**
 * 模型选项（v2.5.1：支持跨提供商分组）。
 *
 * - `value` 为 `providerId::model` 复合键（选中后自动联动对应的 baseURL / apiKey）
 * - `group` 为分组标题（同一提供商的选项共享）
 * - 全局默认项 value 为 `''`
 */
export interface ModelOption {
  value: string;
  label: string;
  /** 分组标题（非空时该选项上方会渲染一条分组线） */
  group?: string;
}

/** 复合值的分隔符（模型名里不会出现，硅基流动用 `/`，这里用 `::`） */
const MODEL_SEP = '::';

/**
 * 生成跨提供商的模型选择器选项（按 provider 分组）。
 *
 * v2.5.1：不再只列「当前激活提供商」的模型——而是把**所有提供商**的模型分组列出，
 * 这样主人可以直接在 chat 页切换提供商，无需回设置页。
 */
export function buildModelOptions(ai: {
  provider?: import('@/types').AIProviderId;
  isDeepSeek?: boolean;
  providers?: Partial<import('@/types').AIProvidersConfig>;
}): ModelOption[] {
  const options: ModelOption[] = [{ value: '', label: '全局默认' }];

  for (const pid of AI_PROVIDER_ORDER) {
    const entry = ai.providers?.[pid];
    const preset = PROVIDER_PRESETS[pid];
    const models = entry?.models?.length ? entry.models : preset.models;
    const groupLabel = preset.label;

    for (const m of models) {
      options.push({
        value: `${pid}${MODEL_SEP}${m}`,
        label: m,
        group: groupLabel,
      });
    }
  }

  // e.4 / v2.5.0: 智能 GLM（免费模型池）
  options.push({ value: '__glm_smart__', label: '智能 GLM（免费池）' });

  return options;
}

/**
 * 解析模型选择器的复合值。
 *
 * - `providerId::model` → 拆出提供商与模型名
 * - 裸模型名（旧会话）→ providerId 为 null，由调用方回落到「当前激活提供商」
 */
export function parseModelValue(value: string): { providerId: import('@/types').AIProviderId | null; model: string } {
  if (!value) return { providerId: null, model: '' };
  if (value === '__glm_smart__') return { providerId: null, model: value };
  const idx = value.indexOf(MODEL_SEP);
  if (idx === -1) return { providerId: null, model: value };
  const pid = value.slice(0, idx) as import('@/types').AIProviderId;
  const model = value.slice(idx + MODEL_SEP.length);
  return { providerId: pid, model };
}

/** 格式化时间（时:分） */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** 格式化日期（今天显示时间、昨天、更早显示日期） */
export function formatDate(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 86400000) return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 172800000) return '昨天';
  return new Date(ts).toLocaleDateString('zh-CN');
}

// ===== API 消息安全截断（v2.7.4）=====

/** 传给大模型 API 的工具调用（OpenAI 兼容格式） */
export interface ApiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** 传给大模型 API 的消息（OpenAI 兼容格式，含 tool_calls / tool_call_id） */
export interface ApiMessage {
  role: string;
  content?: string;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

/** 因上下文截断而缺失的工具结果占位文本 */
export const TRUNCATED_TOOL_PLACEHOLDER = '(工具结果已因上下文过长被截断)';

/**
 * 补齐「缺结果的 assistant(tool_calls)」：在 `out[assistantIndex]` 之后
 * 追加合成的 tool 响应（工具结果被截断时使用）。
 */
function appendMissingToolResults(
  out: ApiMessage[],
  assistantIndex: number,
  answeredIds: Set<string>,
): void {
  const assistant = out[assistantIndex];
  for (const tc of assistant.tool_calls || []) {
    if (!answeredIds.has(tc.id)) {
      out.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: TRUNCATED_TOOL_PLACEHOLDER,
      });
    }
  }
}

/**
 * 修复消息序列的 tool 配对：
 *  - 丢弃「前置没有对应 tool_calls」的孤儿 tool 消息；
 *  - 为「带 tool_calls 却缺 tool 响应」的 assistant 补合成响应。
 */
export function repairToolPairing(messages: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  let pendingIds: Set<string> | null = null;
  let pendingAssistantIndex = -1;
  let answeredIds = new Set<string>();

  const flushPending = () => {
    if (pendingIds && pendingAssistantIndex >= 0) {
      appendMissingToolResults(out, pendingAssistantIndex, answeredIds);
    }
  };

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const id = msg.tool_call_id || '';
      // 只有能对上前置 tool_calls 的 tool 消息才保留，否则丢弃（避免 400）
      if (pendingIds && pendingIds.has(id)) {
        out.push(msg);
        answeredIds.add(id);
      }
      continue;
    }

    // 进入下一条非 tool 消息前，先把上一组未响应的 tool_calls 补齐
    flushPending();

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      out.push(msg);
      pendingAssistantIndex = out.length - 1;
      pendingIds = new Set(msg.tool_calls.map(tc => tc.id));
      answeredIds = new Set();
    } else {
      out.push(msg);
      pendingIds = null;
      pendingAssistantIndex = -1;
      answeredIds = new Set();
    }
  }

  flushPending();
  return out;
}

/**
 * 在保证 tool_calls / tool 配对完整的前提下，截取最近 maxHistory 条消息。
 *
 * 为什么需要：ChatPage 原先直接 `.slice(-22)`。历史里一旦存在 agent loop 产生的
 * `assistant(tool_calls)` + `tool` 消息，切点可能正好把这对切开，于是 tool 消息
 * 失去前置的 tool_calls → 服务端返回 400
 * "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"。
 * 此孤儿会永久留在会话里，导致后续每条消息都报同样的错。
 *
 * 本函数保证输出序列：
 *  1) 不以孤立的 tool 消息开头；
 *  2) 每个 tool 消息都能找到前面带同 id 的 assistant(tool_calls)；
 *  3) 每个带 tool_calls 的 assistant 后面都有对应的 tool 响应。
 */
export function truncateApiMessagesSafely(
  messages: ApiMessage[],
  maxHistory: number,
): ApiMessage[] {
  let result = repairToolPairing(messages);
  if (maxHistory > 0 && result.length > maxHistory) {
    result = result.slice(result.length - maxHistory);
    // 截断后重跑一次配对修复：丢掉新产生的头部孤儿、补齐被切掉的 tool 响应
    result = repairToolPairing(result);
    // 兜底：确保开头不是孤立的 tool
    let i = 0;
    while (i < result.length && result[i].role === 'tool') i++;
    if (i > 0) result = result.slice(i);
  }
  return result;
}