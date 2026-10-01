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
 *
 * 子组件与工具模块已拆分：
 * - components/：左侧栏、头部、消息列表、输入区
 * - chatTypes / chatUtils / chatStream / chatExport：类型、工具函数、流式请求、图片导出
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  buildToolsPayload,
  accumulateToolCallDeltas,
  parseToolArguments,
  executeToolCall,
  formatToolResultMessage,
  formatToolResultForUI,
  type ResolvedToolCall,
} from '@/services/chatBridge';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { EntryPickerPanel } from '@/components/EntryPickerPanel';
import { IconBack } from '@/components/icons';
import type { Entry, Todo, AIProviderId } from '@/types';
import {
  loadChatSessions,
  saveChatSession as saveSessionDb,
  deleteChatSession as deleteSessionDb,
} from '@/services/chatSessionService';
import { loadSessionsSync, createId, generateTitle, buildModelOptions } from './chatUtils';
import type { ChatMessage, ChatSession, SearchSelectedResult, ThinkingEffort } from './chatTypes';
import { streamChatCompletion } from './chatStream';
import { ChatSidebar } from './components/ChatSidebar';
import { ChatHeader } from './components/ChatHeader';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInputArea } from './components/ChatInputArea';
import './ChatPage.css';

/* === Component === */
export function ChatPage() {
  const settings = useSettingsStore(state => state.settings);

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessionsSync());
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
  // e.2: 「最近」勾选项
  const [recentPickerEnabled, setRecentPickerEnabled] = useState(false);
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

  // e.2: 「最近」勾选项 — 自动选中最近 N 条
  const handleRecentPickerToggle = useCallback(async (enabled: boolean) => {
    setRecentPickerEnabled(enabled);
    if (enabled) {
      const count = settings.ai.recentPickerCount ?? 30;
      const db = await getDatabase();
      const allEntries = await db.getAllEntries();
      const recentIds = allEntries
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, count)
        .map(e => e.id);
      setPickerSelectedIds(new Set(recentIds));
    } else {
      setPickerSelectedIds(new Set());
    }
  }, [settings.ai.recentPickerCount]);

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

  // v2.5.0: 当前激活的付费提供商（providers[provider] 优先，回落扁平字段）
  const activeProviderId: AIProviderId = settings.ai.provider
    || (settings.ai.isDeepSeek ? 'deepseek' : 'openai');
  const activeProvider = settings.ai.providers?.[activeProviderId];
  const providerModel = activeProvider?.model || settings.ai.model || 'deepseek-v4-flash';
  const providerBaseURL = activeProvider?.baseURL || settings.ai.baseURL || 'https://api.deepseek.com';
  const providerAPIKey = activeProvider?.apiKey || settings.ai.apiKey || '';

  // e.4: 智能GLM处理
  const effectiveModel = currentModel === '__glm_smart__' && settings.ai.glm?.enabled
    ? (settings.ai.glm.model || 'glm-4-flash')
    : (currentModel === '' || currentModel === providerModel ? providerModel : currentModel);
  const effectiveBaseURL = currentModel === '__glm_smart__' && settings.ai.glm?.enabled
    ? (settings.ai.glm.baseURL || 'https://open.bigmodel.cn/api/paas/v4')
    : providerBaseURL;
  const effectiveAPIKey = currentModel === '__glm_smart__' && settings.ai.glm?.enabled
    ? (settings.ai.glm.apiKey || '')
    : providerAPIKey;

  // v2.5.0: 模型选项按当前提供商动态生成
  const modelOptions = useMemo(() => buildModelOptions(settings.ai), [settings.ai]);

  // 首次挂载：从数据库异步加载对话历史（覆盖 localStorage 同步初始值）
  useEffect(() => {
    let mounted = true;
    loadChatSessions().then(dbSessions => {
      if (mounted && dbSessions.length > 0) {
        setSessions(prev => {
          // 合并：DB 数据优先，如果没有就用现有的
          return dbSessions.length > 0 ? dbSessions as unknown as ChatSession[] : prev;
        });
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

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

  // 导出选中的消息为图片（DOM 截图逻辑见 chatExport.ts）
  const handleExportSelected = useCallback(async () => {
    if (selectedMsgIds.size === 0) {
      alert('请先选择要导出的消息');
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) return;

    setIsExporting(true);
    try {
      // 性能优化（v2.4.3）：chatExport 静态引入了 html2canvas（体积较大），
      // 而它只在「导出为图片」时用到，改为点击时按需加载。
      const { exportMessagesToImage } = await import('./chatExport');
      await exportMessagesToImage(container, selectedMsgIds);
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
    // 异步写入数据库（不阻塞 UI）
    next.forEach(s => saveSessionDb(s).catch(() => {}));
  }, []);

  const updateSessionMessages = useCallback((sessionId: string, msgs: ChatMessage[]) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === sessionId
        ? { ...s, messages: msgs, updatedAt: Date.now() }
        : s
      );
      // 异步写入数据库
      const updated = next.find(s => s.id === sessionId);
      if (updated) saveSessionDb(updated).catch(() => {});
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
    deleteSessionDb(id).catch(() => {});
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
    if (!providerAPIKey) {
      alert('请先在设置页面配置 AI API Key');
      return;
    }

    setBalanceInfo(prev => ({ ...prev, isQuerying: true }));

    try {
      const baseURL = providerBaseURL.replace(/\/$/, '');
      const balanceURL = `${baseURL}/user/balance`;

      const response = await fetch(balanceURL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${providerAPIKey}`,
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
  }, [providerAPIKey, providerBaseURL, balanceInfo.currentBalance]);

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

    if (!effectiveAPIKey) {
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
      // e.3: 构建系统提示 — 使用 chatSoul 和 dialogueContext 配置
      let systemPrompt = settings.ai.chatSoul || '你是一个友好的AI助手。';

      // e.2: 如果有对话上下文提示词配置，使用它
      if (settings.ai.prompts.dialogueContext) {
        // 简化后的 dialogueContext 仅提供 {currentEntry} {recentEntries} 字段
        const recentEntries = await (async () => {
          try {
            const db = await getDatabase();
            const all = await db.getAllEntries();
            return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
              .map(e => `- ${e.content.slice(0, 80)}`).join('\n');
          } catch { return ''; }
        })();
        systemPrompt += '\n\n' + settings.ai.prompts.dialogueContext
          .replace(/\{currentEntry\}/g, '')
          .replace(/\{recentEntries\}/g, recentEntries);
      }

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
          effectiveBaseURL,
          effectiveAPIKey,
          effectiveModel,
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
          model: effectiveModel,
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

  // 取消重命名
  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  // 打开 MCP 搜索结果面板（回看已选上下文）
  const handleOpenMcpResults = useCallback(() => {
    setMcpSearchOpen(true);
    setMcpSelectedIds(new Set(currentSession?.mcpSearchResults?.map(r => r.entryId) ?? []));
  }, [currentSession]);

  // MCP 开关（未开启时展开类型选择器；关闭时清空工具并收起）
  const handleToggleMcp = useCallback(() => {
    if (!mcpEnabled) {
      setMcpEnabled(true);
      setMcpPickerOpen(true);
    } else {
      setMcpEnabled(false);
      handleSetSessionMcpTools([]);
      setMcpPickerOpen(false);
    }
  }, [mcpEnabled, handleSetSessionMcpTools]);

  // 切换思考强度
  const handleToggleEffort = useCallback(() => {
    setThinkingEffort(thinkingEffort === 'high' ? 'max' : 'high');
  }, [thinkingEffort]);

  return (
    <div className={`chat-page ${isMobile ? 'mobile' : ''} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {/* === 左侧栏 === */}
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        sidebarOpen={sidebarOpen}
        isMobile={isMobile}
        modelOptions={modelOptions}
        renamingId={renamingId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onStartRename={handleStartRename}
        onRenameSubmit={handleRenameSubmit}
        onCancelRename={handleCancelRename}
        onForkSession={handleForkSession}
        onNewChat={handleNewChat}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

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

        <ChatHeader
          isMobile={isMobile}
          onOpenSidebar={() => setSidebarOpen(true)}
          title={currentSession?.title || 'Chat'}
          currentSessionModel={currentSession?.model || ''}
          currentModel={currentModel}
          modelOptions={modelOptions}
          modelPickerOpen={modelPickerOpen}
          onToggleModelPicker={() => setModelPickerOpen(!modelPickerOpen)}
          onSelectModel={handleSelectModel}
          balanceInfo={balanceInfo}
          onQueryBalance={handleQueryBalance}
          messagesCount={messages.length}
          mcpResultsCount={currentSession?.mcpSearchResults?.length ?? 0}
          onOpenMcpResults={handleOpenMcpResults}
          selectMode={selectMode}
          selectedCount={selectedMsgIds.size}
          isExporting={isExporting}
          onEnterSelectMode={handleEnterSelectMode}
          onExitSelectMode={handleExitSelectMode}
          onClearMessages={handleClearMessages}
          onExportSelected={handleExportSelected}
        />

        {/* 消息列表 */}
        <ChatMessageList
          messages={messages}
          selectMode={selectMode}
          selectedMsgIds={selectedMsgIds}
          isLoading={isLoading}
          hasApiKey={!!providerAPIKey}
          containerRef={messagesContainerRef}
          endRef={messagesEndRef}
          onToggleSelect={handleToggleSelectMsg}
        />

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
        <ChatInputArea
          pickerSelectedCount={pickerSelectedIds.size}
          onOpenPicker={handleUploadClick}
          recentPickerEnabled={recentPickerEnabled}
          onToggleRecent={handleRecentPickerToggle}
          thinkingEnabled={thinkingEnabled}
          onToggleThinking={() => setThinkingEnabled(!thinkingEnabled)}
          thinkingEffort={thinkingEffort}
          onToggleEffort={handleToggleEffort}
          mcpEnabled={mcpEnabled}
          mcpPickerOpen={mcpPickerOpen}
          mcpActiveTools={mcpActiveTools}
          onToggleMcp={handleToggleMcp}
          onCloseMcpPicker={() => setMcpPickerOpen(false)}
          onSetMcpTools={handleSetSessionMcpTools}
          mcpSearchCount={currentSession?.mcpSearchResults?.length ?? 0}
          onOpenMcpResults={handleOpenMcpResults}
          input={input}
          onInputChange={setInput}
          onKeyDown={handleKeyDown}
          isLoading={isLoading}
          onSend={handleSend}
          onStop={handleStop}
          textareaRef={textareaRef}
        />
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
