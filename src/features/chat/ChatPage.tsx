/**
 * Chat 页面 v3 — DeepSeek 风格对话界面
 * 
 * 功能：
 * 1. 多轮连续对话 + 历史会话管理（localStorage）
 * 2. 流式响应（SSE）— 分别处理 reasoning_content（思维链）和 content（正文）
 * 3. Markdown 渲染
 * 4. 重命名对话
 * 5. 深度思考模式 + 思考强度控制（high/max）
 * 6. 对话分叉
 * 7. 每个对话可选独立模型（覆盖全局默认）
 * 8. MCP Bridge 按需注入 — 不每轮发送
 * 9. MCP 搜索结果半页选择器
 * 10. 工具调用在流式结束后解析执行
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { renderMarkdown } from '@/utils/markdown';
import {
  buildToolsPayload,
  accumulateToolCallDeltas,
  parseToolArguments,
  executeToolCall,
  formatToolResultMessage,
  formatToolResultForUI,
  type ResolvedToolCall,
  type ToolCallDelta,
  ENTRY_TOOLS,
  TODO_TOOLS,
} from '@/services/chatBridge';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { EntryPickerPanel } from '@/components/EntryPickerPanel';
import html2canvas from 'html2canvas';
import type { Entry, Todo } from '@/types';
import './ChatPage.css';

/* === SVG Icons === */
const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);
const IconSend = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.086a.5.5 0 0 0 .937-.073l4.5-11.5a.5.5 0 0 0-.628-.628l-11.5 4.5a.5.5 0 0 0 .073.937l5.516 1.643z" /><path d="m14.536 21.086-1.643-5.516" /></svg>
);
const IconMenu = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
);
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
const IconMessage = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
);
const IconCopy = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
const IconBrain = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></svg>
);
const IconTool = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
);
const IconChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);
const IconBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7M19 12H5" /></svg>
);
const IconUpload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
);
const IconExit = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);
const IconShare = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const IconClose2 = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

/* === Types === */
type ThinkingEffort = 'high' | 'max';

interface ChatMessage {
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

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;  // 对话级模型覆盖（留空则用全局默认）
  mcpEnabledTools?: string[];  // 该对话启用的 MCP 工具
  mcpSearchResults?: SearchSelectedResult[];  // MCP 搜索结果选择
}

interface SearchSelectedResult {
  entryId: string;
  content: string;
  source?: string;
}

/* === Storage === */
const SESSIONS_KEY = 'yiyan_chat_sessions';

function loadSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(SESSIONS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveSessions(sessions: ChatSession[]): void {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* ignore */ }
}

function createId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 20) return trimmed || '新对话';
  return trimmed.slice(0, 20) + '…';
}

