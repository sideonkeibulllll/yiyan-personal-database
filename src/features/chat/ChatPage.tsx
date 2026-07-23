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
  getToolsSystemPrompt,
  parseToolCall,
  executeToolCall,
  formatToolResult,
  ALL_TOOL_NAMES,
} from '@/services/chatBridge';
import { getDatabase } from '@/services/database';
import { EntryPickerPanel } from '@/components/EntryPickerPanel';
import type { Entry } from '@/types';
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
  toolCalls?: { name: string; result: string; success: boolean }[];
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
}

async function streamChatCompletion(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  thinkingEnabled: boolean,
  reasoningEffort: ThinkingEffort | null,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<void> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };

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
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        // 思维链内容
        if (delta.reasoning_content) {
          callbacks.onReasoning(delta.reasoning_content);
        }
        // 正文内容
        if (delta.content) {
          callbacks.onContent(delta.content);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
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

      // MCP 工具注入（按需）
      if (mcpEnabled) {
        const toolsPrompt = getToolsSystemPrompt(ALL_TOOL_NAMES);
        if (toolsPrompt) {
          systemPrompt += '\n' + toolsPrompt;
        }
      }

      // MCP 搜索结果注入
      if (session.mcpSearchResults && session.mcpSearchResults.length > 0) {
        const resultsText = session.mcpSearchResults.map((r, i) =>
          `[${i + 1}] (ID: ${r.entryId}) ${r.content}${r.source ? ` [来源: ${r.source}]` : ''}`
        ).join('\n');
        systemPrompt += `\n\n## 用户选择的记忆库条目\n用户选择了以下条目作为对话上下文：\n${resultsText}\n`;
      }

      // === 修复 3：注入 pickerSelectedIds 作为对话上下文 ===
      if (pickerSelectedIds.size > 0) {
        try {
          const db = await getDatabase();
          const pickerEntries: Entry[] = [];
          for (const eid of pickerSelectedIds) {
            const e = await db.getEntryById(eid);
            if (e) pickerEntries.push(e);
          }
          if (pickerEntries.length > 0) {
            const pickerText = pickerEntries.map((e, i) =>
              `[${i + 1}] (ID: ${e.id}) ${e.content}${e.source ? ` [来源: ${e.source}]` : ''}${e.supplement ? ` [补充: ${e.supplement}]` : ''}`
            ).join('\n');
            systemPrompt += `\n\n## 用户选择的数据上下文\n用户选择了以下条目作为本次对话的参考数据：\n${pickerText}\n`;
          }
        } catch (err) {
          console.error('加载选中条目失败:', err);
        }
      }

      // 构建 API 消息（保留最近20条 + system）
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...updatedMessages
          .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
          .map(m => ({ role: m.role, content: m.content })),
      ].slice(-22);

      // 流式读取
      let fullContent = '';
      let fullReasoning = '';
      const abortCtrl = new AbortController();
      abortRef.current = abortCtrl;

      await streamChatCompletion(
        settings.ai.baseURL,
        settings.ai.apiKey,
        currentModel,
        apiMessages,
        thinkingEnabled,
        thinkingEnabled ? thinkingEffort : null,
        {
          onReasoning: (chunk) => {
            fullReasoning += chunk;
            currentMsgs = currentMsgs.map(m =>
              m.id === aiMsgId ? { ...m, reasoningContent: fullReasoning } : m
            );
            updateSessionMessages(sessionId, currentMsgs);
          },
          onContent: (chunk) => {
            fullContent += chunk;
            currentMsgs = currentMsgs.map(m =>
              m.id === aiMsgId ? { ...m, content: fullContent } : m
            );
            updateSessionMessages(sessionId, currentMsgs);
          },
        },
        abortCtrl.signal,
      );

      // 流式结束后解析工具调用
      if (mcpEnabled) {
        const toolCall = parseToolCall(fullContent);
        if (toolCall) {
          const toolResult = await executeToolCall(toolCall.toolName, toolCall.arguments);
          const resultStr = formatToolResult(toolResult);

          // 更新 AI 消息 — 移除工具调用标签，保留 beforeText
          currentMsgs = currentMsgs.map(m =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: toolCall.beforeText || '(已执行工具操作)',
                  toolCalls: [{ name: toolCall.toolName, result: resultStr, success: toolResult.success }],
                }
              : m
          );

          // 追加 tool 结果消息
          const toolMsg: ChatMessage = {
            id: createId(),
            role: 'tool' as const,
            content: toolResult.success
              ? `✅ ${toolCall.toolName} 执行成功：${JSON.stringify(toolResult.data)}`
              : `❌ ${toolCall.toolName} 执行失败：${toolResult.error}`,
            timestamp: Date.now(),
          };
          currentMsgs = [...currentMsgs, toolMsg];
          updateSessionMessages(sessionId, currentMsgs);

          // 如果有 afterText，自动发起续接请求
          if (toolCall.afterText) {
            // 将 afterText 作为 AI 的继续内容
            currentMsgs = currentMsgs.map(m =>
              m.id === aiMsgId
                ? { ...m, content: (toolCall.beforeText || '(已执行工具操作)') + '\n\n' + toolCall.afterText }
                : m
            );
            updateSessionMessages(sessionId, currentMsgs);
          }
        }
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
    }
  }, [input, isLoading, settings, currentSessionId, sessions, persistSessions, updateSessionMessages, thinkingEnabled, thinkingEffort, mcpEnabled, currentModel, pickerSelectedIds]);

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
          {currentSession?.mcpSearchResults && currentSession.mcpSearchResults.length > 0 && (
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

          {messages.length > 0 && (
            <button className="chat-clear-btn" onClick={handleClearMessages} title="清空对话">
              <IconTrash />
            </button>
          )}
        </header>

        {/* 消息列表 */}
        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-welcome">
              <span className="welcome-icon"><IconMessage /></span>
              <h2 className="welcome-title">开始一段新对话</h2>
              <p className="welcome-hint">
                {settings.ai.apiKey ? '输入消息开始与 AI 对话' : '请先在设置页面配置 AI API Key'}
              </p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
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

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="tool-calls">
                      {msg.toolCalls.map((tc, i) => (
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
            ))
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
                setMcpEnabled(!mcpEnabled);
                if (!mcpEnabled) {
                  setMcpPickerOpen(true);
                }
              }}
              title="MCP 桥梁通道"
            >
              <IconTool />
              <span>MCP</span>
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
                      setMcpSearchOpen(true);
                      setMcpPickerOpen(false);
                    }}
                  >
                    <div className="mcp-picker-icon">📊</div>
                    <div className="mcp-picker-text">
                      <div className="mcp-picker-title">数据卡片 MCP</div>
                      <div className="mcp-picker-desc">从记忆库选择条目作为上下文</div>
                    </div>
                  </button>
                  <button
                    className="mcp-picker-option"
                    onClick={() => {
                      setMcpSearchOpen(true);
                      setMcpPickerMode('todo');
                      setMcpPickerOpen(false);
                    }}
                  >
                    <div className="mcp-picker-icon">✅</div>
                    <div className="mcp-picker-text">
                      <div className="mcp-picker-title">待办卡片 MCP</div>
                      <div className="mcp-picker-desc">从待办选择任务作为上下文</div>
                    </div>
                  </button>
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
    </div>
  );
}
