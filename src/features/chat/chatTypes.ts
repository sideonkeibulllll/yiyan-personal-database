/**
 * Chat 页面类型定义
 */
import type { ResolvedToolCall } from '@/services/chatBridge';

export type ThinkingEffort = 'high' | 'max';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  reasoningContent?: string;  // 思维链内容
  timestamp: number;
  isThinking?: boolean;
  thinkingEffort?: ThinkingEffort;
  model?: string;  // 该消息使用的模型

  /** assistant 触发工具调用时的原始 tool_calls（OpenAI 结构，用于重建 apiMessages） */
  toolCalls?: ResolvedToolCall[];
  /** 工具执行结果摘要（UI 展示用，与 toolCalls 一一对应） */
  toolCallResults?: { name: string; success: boolean; summary: string }[];
  /** role='tool' 时关联的 tool_call_id（用于重建 apiMessages） */
  toolCallId?: string;
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
}

export interface SearchSelectedResult {
  entryId: string;
  content: string;
  source?: string;
}