/* === 可选模型列表 === */
const MODEL_OPTIONS = [
  { value: '', label: '全局默认' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
];

/* === Streaming fetch === */
interface StreamCallbacks {
  onReasoning: (chunk: string) => void;
  onContent: (chunk: string) => void;
  /** 收到 tool_calls 增量时触发，由调用方累积并执行 */
  onToolCall?: (deltas: ToolCallDelta[]) => void;
}

/**
 * 流式调用 chat/completions。
 * - messages: 完整对话历史（包含 system/user/assistant/tool 各角色）
 * - toolsPayload: 启用工具的 OpenAI schema 数组；为空数组则不传 tools 字段
 * - finishReason: 输出参数，返回 choices[0].finish_reason（'stop' | 'tool_calls' | 'length' | ...）
 *   调用方据此判断是否需要进入 agent loop
 */
async function streamChatCompletion(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
  thinkingEnabled: boolean,
  reasoningEffort: ThinkingEffort | null,
  toolsPayload: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<{ finishReason: string | null }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };

  // 工具 schema（仅在有启用工具时传）
  if (toolsPayload.length > 0) {
    body.tools = toolsPayload;
    // 让模型自主决定何时调用，必要时可改为 'required' 强制调用
    body.tool_choice = 'auto';
  }

  // 思考模式参数
  if (thinkingEnabled) {
    body.thinking = { type: 'enabled' };
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
  } else {
    body.thinking = { type: 'disabled' };
  }

  // 非思考模式下才传 temperature
  if (!thinkingEnabled) {
    body.temperature = 0.7;
    body.max_tokens = 4096;
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        // finish_reason 在最后一帧出现
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (!delta) continue;

        // 思维链内容
        if (delta.reasoning_content) {
          callbacks.onReasoning(delta.reasoning_content);
        }
        // 正文内容
        if (delta.content) {
          callbacks.onContent(delta.content);
        }
        // 工具调用增量（流式期间累积）
        if (delta.tool_calls && Array.isArray(delta.tool_calls) && callbacks.onToolCall) {
          callbacks.onToolCall(delta.tool_calls as ToolCallDelta[]);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  return { finishReason };
}

/* === Component === */
export function ChatPage() {
  const settings = useSettingsStore(state => state.settings);

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  // 思考模式
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('high');

  // MCP 状态
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpSearchOpen, setMcpSearchOpen] = useState(false);
  const [mcpSearchResults, setMcpSearchResults] = useState<Entry[]>([]);
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [mcpSearchTagFilter, setMcpSearchTagFilter] = useState('');
  const [mcpSearchGroupFilter, setMcpSearchGroupFilter] = useState('');
  const [mcpSelectedIds, setMcpSelectedIds] = useState<Set<string>>(new Set());
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const [mcpPickerMode, setMcpPickerMode] = useState<'entry' | 'todo'>('entry');
  // 已激活的 MCP 类型（一次性，发送后清空）
  const [mcpActiveTools, setMcpActiveTools] = useState<string[]>([]);

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 模型选择
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // 余额查询
  const [balanceInfo, setBalanceInfo] = useState<{
    currentBalance: number | null;
    lastBalance: number | null;
    isQuerying: boolean;
  }>({ currentBalance: null, lastBalance: null, isQuerying: false });

  // === 任务 2 新增状态 ===
  // 条目选择器面板（上传按钮触发）
  const [entryPickerOpen, setEntryPickerOpen] = useState(false);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<Set<string>>(new Set());
  // 从 QuickMenu「就此内容谈话」跳转来的初始条目
  const [pickerInitialEntryId, setPickerInitialEntryId] = useState<string | undefined>(undefined);
  // “特殊状态”返回按钮：指示从其他页面跳入且未完成对话
  const [returnTarget, setReturnTarget] = useState<string | null>(null);

  // === 分享/选中模式（导出为图片）===
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 从 QuickMenu「就此内容谈话」跳转处理
  useEffect(() => {
    const entryId = searchParams.get('entryId');
    const from = searchParams.get('from');
    if (entryId) {
      setPickerInitialEntryId(entryId);
      // 合并预备列表中的条目
      const PREPARED_KEY = '__yiyan_prepared_entry_ids__';
      const prepared: string[] = (window as any)[PREPARED_KEY] || [];
      const allIds = new Set<string>([entryId, ...prepared]);
      setPickerSelectedIds(allIds);
      setEntryPickerOpen(true);
      if (from) {
        setReturnTarget(from);
      }
      // 注意：预备列表在发送对话后清除（handleSend finally 中）
    }
  }, [searchParams]);

  // === 任务 2：上传按钮处理 ===
  const handleUploadClick = useCallback(() => {
    setPickerInitialEntryId(undefined);
    setEntryPickerOpen(true);
  }, []);

  // 返回按钮（特殊状态栏）
  const handleReturnBack = useCallback(() => {
    if (returnTarget) {
      navigate(returnTarget);
    } else {
      navigate(-1);
    }
    setReturnTarget(null);
  }, [returnTarget, navigate]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId) || null;
  const messages = currentSession?.messages ?? [];
  const currentModel = currentSession?.model || settings.ai.model || 'deepseek-v4-flash';

  // 监听窗口大小
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // === 分享/选中模式：进入/退出时清理选中状态 ===
  const handleEnterSelectMode = useCallback(() => {
    setSelectedMsgIds(new Set());
    setSelectMode(true);
  }, []);

  const handleExitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedMsgIds(new Set());
  }, []);

  // 切换某条消息的选中状态（仅 user/assistant，跳过 tool 消息）
  const handleToggleSelectMsg = useCallback((msgId: string) => {
    setSelectedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  // 导出选中的消息为图片（html2canvas 截取实际 DOM）
  const handleExportSelected = useCallback(async () => {
    if (selectedMsgIds.size === 0) {
      alert('请先选择要导出的消息');
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) return;

    setIsExporting(true);
    try {
      // 收集选中的消息 DOM 节点
      const allMsgEls = Array.from(container.querySelectorAll<HTMLElement>('.chat-message'));
      const selectedEls = allMsgEls.filter(el => selectedMsgIds.has(el.dataset.msgId || ''));
      if (selectedEls.length === 0) {
        alert('未找到选中的消息');
        return;
      }

      // 构造一个临时容器，克隆选中的消息节点，用于截图
      // 这样可以避免截取整个滚动区域，且只包含选中内容
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position: fixed;
        left: -99999px;
        top: 0;
        width: ${container.offsetWidth}px;
        padding: 24px;
        background: var(--color-bg-primary, #131416);
        box-sizing: border-box;
      `;
      // 顶部标题
      const header = document.createElement('div');
      header.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding-bottom: 14px; margin-bottom: 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        font-size: 12px; color: #868e96;
        font-family: 'Inter', 'Noto Sans SC', sans-serif;
      `;
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      header.innerHTML = `
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f76707;"></span>
        <span style="font-weight:600;color:#adb5bd;">记忆库 · AI 对话</span>
        <span style="margin-left:auto;font-size:11px;color:#495057;">${dateStr}</span>
      `;
      wrapper.appendChild(header);

      // 克隆每条选中的消息（移除选中圆圈等装饰）
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:20px;';
      for (const el of selectedEls) {
        const clone = el.cloneNode(true) as HTMLElement;
        // 移除选中圆圈
        clone.querySelectorAll('.msg-select-checkbox').forEach(n => n.remove());
        // 移除时间戳（可选，保留也行）
        list.appendChild(clone);
      }
      wrapper.appendChild(list);

      // 底部水印
      const footer = document.createElement('div');
      footer.style.cssText = `
        margin-top: 24px; padding-top: 14px;
        border-top: 1px solid rgba(255,255,255,0.08);
        text-align: right; font-size: 11px; color: #495057;
        font-family: 'Inter', 'Noto Sans SC', sans-serif;
      `;
      footer.textContent = '由 记忆库 导出';
      wrapper.appendChild(footer);

      document.body.appendChild(wrapper);

      try {
        const canvas = await html2canvas(wrapper, {
          backgroundColor: '#131416',
          scale: 2,
          useCORS: true,
          logging: false,
        });
        const dataUrl = canvas.toDataURL('image/png');

        const filename = `对话_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.png`;

        // 移动端优先系统分享，否则下载
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: 'image/png' });
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
        };
        let shared = false;
        if (nav.canShare && nav.canShare({ files: [file] })) {
          try {
            await nav.share({ files: [file], title: '记忆库 · AI 对话', text: '记忆库 · AI 对话' });
            shared = true;
          } catch (err) {
            if ((err as Error).name === 'AbortError') {
              // 用户取消分享，不下载
              shared = true;
            }
          }
        }
        if (!shared) {
          // 回退下载
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } finally {
        document.body.removeChild(wrapper);
      }
    } catch (err) {
      console.error('导出图片失败:', err);
      alert(`导出失败：${(err as Error).message}`);
    } finally {
      setIsExporting(false);
      // 导出后退出选中模式
      setSelectMode(false);
      setSelectedMsgIds(new Set());
    }
  }, [selectedMsgIds]);

  // 切换对话时，从 session 同步已启用的 MCP 工具到本地 state（对话级持久化）
  useEffect(() => {
    const s = sessions.find(s => s.id === currentSessionId);
    setMcpActiveTools(s?.mcpEnabledTools ?? []);
    // 同时同步 MCP 开关状态：有启用工具则视为开
    setMcpEnabled((s?.mcpEnabledTools?.length ?? 0) > 0);
  }, [currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // textarea 自适应
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, [input]);

  const persistSessions = useCallback((next: ChatSession[]) => {
    setSessions(next);
    saveSessions(next);
  }, []);

  const updateSessionMessages = useCallback((sessionId: string, msgs: ChatMessage[]) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === sessionId
        ? { ...s, messages: msgs, updatedAt: Date.now() }
        : s
      );
      saveSessions(next);
      return next;
    });
  }, []);

  /* === MCP 工具激活：对话级持久化 ===
   * 把当前启用的工具列表同时写到 state（即时 UI 反馈）与 session.mcpEnabledTools（持久化）。
   * 这样切走再切回对话时，工具状态不丢失；handleSend 也直接从 session 读取。
   */
  const handleSetSessionMcpTools = useCallback((toolNames: string[]) => {
    setMcpActiveTools(toolNames);
    if (!currentSessionId) return;
    persistSessions(sessions.map(s => s.id === currentSessionId
      ? { ...s, mcpEnabledTools: toolNames }
      : s
    ));
  }, [currentSessionId, sessions, persistSessions]);

  /* === 新建对话 === */
  const handleNewChat = useCallback(() => {
    const emptySession = sessions.find(s => s.messages.length === 0);
    if (emptySession) {
      setCurrentSessionId(emptySession.id);
    } else {
      const newSession: ChatSession = {
        id: createId(),
        title: '新对话',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistSessions([newSession, ...sessions]);
      setCurrentSessionId(newSession.id);
    }
    setInput('');
    setMcpSelectedIds(new Set());
    if (isMobile) setSidebarOpen(false);
  }, [sessions, persistSessions, isMobile]);

  const handleSelectSession = useCallback((id: string) => {
    setCurrentSessionId(id);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleDeleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = sessions.filter(s => s.id !== id);
    persistSessions(next);
    if (currentSessionId === id) {
      setCurrentSessionId(next[0]?.id ?? null);
    }
  }, [sessions, currentSessionId, persistSessions]);

  /* === 重命名 === */
  const handleStartRename = useCallback((id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentTitle);
  }, []);

  const handleRenameSubmit = useCallback((id: string) => {
    const title = renameValue.trim() || '未命名对话';
    persistSessions(sessions.map(s => s.id === id ? { ...s, title } : s));
    setRenamingId(null);
    setRenameValue('');
  }, [sessions, persistSessions, renameValue]);

  /* === 分叉 === */
  const handleForkSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const source = sessions.find(s => s.id === id);
    if (!source) return;
    const forked: ChatSession = {
      id: createId(),
      title: `${source.title} (副本)`,
      messages: source.messages.map(m => ({ ...m, id: createId() })),
      model: source.model,
      mcpEnabledTools: source.mcpEnabledTools,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    persistSessions([forked, ...sessions]);
    setCurrentSessionId(forked.id);
  }, [sessions, persistSessions]);

  /* === 模型选择 === */
  const handleSelectModel = useCallback((model: string) => {
    if (!currentSessionId) return;
    persistSessions(sessions.map(s => s.id === currentSessionId
      ? { ...s, model: model || undefined }
      : s
    ));
    setModelPickerOpen(false);
  }, [currentSessionId, sessions, persistSessions]);

  /* === 余额查询 === */
  const BALANCE_STORAGE_KEY = 'yiyan_last_balance';

  const handleQueryBalance = useCallback(async () => {
    if (!settings.ai.apiKey) {
      alert('请先在设置页面配置 AI API Key');
      return;
    }

    setBalanceInfo(prev => ({ ...prev, isQuerying: true }));

    try {
      const baseURL = settings.ai.baseURL.replace(/\/$/, '');
      let balanceURL: string;

      if (baseURL.includes('siliconflow.cn')) {
        balanceURL = `${baseURL}/user/balance`;
      } else if (baseURL.includes('deepseek.com')) {
        balanceURL = `${baseURL}/user/balance`;
      } else {
        balanceURL = `${baseURL}/user/balance`;
      }

      const response = await fetch(balanceURL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${settings.ai.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`查询失败: ${response.status}`);
      }

      const data = await response.json();
      let balance: number;

      if (baseURL.includes('siliconflow.cn')) {
        balance = parseFloat(
          data?.data?.available_balance ||
          data?.available_balance ||
          data?.balance_infos?.[0]?.total_balance ||
          data?.balance ||
          0
        );
      } else {
        balance = parseFloat(
          data?.balance_infos?.[0]?.total_balance ||
          data?.data?.available_balance ||
          data?.available_balance ||
          data?.total_balance ||
          data?.balance ||
          0
        );
      }

      const savedLast = localStorage.getItem(BALANCE_STORAGE_KEY);
      const lastBalance = savedLast ? parseFloat(savedLast) : null;

      if (balanceInfo.currentBalance !== null) {
        localStorage.setItem(BALANCE_STORAGE_KEY, balanceInfo.currentBalance.toString());
      }

      setBalanceInfo({
        currentBalance: balance,
        lastBalance: balanceInfo.currentBalance,
        isQuerying: false,
      });
    } catch (error) {
      setBalanceInfo(prev => ({ ...prev, isQuerying: false }));
      alert(`余额查询失败: ${(error as Error).message}`);
    }
  }, [settings.ai.apiKey, settings.ai.baseURL, balanceInfo.currentBalance]);

  /* === MCP 搜索 === */
  const handleMcpSearch = useCallback(async () => {
    const db = await getDatabase();
    let results: Entry[] = [];

    if (mcpSearchQuery.trim()) {
      results = await db.searchEntries(mcpSearchQuery.trim());
    } else {
      results = await db.getAllEntries();
    }

    // 标签筛选
    if (mcpSearchTagFilter.trim()) {
      const allTags = await db.getAllTags();
      const tagNames = mcpSearchTagFilter.split(',').map(t => t.trim()).filter(Boolean);
      const tagIds = tagNames.map(name => allTags.find(t => t.name === name)?.id).filter(Boolean) as string[];
      if (tagIds.length > 0) {
        const taggedIds = new Set<string>();
        for (const tagId of tagIds) {
          const entries = await db.getEntriesByTagId(tagId);
          entries.forEach(e => taggedIds.add(e.id));
        }
        results = results.filter(e => taggedIds.has(e.id));
      }
    }

    // 组筛选
    if (mcpSearchGroupFilter.trim()) {
      const groups = await db.getAllGroups();
      const group = groups.find(g => g.name === mcpSearchGroupFilter.trim());
      if (group) {
        const groupEntries = await db.getEntriesByGroupId(group.id);
        const groupEntryIds = new Set(groupEntries.map(e => e.id));
        results = results.filter(e => groupEntryIds.has(e.id));
      }
    }

    setMcpSearchResults(results);
  }, [mcpSearchQuery, mcpSearchTagFilter, mcpSearchGroupFilter]);

  const handleMcpToggleSelect = useCallback((entryId: string) => {
    setMcpSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  const handleMcpConfirmSelection = useCallback(() => {
    if (!currentSessionId || mcpSelectedIds.size === 0) {
      setMcpSearchOpen(false);
      return;
    }
    const selected: SearchSelectedResult[] = mcpSearchResults
      .filter(e => mcpSelectedIds.has(e.id))
      .map(e => ({ entryId: e.id, content: e.content, source: e.source }));

    persistSessions(sessions.map(s => s.id === currentSessionId
      ? { ...s, mcpSearchResults: selected }
      : s
    ));
    setMcpSearchOpen(false);
  }, [currentSessionId, mcpSearchResults, mcpSelectedIds, sessions, persistSessions]);

  /* === 停止生成 === */
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* === 发送消息（流式）=== */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    if (!settings.ai.apiKey) {
      alert('请先在设置页面配置 AI API Key');
      return;
    }

    // 确保 session 存在
    let sessionId = currentSessionId ?? createId();
    let session = sessions.find(s => s.id === sessionId);

    if (!session) {
      session = {
        id: sessionId,
        title: generateTitle(text),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const newSessions = [session, ...sessions];
      persistSessions(newSessions);
      setCurrentSessionId(sessionId);
    }

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: createId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const updatedMessages = [...session.messages, userMsg];

    // 更新标题
    const newTitle = session.messages.length === 0 ? generateTitle(text) : session.title;
    const updatedSession: ChatSession = {
      ...session,
      title: newTitle,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };
    persistSessions(sessions.map(s => s.id === sessionId ? updatedSession : s));
    setInput('');
    setIsLoading(true);

    // AI 占位消息
    const aiMsgId = createId();
    const aiPlaceholder: ChatMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      reasoningContent: '',
      timestamp: Date.now(),
      isThinking: thinkingEnabled,
      thinkingEffort: thinkingEnabled ? thinkingEffort : undefined,
      model: currentModel,
    };

    let currentMsgs = [...updatedMessages, aiPlaceholder];
    updateSessionMessages(sessionId, currentMsgs);

    try {
      // 构建系统提示
      let systemPrompt = '你是一个友好的AI助手。';

      // 注意：MCP 工具已改为通过 OpenAI 原生 tools 字段下发，不再注入提示词。
      // 用户启用的工具在下方 buildToolsPayload() 中转为结构化 schema 传给 API。

      // MCP 搜索结果注入
      if (session.mcpSearchResults && session.mcpSearchResults.length > 0) {
        const resultsText = session.mcpSearchResults.map((r, i) =>
          `[${i + 1}] (ID: ${r.entryId}) ${r.content}${r.source ? ` [来源: ${r.source}]` : ''}`
        ).join('\n');
        systemPrompt += `\n\n## 用户选择的记忆库条目\n用户选择了以下条目作为对话上下文：\n${resultsText}\n`;
      }

      // === 修复 3：注入 pickerSelectedIds 作为对话上下文 ===
      // EntryPickerPanel 的「数据」和「待办」两种模式共用一个 selectedIds 集合，
      // 因此必须同时查询 entry 与 todo 两个数据库，否则待办会被静默丢弃。
      if (pickerSelectedIds.size > 0) {
        console.log('[ChatPage] pickerSelectedIds:', Array.from(pickerSelectedIds));
        try {
          const db = await getDatabase();
          const todoDb = await getTodoDatabase();
          const pickerEntries: Entry[] = [];
          const pickerTodos: Todo[] = [];
          const failedIds: string[] = [];
          for (const eid of pickerSelectedIds) {
            // 先查 entry 数据库
            try {
              const e = await db.getEntryById(eid);
              if (e) {
                pickerEntries.push(e);
                continue;
              }
            } catch (entryErr) {
              console.warn('[ChatPage] getEntryById failed for', eid, entryErr);
            }
            // 查不到再查 todo 数据库
            try {
              const t = await todoDb.getTodoById(eid);
              if (t) {
                pickerTodos.push(t);
                continue;
              }
            } catch (todoErr) {
              console.warn('[ChatPage] getTodoById failed for', eid, todoErr);
            }
            // 两个库都查不到
            failedIds.push(eid);
          }
          console.log('[ChatPage] loaded:', { entries: pickerEntries.length, todos: pickerTodos.length, failed: failedIds.length });
          if (pickerEntries.length > 0) {
            const pickerText = pickerEntries.map((e, i) =>
              `[${i + 1}] (ID: ${e.id}) ${e.content}${e.source ? ` [来源: ${e.source}]` : ''}${e.supplement ? ` [补充: ${e.supplement}]` : ''}`
            ).join('\n');
            systemPrompt += `\n\n## 用户选择的数据上下文\n用户选择了以下数据卡片作为本次对话的参考：\n${pickerText}\n`;
          }
          if (pickerTodos.length > 0) {
            const todoText = pickerTodos.map((t, i) => {
              const parts = [`[${i + 1}] (ID: ${t.id}) ${t.title}`];
              if (t.note) parts.push(`[备注: ${t.note}]`);
              if (t.startTime) parts.push(`[时间: ${new Date(t.startTime).toLocaleString('zh-CN')}]`);
              if (t.folderDate) parts.push(`[日期: ${t.folderDate}]`);
              if (t.status === 'done') parts.push(`[已完成]`);
              if (t.tags && t.tags.length > 0) parts.push(`[标签: ${t.tags.map(tg => '#' + tg.name).join(' ')}]`);
              return parts.join(' ');
            }).join('\n');
            systemPrompt += `\n\n## 用户选择的待办上下文\n用户选择了以下待办事项作为本次对话的参考：\n${todoText}\n`;
          }
          if (failedIds.length > 0 && pickerEntries.length === 0 && pickerTodos.length === 0) {
            // 所有数据都加载失败，至少告诉 AI 用户选了东西
            systemPrompt += `\n\n## 用户选择的数据上下文\n用户选择了 ${failedIds.length} 条数据（ID: ${failedIds.join(', ')}），但数据加载失败。请告知用户数据可能未正确加载。\n`;
          }
        } catch (err) {
          console.error('[ChatPage] 加载选中条目失败:', err);
          // 即使数据库查询失败，也告诉 AI 用户选了数据
          systemPrompt += `\n\n## 用户选择的数据上下文\n用户选择了 ${pickerSelectedIds.size} 条数据作为对话参考，但数据加载时发生错误。请告知用户数据可能未正确加载。\n`;
        }
      }

      // 构建 API 消息（保留最近 20 条 + system），同时保留 assistant 的 tool_calls
      // 与 tool 消息的 tool_call_id，以便 agent loop 第二轮起模型能看到完整上下文。
      const buildApiMessage = (m: ChatMessage): { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string } | null => {
        if (m.role === 'user') return { role: 'user', content: m.content };
        if (m.role === 'assistant') {
          const msg: { role: string; content?: string; tool_calls?: unknown[] } = {
            role: 'assistant',
            content: m.content || '',
          };
          if (m.toolCalls && m.toolCalls.length > 0) {
            msg.tool_calls = m.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }));
          }
          return msg;
        }
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.toolCallId || '', content: m.content };
        }
        return null;
      };

      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...updatedMessages.map(buildApiMessage).filter(Boolean) as Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }>,
      ].slice(-22);

      // 工具 schema（替代旧的提示词注入）
      const enabledTools = mcpEnabled ? (session.mcpEnabledTools ?? mcpActiveTools) : [];
      const toolsPayload = buildToolsPayload(enabledTools);

      // === Agent loop ===
      // 每次 streamChatCompletion 返回 finish_reason='tool_calls' 时，
      // 执行工具→追加 tool 消息→新建 AI 占位→再次请求，循环直到模型不再调用工具。
      const abortCtrl = new AbortController();
      abortRef.current = abortCtrl;

      let loopMessages = [...apiMessages];       // 传给 API 的消息序列（循环中追加）
      let loopDisplayMsgs = [...currentMsgs];   // UI 显示的消息序列（含初始 AI 占位）
      let currentAiMsgId = aiMsgId;

      const MAX_ITERATIONS = 5;
      let iteration = 0;
      let hitLimit = false;

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        let fullContent = '';
        let fullReasoning = '';
        const toolCallAcc = new Map<number, ResolvedToolCall>();

        const { finishReason } = await streamChatCompletion(
          settings.ai.baseURL,
          settings.ai.apiKey,
          currentModel,
          loopMessages,
          thinkingEnabled,
          thinkingEnabled ? thinkingEffort : null,
          toolsPayload,
          {
            onReasoning: (chunk) => {
              fullReasoning += chunk;
              loopDisplayMsgs = loopDisplayMsgs.map(m =>
                m.id === currentAiMsgId ? { ...m, reasoningContent: fullReasoning } : m
              );
              updateSessionMessages(sessionId, loopDisplayMsgs);
            },
            onContent: (chunk) => {
              fullContent += chunk;
              loopDisplayMsgs = loopDisplayMsgs.map(m =>
                m.id === currentAiMsgId ? { ...m, content: fullContent } : m
              );
              updateSessionMessages(sessionId, loopDisplayMsgs);
            },
            onToolCall: (deltas) => {
              accumulateToolCallDeltas(toolCallAcc, deltas);
            },
          },
          abortCtrl.signal,
        );

        // 检测是否触发了工具调用
        const resolvedToolCalls = Array.from(toolCallAcc.values()).filter(
          tc => tc.id && tc.function.name,
        );
        const hasToolCalls = finishReason === 'tool_calls' || resolvedToolCalls.length > 0;

        if (!hasToolCalls) {
          // 模型说完了，没有要调用工具 → agent loop 结束
          break;
        }

        // 执行所有 tool_calls
        const toolCallResults: NonNullable<ChatMessage['toolCallResults']> = [];
        const apiToolMessages: Array<{ role: 'tool'; tool_call_id: string; content: string }> = [];

        for (const tc of resolvedToolCalls) {
          const args = parseToolArguments(tc.function.arguments);
          const result = await executeToolCall(tc.function.name, args);
          apiToolMessages.push(formatToolResultMessage(result, tc.id));
          toolCallResults.push({
            name: tc.function.name,
            success: result.success,
            summary: formatToolResultForUI(result, tc.function.name),
          });
        }

        // 把 toolCalls + toolCallResults 写到当前 AI 消息上
        loopDisplayMsgs = loopDisplayMsgs.map(m =>
          m.id === currentAiMsgId
            ? { ...m, toolCalls: resolvedToolCalls, toolCallResults }
            : m
        );

        // 追加 UI 展示用的 tool 消息
        for (let i = 0; i < resolvedToolCalls.length; i++) {
          const tc = resolvedToolCalls[i];
          const toolMsg: ChatMessage = {
            id: createId(),
            role: 'tool',
            content: apiToolMessages[i].content,
            toolCallId: tc.id,
            timestamp: Date.now(),
          };
          loopDisplayMsgs = [...loopDisplayMsgs, toolMsg];
        }
        updateSessionMessages(sessionId, loopDisplayMsgs);

        // 更新传给 API 的消息序列：追加 assistant(tool_calls) + 多条 tool 消息
        loopMessages = [
          ...loopMessages,
          {
            role: 'assistant',
            content: fullContent || '',
            tool_calls: resolvedToolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          },
          ...apiToolMessages,
        ];

        // 新建一个 AI 占位消息，用于下一轮流式续写
        const nextAiMsg: ChatMessage = {
          id: createId(),
          role: 'assistant',
          content: '',
          reasoningContent: '',
          timestamp: Date.now(),
          isThinking: thinkingEnabled,
          thinkingEffort: thinkingEnabled ? thinkingEffort : undefined,
          model: currentModel,
        };
        loopDisplayMsgs = [...loopDisplayMsgs, nextAiMsg];
        updateSessionMessages(sessionId, loopDisplayMsgs);
        currentAiMsgId = nextAiMsg.id;
      }

      if (iteration >= MAX_ITERATIONS) {
        hitLimit = true;
      }

      // 同步外层引用
      currentMsgs = loopDisplayMsgs;

      if (hitLimit) {
        const limitMsg: ChatMessage = {
          id: createId(),
          role: 'assistant',
          content: '_(已达到工具调用次数上限，请继续提问以让 AI 继续)_',
          timestamp: Date.now(),
        };
        currentMsgs = [...currentMsgs, limitMsg];
        updateSessionMessages(sessionId, currentMsgs);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        currentMsgs = currentMsgs.map(m =>
          m.id === aiMsgId
            ? { ...m, content: m.content || '(已停止)' }
            : m
        );
        updateSessionMessages(sessionId, currentMsgs);
      } else {
        const errMsg: ChatMessage = {
          id: aiMsgId,
          role: 'assistant',
          content: `⚠️ 出错了：${(error as Error).message}`,
          timestamp: Date.now(),
        };
        currentMsgs = currentMsgs.map(m => m.id === aiMsgId ? errMsg : m);
        updateSessionMessages(sessionId, currentMsgs);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      // === 修复 3：发送后清除预备状态（按钮状态结束）===
      setPickerSelectedIds(new Set());
      setPickerInitialEntryId(undefined);
      // 清除全局预备列表
      const PREPARED_KEY = '__yiyan_prepared_entry_ids__';
      delete (window as any)[PREPARED_KEY];
      // 注意：MCP 工具激活改为对话级持久化（session.mcpEnabledTools），
      // 不再在每次发送后清空，让用户在一次对话内可以连续多次调用工具。
    }
  }, [input, isLoading, settings, currentSessionId, sessions, persistSessions, updateSessionMessages, thinkingEnabled, thinkingEffort, mcpEnabled, mcpActiveTools, currentModel, pickerSelectedIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClearMessages = useCallback(() => {
    if (!currentSession) return;
    if (!confirm('确定清空当前对话？')) return;
    const cleared = { ...currentSession, messages: [], title: '新对话', mcpSearchResults: [] };
    persistSessions(sessions.map(s => s.id === currentSession.id ? cleared : s));
    setMcpSelectedIds(new Set());
  }, [currentSession, sessions, persistSessions]);

  // 格式化
  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const formatDate = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 86400000) return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (diff < 172800000) return '昨天';
    return new Date(ts).toLocaleDateString('zh-CN');
  };

  const currentModelLabel = MODEL_OPTIONS.find(m => m.value === (currentSession?.model || ''))?.label || currentModel;

  return (
    <div className={`chat-page ${isMobile ? 'mobile' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* === 左侧栏 === */}
      <aside className={`chat-sidebar glass ${sidebarOpen ? 'open' : ''}`}>
        <div className="chat-new-row">
          <button className="chat-new-btn" onClick={handleNewChat}>
            <IconPlus />
            <span>新建对话</span>
          </button>
        </div>

        <div className="chat-history">
          <div className="history-label">历史对话</div>
          {sessions.length > 0 ? (
            sessions.map(session => (
              <div
                key={session.id}
                className={`history-item ${currentSessionId === session.id ? 'active' : ''}`}
                onClick={() => handleSelectSession(session.id)}
              >
                {renamingId === session.id ? (
                  <div className="history-rename">
                    <input
                      className="rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameSubmit(session.id);
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                    <button className="rename-ok" onClick={(e) => { e.stopPropagation(); handleRenameSubmit(session.id); }}>✓</button>
                  </div>
                ) : (
                  <>
                    <div className="history-item-content">
                      <span className="history-item-title">{session.title}</span>
                      <span className="history-item-meta">
                        {session.messages.length} 条 · {formatDate(session.updatedAt)}
                        {session.model && <span className="history-item-model"> · {MODEL_OPTIONS.find(m => m.value === session.model)?.label || session.model}</span>}
                      </span>
                    </div>
                    <div className="history-item-actions">
                      <span className="history-item-action" title="重命名" onClick={(e) => handleStartRename(session.id, session.title, e)}>
                        <IconEdit />
                      </span>
                      <span className="history-item-action" title="分叉对话" onClick={(e) => handleForkSession(session.id, e)}>
                        <IconCopy />
                      </span>
                      <span className="history-item-action history-item-delete" title="删除" onClick={(e) => handleDeleteSession(session.id, e)}>
                        <IconTrash />
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="history-empty">
              <p>暂无历史对话</p>
              <p className="history-empty-hint">点击「新建对话」开始</p>
            </div>
          )}
        </div>

        {isMobile && (
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            <IconClose />
          </button>
        )}

        {/* 退出按钮 */}
        <div className="sidebar-footer">
          <button className="sidebar-exit-btn" onClick={() => navigate('/')}>
            <IconExit />
            <span>退出</span>
          </button>
        </div>
      </aside>

      {isMobile && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* === 右侧对话区 === */}
      <main className="chat-main">
        {/* 特殊状态栏：从其他页面跳入时显示返回按钮 */}
        {returnTarget && (
          <div className="chat-special-bar">
            <button className="special-back-btn" onClick={handleReturnBack}>
              <IconBack />
              <span>返回数据选择</span>
            </button>
          </div>
        )}

        <header className="chat-header">
          {isMobile && (
            <button className="chat-menu-btn" onClick={() => setSidebarOpen(true)}>
              <IconMenu />
            </button>
          )}
          {/* 模型选择器 */}
          <div className="model-picker-wrapper">
            <button
              className={`model-picker-btn ${modelPickerOpen ? 'open' : ''}`}
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
            >
              <span className="model-picker-label">{currentModelLabel}</span>
              <IconChevronDown />
            </button>
            {modelPickerOpen && (
              <div className="model-picker-dropdown">
                {MODEL_OPTIONS.map(opt => (
                  <div
                    key={opt.value || 'default'}
                    className={`model-option ${(currentSession?.model || '') === opt.value ? 'active' : ''}`}
                    onClick={() => handleSelectModel(opt.value)}
                  >
                    {opt.label}
                    {(currentSession?.model || '') === opt.value && <span className="check">✓</span>}
                  </div>
                ))}

                <div className="model-picker-divider" />

                <div
                  className={`model-option balance-option ${balanceInfo.isQuerying ? 'disabled' : ''}`}
                  onClick={() => !balanceInfo.isQuerying && handleQueryBalance()}
                >
                  <span className="balance-label">
                    {balanceInfo.isQuerying
                      ? '查询中...'
                      : balanceInfo.currentBalance !== null
                        ? `${balanceInfo.currentBalance.toFixed(2)} 元`
                        : '余额查询'}
                  </span>
                  {balanceInfo.currentBalance !== null && !balanceInfo.isQuerying && (
                    <span className="balance-refresh-hint">点击刷新</span>
                  )}
                </div>

                {balanceInfo.currentBalance !== null && balanceInfo.lastBalance !== null && (
                  <div className="balance-usage-info">
                    使用 {(balanceInfo.lastBalance - balanceInfo.currentBalance).toFixed(2)} 元
                  </div>
                )}
              </div>
            )}
          </div>

          <h1 className="chat-header-title">{currentSession?.title || 'Chat'}</h1>

          {/* MCP 搜索结果回看按钮 */}
          {currentSession?.mcpSearchResults && currentSession.mcpSearchResults.length > 0 && !selectMode && (
            <button
              className="chat-mcp-back-btn"
              onClick={() => {
                setMcpSearchOpen(true);
                setMcpSelectedIds(new Set(currentSession.mcpSearchResults!.map(r => r.entryId)));
              }}
              title={`查看已选 ${currentSession.mcpSearchResults.length} 条上下文`}
            >
              <IconTool />
              <span className="mcp-back-count">{currentSession.mcpSearchResults.length}</span>
            </button>
          )}

          {messages.length > 0 && !selectMode && (
            <>
              <button className="chat-share-btn" onClick={handleEnterSelectMode} title="分享对话">
                <IconShare />
              </button>
              <button className="chat-clear-btn" onClick={handleClearMessages} title="清空对话">
                <IconTrash />
              </button>
            </>
          )}

          {/* 选中模式：取消 + 已选数量 + 导出按钮 */}
          {selectMode && (
            <>
              <button className="chat-select-cancel-btn" onClick={handleExitSelectMode} title="取消">
                <IconClose2 />
              </button>
              <span className="chat-select-count">
                已选 {selectedMsgIds.size} 条
              </span>
              <button
                className="chat-export-btn"
                onClick={handleExportSelected}
                disabled={selectedMsgIds.size === 0 || isExporting}
                title="导出为图片"
              >
                <IconShare />
                <span>导出为图片</span>
              </button>
            </>
          )}
        </header>

        {/* 消息列表 */}
        <div className="chat-messages" ref={messagesContainerRef}>
          {messages.length === 0 ? (
            <div className="chat-welcome">
              <span className="welcome-icon"><IconMessage /></span>
              <h2 className="welcome-title">开始一段新对话</h2>
              <p className="welcome-hint">
                {settings.ai.apiKey ? '输入消息开始与 AI 对话' : '请先在设置页面配置 AI API Key'}
              </p>
            </div>
          ) : (
            messages.map(msg => {
              const isSelectable = selectMode && msg.role !== 'tool';
              const isSelected = selectedMsgIds.has(msg.id);
              return (
              <div
                key={msg.id}
                className={`chat-message ${msg.role} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''}`}
                data-msg-id={msg.id}
                onClick={isSelectable ? () => handleToggleSelectMsg(msg.id) : undefined}
              >
                {/* 选中模式下显示圆圈 checkbox */}
                {isSelectable && (
                  <div className={`msg-select-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && <IconCheck />}
                  </div>
                )}
                <div className="message-avatar">
                  {msg.role === 'user' ? '我' : msg.role === 'tool' ? '🔧' : 'AI'}
                </div>
                <div className="message-body">
                  {/* 思维链内容（可折叠） */}
                  {msg.reasoningContent && (
                    <details className="reasoning-block" open={isLoading && msg.id === messages[messages.length - 1]?.id}>
                      <summary className="reasoning-summary">
                        <IconBrain />
                        <span>思考过程</span>
                        {msg.thinkingEffort && <span className="reasoning-effort">{msg.thinkingEffort}</span>}
                      </summary>
                      <div className="reasoning-content">{msg.reasoningContent}</div>
                    </details>
                  )}

                  <div
                    className="message-content markdown-body"
                    dangerouslySetInnerHTML={{
                      __html: msg.role === 'assistant'
                        ? renderMarkdown(msg.content || '…')
                        : renderMarkdown(msg.content)
                    }}
                  />

                  {msg.isThinking && !msg.reasoningContent && (
                    <span className="message-tag">深度思考 · {msg.thinkingEffort}</span>
                  )}

                  {msg.toolCallResults && msg.toolCallResults.length > 0 && (
                    <div className="tool-calls">
                      {msg.toolCallResults.map((tc, i) => (
                        <div key={i} className={`tool-call-badge ${tc.success ? 'success' : 'error'}`}>
                          🔧 {tc.name} {tc.success ? '✅' : '❌'}
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.model && msg.role === 'assistant' && (
                    <span className="message-model-tag">{msg.model}</span>
                  )}
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                </div>
              </div>
              );
            })
          )}

          {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
            <div className="chat-message assistant">
              <div className="message-avatar">AI</div>
              <div className="message-body">
                <div className="message-content loading-dots">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* === MCP 搜索面板（半页，支持数据/待办切换）=== */}
        {mcpSearchOpen && (
          <EntryPickerPanel
            selectedIds={mcpSelectedIds}
            onSelectionChange={setMcpSelectedIds}
            onClose={() => setMcpSearchOpen(false)}
            initialMode={mcpPickerMode}
          />
        )}

        {/* 底部输入区 */}
        <footer className="chat-input-area glass">
          <div className="input-toolbar">
            {/* 上传按钮：打开条目选择器 */}
            <button
              className={`toolbar-btn ${pickerSelectedIds.size > 0 ? 'active upload' : ''}`}
              onClick={handleUploadClick}
              title="选择数据作为上下文"
            >
              <IconUpload />
              <span>数据</span>
            </button>

            {/* 深度思考 */}
            <button
              className={`toolbar-btn ${thinkingEnabled ? 'active thinking' : ''}`}
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              title="深度思考模式"
            >
              <IconBrain />
              <span>思考</span>
            </button>

            {/* 思考强度 */}
            {thinkingEnabled && (
              <button
                className={`toolbar-btn effort-btn ${thinkingEffort}`}
                onClick={() => setThinkingEffort(thinkingEffort === 'high' ? 'max' : 'high')}
                title="思考强度"
              >
                {thinkingEffort === 'max' ? 'MAX' : 'High'}
              </button>
            )}

            {/* MCP 开关 - 点击展开选择器面板 */}
            <button
              className={`toolbar-btn ${mcpEnabled ? 'active mcp' : ''}`}
              onClick={() => {
                if (!mcpEnabled) {
                  // 开启 MCP：直接展开类型选择器
                  setMcpEnabled(true);
                  setMcpPickerOpen(true);
                } else {
                  // 关闭 MCP：清空工具并落库
                  setMcpEnabled(false);
                  handleSetSessionMcpTools([]);
                  setMcpPickerOpen(false);
                }
              }}
              title="MCP 桥梁通道（对话级持久化）"
            >
              <IconTool />
              <span>MCP{mcpActiveTools.length > 0 ? ` (${mcpActiveTools.length})` : ''}</span>
            </button>

            {/* MCP 类型选择面板 */}
            {mcpPickerOpen && (
              <div className="mcp-picker-panel glass">
                <div className="mcp-picker-header">
                  <h4>选择 MCP 类型</h4>
                  <button className="mcp-picker-close" onClick={() => setMcpPickerOpen(false)}>
                    <IconClose />
                  </button>
                </div>
                <div className="mcp-picker-options">
                  <button
                    className="mcp-picker-option"
                    onClick={() => {
                      const next = [...new Set([...mcpActiveTools, ...ENTRY_TOOLS])];
                      handleSetSessionMcpTools(next);
                      setMcpPickerOpen(false);
                    }}
                  >
                    <div className="mcp-picker-icon">📊</div>
                    <div className="mcp-picker-text">
                      <div className="mcp-picker-title">数据卡片 MCP</div>
                      <div className="mcp-picker-desc">为本次对话启用数据卡片工具</div>
                    </div>
                  </button>
                  <button
                    className="mcp-picker-option"
                    onClick={() => {
                      const next = [...new Set([...mcpActiveTools, ...TODO_TOOLS])];
                      handleSetSessionMcpTools(next);
                      setMcpPickerOpen(false);
                    }}
                  >
                    <div className="mcp-picker-icon">✅</div>
                    <div className="mcp-picker-text">
                      <div className="mcp-picker-title">待办卡片 MCP</div>
                      <div className="mcp-picker-desc">为本次对话启用待办工具</div>
                    </div>
                  </button>
                  {/* 清空工具按钮：方便用户取消已选的工具 */}
                  {mcpActiveTools.length > 0 && (
                    <button
                      className="mcp-picker-option"
                      onClick={() => {
                        handleSetSessionMcpTools([]);
                        setMcpPickerOpen(false);
                      }}
                    >
                      <div className="mcp-picker-icon">🗑️</div>
                      <div className="mcp-picker-text">
                        <div className="mcp-picker-title">清空已启用工具</div>
                        <div className="mcp-picker-desc">当前已启用 {mcpActiveTools.length} 个工具</div>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 搜索回看按钮 */}
            {mcpEnabled && currentSession?.mcpSearchResults && currentSession.mcpSearchResults.length > 0 && (
              <button
                className="toolbar-btn mcp-back"
                onClick={() => {
                  setMcpSearchOpen(true);
                  setMcpSelectedIds(new Set(currentSession.mcpSearchResults!.map(r => r.entryId)));
                }}
                title="重新选择上下文"
              >
                <IconBack />
                <span>{currentSession.mcpSearchResults.length}</span>
              </button>
            )}
          </div>

          <div className="input-row">
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading}
            />
            {isLoading ? (
              <button className="chat-send-btn stop" onClick={handleStop} title="停止生成">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
            ) : (
              <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim()}>
                <IconSend />
              </button>
            )}
          </div>
        </footer>
      </main>

      {/* === 条目选择器面板 === */}
      {entryPickerOpen && (
        <EntryPickerPanel
          selectedIds={pickerSelectedIds}
          onSelectionChange={setPickerSelectedIds}
          onClose={() => setEntryPickerOpen(false)}
          initialEntryId={pickerInitialEntryId}
        />
      )}

      {/* === 导出中遮罩 === */}
      {isExporting && (
        <div className="chat-export-overlay">
          <div className="chat-export-loading glass">
            <span className="loading-spinner" />
            <span>正在生成图片…</span>
          </div>
        </div>
      )}
    </div>
  );
}
