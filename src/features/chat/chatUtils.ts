/**
 * Chat 页面工具函数与常量
 */
import type { ChatSession } from './chatTypes';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS, getEnabledModels } from '@/types';

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
    // 尊重设置页的「启用模型」勾选；未配置时回落到全量候选
    const models = entry ? getEnabledModels(entry) : preset.models;
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

/**
 * 多模态内容块（v3.5.3）
 *
 * 纯文本消息仍用 string（改动面最小、兼容所有网关）；
 * 只有「带图片的用户消息」才升级成块数组 —— OpenAI / DeepSeek /
 * OpenRouter 的标准格式，SiliconFlow 同样兼容。
 */
export type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** 传给大模型 API 的消息（OpenAI 兼容格式，含 tool_calls / tool_call_id） */
export interface ApiMessage {
  role: string;
  content?: string | ApiContentPart[];
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

/**
 * 构造 user 消息的 content（v3.5.3）。
 *
 * 三条分支：
 *  1. 本轮带图 → 多模态块数组（纯图消息补一句占位文本，避免空 text 块被网关拒）
 *  2. 历史带图 → 只留 `[图片 × N]` 占位：图片不重发，否则 agent loop 每轮
 *     都把图重新塞进上下文，token 成倍增长，且历史越长越贵
 *  3. 无图 → 原样返回字符串（保持老行为，兼容所有网关）
 */
export function buildUserMessageContent(opts: {
  text: string;
  /** 本轮图片块（已从本地文件读成 base64） */
  imageParts?: ApiContentPart[];
  /** 历史消息里的图片数量（>0 时走占位分支） */
  historicalImageCount?: number;
}): string | ApiContentPart[] {
  const { text, imageParts, historicalImageCount = 0 } = opts;
  if (imageParts && imageParts.length > 0) {
    return [
      { type: 'text', text: text || '请看这张图片。' },
      ...imageParts,
    ];
  }
  if (historicalImageCount > 0) {
    // v3.6.4：注明「历史图片、未重发」——否则模型只会说「我看到有个图片但看不到内容」，
    // 让人误以为是传输坏了。
    return `${text}${text ? '\n' : ''}[图片 × ${historicalImageCount}（历史图片，未重发）]`;
  }
  return text;
}

/**
 * 把用户消息里的「文件块」切出来（v3.6.4）。
 *
 * 发送时会把选中的文本文件拼成 `【文件：name】\n正文\n【文件结束】`，
 * 消息里保留全文（备份/导出天然带着走），但气泡里只渲染一张卡片，
 * 点开跳独立页面看全文 —— 否则一屏全是 html，翻都翻不动。
 */
export interface ChatFileBlock {
  /** 文件名（可能带「（内容过长已截断）」后缀） */
  name: string;
  /** 文件正文 */
  body: string;
}

export type ChatContentSegment =
  | { type: 'text'; text: string }
  | { type: 'file'; block: ChatFileBlock; index: number };

const FILE_BLOCK_RE = /【文件：([^】\n]+)】\n([\s\S]*?)\n【文件结束】/g;

/** 按文件块拆分消息正文（没有文件块时返回单个 text 段）。 */
export function splitChatFileBlocks(content: string): ChatContentSegment[] {
  if (!content || !content.includes('【文件：')) {
    return content ? [{ type: 'text', text: content }] : [];
  }
  const segments: ChatContentSegment[] = [];
  let cursor = 0;
  let index = 0;
  FILE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(content)) !== null) {
    if (match.index > cursor) {
      const text = content.slice(cursor, match.index).trim();
      if (text) segments.push({ type: 'text', text });
    }
    segments.push({
      type: 'file',
      block: { name: match[1]!.trim(), body: match[2] ?? '' },
      index: index++,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    const text = content.slice(cursor).trim();
    if (text) segments.push({ type: 'text', text });
  }
  // 正则没命中（格式被手改过）→ 整体当文本，别把消息吞掉
  return segments.length > 0 ? segments : [{ type: 'text', text: content }];
}

/** 文件块在消息里的字符数展示 */
export function formatCharCount(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)} 万字`;
  return `${chars} 字`;
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

/* === v3.5.0: 输入框草稿（按会话隔离，localStorage 持久化） ===
 * 独立于聊天会话数据库/备份体系：草稿是高频临时内容，单独存 localStorage
 *（不进云备份/设备互传，参照转盘先例），退出聊天页再回来也不丢。
 */
const CHAT_DRAFTS_KEY = 'yiyan_chat_drafts_v1';

/** 读取全部草稿表（解析失败时容错为空表） */
export function loadChatDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CHAT_DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 写入某会话的草稿（空文本 → 删除该键，保持存储干净） */
export function saveChatDraft(sessionId: string, text: string): void {
  try {
    const drafts = loadChatDrafts();
    if (text) {
      drafts[sessionId] = text;
    } else if (sessionId in drafts) {
      delete drafts[sessionId];
    } else {
      return;
    }
    localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* 静默：草稿写入失败不阻塞输入 */
  }
}

/** 删除某会话的草稿（删除会话时清理孤儿） */
export function deleteChatDraft(sessionId: string): void {
  try {
    const drafts = loadChatDrafts();
    if (sessionId in drafts) {
      delete drafts[sessionId];
      localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(drafts));
    }
  } catch {
    /* 静默 */
  }
}