/**
 * Chat 页面类型定义
 */
import type { ResolvedToolCall } from '@/services/chatBridge';

export type ThinkingEffort = 'high' | 'max';

/**
 * 消息里的图片引用（v3.5.3）
 *
 * 只存路径，不存 base64 —— chat_sessions.messages 是整段 JSON 存 TEXT，
 * 塞 base64 会让会话表迅速膨胀，且每次流式落库都要重写一遍。
 * 发送给模型时再按路径读文件、按需压缩（见 attachmentService.readChatImageForModel）。
 */
export interface ChatImage {
  /** 原图相对路径（长边≤1600） */
  path: string;
  /** 缩略图相对路径（长边≤400） */
  thumbPath: string;
  mimeType: string;
}

/** 尚未发送的图片（还停在内存里，未落盘；preview 为压缩后的 dataURL） */
export interface PendingChatImage {
  id: string;
  base64: string;
  mimeType: string;
  /** 长边 400 的 dataURL，仅用于输入区预览条 */
  preview: string;
}

/**
 * 尚未发送的文本文件（v3.6.3，v4.2.0 加原始 File 引用）
 *
 * 发送时两件事同时发生：
 * - 内容（可能只贴开头，见 buildChatFileBlock）拼进 user 消息正文
 * - 原始字节落一份到 chat-files/<sessionId>/，消息里给出路径，
 *   AI 可以用 copy_file 原样搬进作品（不用重打内容）
 */
export interface PendingChatFile {
  id: string;
  name: string;
  /** 原始字节数（展示用） */
  size: number;
  text: string;
  /** 读取时是否因超长被截断 */
  truncated: boolean;
  /** 原始 File（发送时落地用；只在内存里，不落库） */
  file?: File;
  /** 已落地的本地副本路径（chat-files/…） */
  cachePath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoningContent?: string;  // 思维链内容
  timestamp: number;
  isThinking?: boolean;
  thinkingEffort?: ThinkingEffort;
  model?: string;  // 该消息使用的模型

  /** 用户消息随附的图片（v3.5.3；只有 role='user' 会用） */
  images?: ChatImage[];

  /** assistant 触发工具调用时的原始 tool_calls（OpenAI 结构，用于重建 apiMessages） */
  toolCalls?: ResolvedToolCall[];
  /** 工具执行结果摘要（UI 展示用，与 toolCalls 一一对应） */
  toolCallResults?: { name: string; success: boolean; summary: string }[];
  /** role='tool' 时关联的 tool_call_id（用于重建 apiMessages） */
  toolCallId?: string;
  /** role='tool' 时对应的工具名（v3.6.5：用于把文件类结果渲染成可点卡片） */
  toolName?: string;

  /**
   * 危险操作等待用户确认（删除类工具）。
   * 以独立消息渲染成「确认 / 取消」按钮，用户点击后状态变为 approved / rejected，
   * agent loop 拿到结果才继续。
   */
  confirmRequest?: {
    id: string;
    toolName: string;
    summary: string;
    status: 'pending' | 'approved' | 'rejected';
    /** 可选：确认内容的预览（如 Soul 新版全文），在卡片内折叠展示 */
    preview?: string;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;  // 对话级模型覆盖（留空则用全局默认）
  mcpEnabledTools?: string[];  // 该对话启用的 MCP 工具
  mcpSearchResults?: SearchSelectedResult[];  // MCP 搜索结果选择
  /** 该对话的深度思考开关（v2.11.0 对话级持久化：切走/退出重进不丢失） */
  thinkingEnabled?: boolean;
  /** 该对话的思考强度（v2.11.0 对话级持久化） */
  thinkingEffort?: ThinkingEffort;
}

export interface SearchSelectedResult {
  entryId: string;
  content: string;
  source?: string;
}