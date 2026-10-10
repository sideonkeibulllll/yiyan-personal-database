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
  DANGEROUS_TOOLS,
  describeToolAction,
  MEMORY_TOOLS,
  type ResolvedToolCall,
} from '@/services/chatBridge';
import { getMemoryPromptSection } from '@/services/aiMemory';
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
import { loadSessionsSync, createId, generateTitle, buildModelOptions, parseModelValue, truncateApiMessagesSafely } from './chatUtils';
import type { ApiMessage } from './chatUtils';
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

  // 从 QuickMenu「就此内容谈话」跳转处理 + 预备列表消费
  // v2.6.3: 预备列表**不再依赖 entryId** —— 此前只有带 entryId 进来才会读取，
  // 导致「只加了预备、然后直接点底部导航进 Chat」时预备永远不生效。
  useEffect(() => {
    const entryId = searchParams.get('entryId');
    const from = searchParams.get('from');
    const PREPARED_KEY = '__yiyan_prepared_entry_ids__';
    const prepared: string[] = (window as any)[PREPARED_KEY] || [];

    if (!entryId && prepared.length === 0) return;

    if (entryId) setPickerInitialEntryId(entryId);
    const allIds = new Set<string>([...(entryId ? [entryId] : []), ...prepared]);
    setPickerSelectedIds(allIds);
    setEntryPickerOpen(true);
    if (from) {
      setReturnTarget(from);
    }
    // 注意：预备列表在发送对话后清除（handleSend finally 中，且仅当本次确实消费过）
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
  /** 危险操作的确认 resolver：confirmId → resolve(approved)。agent loop 停在这里等用户点击 */
  const confirmResolversRef = useRef<Map<string, (approved: boolean) => void>>(new Map());
  // v2.6.3: 本次发送是否实际消费了「预备列表」（决定发送后是否清除）
  const consumedPreparedRef = useRef(false);

  const currentSession = sessions.find(s => s.id === currentSessionId) || null;
  const messages = currentSession?.messages ?? [];
  const currentModel = currentSession?.model || '';

  // v2.5.1: 当前激活的付费提供商（会话未指定模型时的兜底）
  const activeProviderId: AIProviderId = settings.ai.provider || 'deepseek';
  const activeProvider = settings.ai.providers?.[activeProviderId];
  const providerModel = activeProvider?.model || settings.ai.model || 'deepseek-v4-flash';
  const providerBaseURL = activeProvider?.baseURL || settings.ai.baseURL || 'https://api.deepseek.com';
  const providerAPIKey = activeProvider?.apiKey || settings.ai.apiKey || '';

  /**
   * v2.5.1 关键解离：
   * 会话里存的是模型选择器的复合值 `providerId::model`，
   * 选中哪个模型就用**那个提供商**的 baseURL / apiKey，无需回设置页切 provider。
   * 旧会话存的是裸模型名 → parseModelValue 返回 providerId=null，回落当前激活提供商。
   */
  const parsed = parseModelValue(currentModel);
  const isGlmSession = currentModel === '__glm_smart__';
  const useGlm = isGlmSession && !!settings.ai.glm?.enabled;

  // 实际使用的提供商（GLM 场景除外）
  const effectiveProviderId: AIProviderId = parsed.providerId || activeProviderId;
  const effectiveProvider = settings.ai.providers?.[effectiveProviderId];
  const effProviderBaseURL = effectiveProvider?.baseURL || providerBaseURL;
  const effProviderAPIKey = effectiveProvider?.apiKey || providerAPIKey;

  // e.4: 智能GLM处理
  const effectiveModel = useGlm
    ? (settings.ai.glm?.model || 'glm-4-flash')
    : (parsed.model || providerModel);
  const effectiveBaseURL = useGlm
    ? (settings.ai.glm?.baseURL || 'https://open.bigmodel.cn/api/paas/v4')
    : effProviderBaseURL;
  const effectiveAPIKey = useGlm
    ? (settings.ai.glm?.apiKey || '')
    : effProviderAPIKey;

  // v2.5.1: 模型选项按 provider 分组（跨提供商可选）
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

  /** 用户点击危险操作确认卡片：resolve 对应的 resolver，让 agent loop 继续 */
  const resolveConfirm = useCallback((confirmId: string, approved: boolean) => {
    const resolver = confirmResolversRef.current.get(confirmId);
    if (resolver) resolver(approved);
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
    // v2.11.0: 思考模式同样对话级持久化（切走再切回不丢失）
    setThinkingEnabled(s?.thinkingEnabled ?? false);
    setThinkingEffort(s?.thinkingEffort ?? 'high');
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
    // v2.11.0: 按钮亮灭与工具数量自洽（面板里清空全部工具 → 按钮自动熄灭）
    setMcpEnabled(toolNames.length > 0);
    if (!currentSessionId) return;
    persistSessions(sessions.map(s => s.id === currentSessionId
      ? { ...s, mcpEnabledTools: toolNames }
      : s
    ));
  }, [currentSessionId, sessions, persistSessions]);

  /* === v2.11.0: 思考模式对话级持久化（与 mcpEnabledTools 同机制）=== */
  const persistThinkingState = useCallback((patch: { thinkingEnabled?: boolean; thinkingEffort?: ThinkingEffort }) => {
    if (!currentSessionId) return;
    persistSessions(sessions.map(s => s.id === currentSessionId ? { ...s, ...patch } : s));
  }, [currentSessionId, sessions, persistSessions]);

  /* === 新建对话 === */
  const handleNewChat = useCallback(() => {
    const emptySession = sessions.find(s => s.messages.length === 0);
    if (emptySession) {
      // 复用已有空会话时，把当前思考模式同步过去（v2.11.0：新对话继承当前开关，避免"刚开了又关"）
      persistSessions(sessions.map(s => s.id === emptySession.id ? { ...s, thinkingEnabled, thinkingEffort } : s));
      setCurrentSessionId(emptySession.id);
    } else {
      const newSession: ChatSession = {
        id: createId(),
        title: '新对话',
        messages: [],
        // v2.11.0: 新建对话继承当前思考模式（MCP 工具保持从零开始）
        thinkingEnabled,
        thinkingEffort,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      persistSessions([newSession, ...sessions]);
      setCurrentSessionId(newSession.id);
    }
    setInput('');
    setMcpSelectedIds(new Set());
    if (isMobile) setSidebarOpen(false);
  }, [sessions, persistSessions, isMobile, thinkingEnabled, thinkingEffort]);

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
      // v2.11.0: 思考模式随对话一起复制
      thinkingEnabled: source.thinkingEnabled,
      thinkingEffort: source.thinkingEffort,
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
    // 若正卡在危险操作确认上，先放行（当作取消），避免 loop 永久挂起
    confirmResolversRef.current.forEach(resolve => resolve(false));
    confirmResolversRef.current.clear();
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

    // v2.6.3: 记录本次是否有预备条目被消费（发送后据此决定是否清除，避免误清）
    const preparedIds: string[] = (window as any)['__yiyan_prepared_entry_ids__'] || [];
    consumedPreparedRef.current = preparedIds.length > 0;

    // 确保 session 存在
    // v2.11.0 修复：无会话直接发送时的新建分支，后续更新必须基于「包含新会话」的数组。
    // 旧代码新建后仍用 sessions 旧快照做 map —— 会把刚创建的会话从 state 覆盖掉，
    // 导致首条消息不显示、messages/thinkingEnabled 等状态永远无法落库。
    let sessionId = currentSessionId ?? createId();
    let session = sessions.find(s => s.id === sessionId);
    let baseSessions = sessions;

    if (!session) {
      session = {
        id: sessionId,
        title: generateTitle(text),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      baseSessions = [session, ...sessions];
      persistSessions(baseSessions);
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
    persistSessions(baseSessions.map(s => s.id === sessionId ? updatedSession : s));
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
      // e.3: 构建系统提示 — 仅使用 chatSoul。
      // 隐私说明：不再无条件注入最近条目。笔记内容只在用户显式勾选
      // 「发送最近条目」时，通过下方 context 注入流程加入，避免误发隐私数据。
      let systemPrompt = settings.ai.chatSoul || '你是一个友好的AI助手。';

      // v2.11.0: 长期记忆注入（仅当开关打开；全本地数据、用户可在设置页管理）
      if (settings.context.enableLongTermMemory) {
        const memorySection = getMemoryPromptSection();
        systemPrompt += `\n\n## 长期记忆\n以下是你此前记住的关于用户的信息（回答时自然运用，不必刻意提及）：\n${memorySection || '（暂无）'}\n\n如果在对话中发现值得长期记住的新信息（用户的偏好、习惯、重要事实等），可调用 save_ai_memory 保存；信息有变化时用 update_ai_memory 修正。不要记录无关紧要或一次性的内容。`;
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

      // 构建 API 消息，保留 assistant 的 tool_calls 与 tool 消息的 tool_call_id，
      // 以便 agent loop 第二轮起模型能看到完整上下文。
      const buildApiMessage = (m: ChatMessage): ApiMessage | null => {
        if (m.role === 'user') return { role: 'user', content: m.content };
        if (m.role === 'assistant') {
          // 丢弃「无内容且无 tool_calls」的空 assistant（agent loop 命中上限时
          // 会残留一个空占位消息），避免污染上下文 / 触发部分网关的校验错误。
          if (!m.content?.trim() && (!m.toolCalls || m.toolCalls.length === 0)) {
            return null;
          }
          const msg: ApiMessage = {
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

      // 保 tool_calls / tool 配对的智能截断：直接 slice 会把 assistant(tool_calls)
      // 与其 tool 结果切开 → 服务端 400 "role 'tool' must be a response to a preceding
      // message with 'tool_calls'"（且孤儿永久留档 → 后续每条都报错）。
      const apiHistory = updatedMessages
        .map(buildApiMessage)
        .filter(Boolean) as ApiMessage[];
      const apiMessages: ApiMessage[] = [
        { role: 'system', content: systemPrompt },
        ...truncateApiMessagesSafely(apiHistory, 21),
      ];

      // 工具 schema（替代旧的提示词注入）
      // v2.11.0: 长期记忆工具跟随设置开关自动启用（不走 MCP 组勾选）
      const memoryTools = settings.context.enableLongTermMemory ? MEMORY_TOOLS : [];
      const enabledTools = [
        ...(mcpEnabled ? (session.mcpEnabledTools ?? mcpActiveTools) : []),
        ...memoryTools,
      ];
      const toolsPayload = buildToolsPayload(enabledTools);

      // === Agent loop ===
      // 每次 streamChatCompletion 返回 finish_reason='tool_calls' 时，
      // 执行工具→追加 tool 消息→新建 AI 占位→再次请求，循环直到模型不再调用工具。
      const abortCtrl = new AbortController();
      abortRef.current = abortCtrl;

      let loopMessages = [...apiMessages];       // 传给 API 的消息序列（循环中追加）
      let loopDisplayMsgs = [...currentMsgs];   // UI 显示的消息序列（含初始 AI 占位）
      let currentAiMsgId = aiMsgId;

      // 循环轮数上限（防止无限循环）
      const MAX_ITERATIONS = 12;
      // 本次对话累计工具调用次数预算（批量场景比「轮数」更合理）
      const MAX_TOOL_CALLS = 20;
      let iteration = 0;
      let toolCallBudget = MAX_TOOL_CALLS;
      let hitLimit = false;

      // 危险操作确认：把确认卡片插入对话，阻塞等待用户点击「确认 / 取消」。
      // 未确认前不执行、不返回，agent loop 停在这一行。
      const requestConfirm = (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
        return new Promise<boolean>(resolve => {
          const confirmId = createId();
          const summary = describeToolAction(toolName, args);
          const confirmMsg: ChatMessage = {
            id: createId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            confirmRequest: { id: confirmId, toolName, summary, status: 'pending' },
          };
          confirmResolversRef.current.set(confirmId, (approved: boolean) => {
            confirmResolversRef.current.delete(confirmId);
            loopDisplayMsgs = loopDisplayMsgs.map(m =>
              m.id === confirmMsg.id && m.confirmRequest
                ? { ...m, confirmRequest: { ...m.confirmRequest, status: approved ? 'approved' : 'rejected' } }
                : m
            );
            updateSessionMessages(sessionId, loopDisplayMsgs);
            resolve(approved);
          });
          loopDisplayMsgs = [...loopDisplayMsgs, confirmMsg];
          updateSessionMessages(sessionId, loopDisplayMsgs);
        });
      };

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
          // 全局工具调用预算：耗尽后不再执行，但仍返回占位结果以保持配对完整
          if (toolCallBudget <= 0) {
            hitLimit = true;
            const skipped = { success: false, error: '已达到本次对话的工具调用次数上限，该操作未执行' };
            apiToolMessages.push(formatToolResultMessage(skipped, tc.id));
            toolCallResults.push({
              name: tc.function.name,
              success: false,
              summary: formatToolResultForUI(skipped, tc.function.name),
            });
            continue;
          }
          toolCallBudget--;

          const args = parseToolArguments(tc.function.arguments);

          // 危险操作（删除类）：先请求用户确认，用户点「确认」才执行
          if (DANGEROUS_TOOLS.has(tc.function.name)) {
            const approved = await requestConfirm(tc.function.name, args);
            if (!approved) {
              const cancelled = { success: false, error: '用户取消了该操作，未执行' };
              apiToolMessages.push(formatToolResultMessage(cancelled, tc.id));
              toolCallResults.push({
                name: tc.function.name,
                success: false,
                summary: formatToolResultForUI(cancelled, tc.function.name),
              });
              continue;
            }
          }

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

        // 工具预算耗尽：结束循环，让用户决定是否继续
        if (toolCallBudget <= 0) {
          hitLimit = true;
          break;
        }

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
      // v2.6.3: 仅当本次确实消费过预备列表时才清除（此前无条件清除会误清未使用的预备）
      if (consumedPreparedRef.current) {
        delete (window as any)['__yiyan_prepared_entry_ids__'];
        consumedPreparedRef.current = false;
      }
      // 注意：MCP 工具激活改为对话级持久化（session.mcpEnabledTools），
      // 不再在每次发送后清空，让用户在一次对话内可以连续多次调用工具。
    }
  }, [input, isLoading, settings, currentSessionId, sessions, persistSessions, updateSessionMessages, thinkingEnabled, thinkingEffort, mcpEnabled, mcpActiveTools, currentModel, pickerSelectedIds]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 手机端/桌面端统一：裸 Enter 换行（不拦截），仅 Ctrl/Cmd+Enter 发送；
    // 发送也可以直接点右侧发送按钮。Shift+Enter 仍是系统默认换行。
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  /* === 输入框撤销 / 重做（模拟 Ctrl+Z / Ctrl+Y，供手机端点击）===
   * 浏览器原生撤销栈在受控 textarea 下会被 React 重渲染打断，
   * 这里自己维护快照栈：记录「上一次 input 变化前的值 + 光标位置」。 */
  const inputHistoryRef = useRef<{ stack: string[]; index: number }>({ stack: [''], index: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);
  const lastInputRef = useRef('');
  const inputRefMirror = useRef('');

  // 每次 input 变化时压栈（超过 60 步丢弃最旧）
  useEffect(() => {
    const h = inputHistoryRef.current;
    const prevSnapshot = inputRefMirror.current;
    if (prevSnapshot === input) return;
    // 若上一次操作是撤销/重做（index 不在末尾），先截断分叉
    if (h.index < h.stack.length - 1) {
      h.stack = h.stack.slice(0, h.index + 1);
    }
    h.stack.push(input);
    if (h.stack.length > 60) h.stack.shift();
    h.index = h.stack.length - 1;
    inputRefMirror.current = input;
    setHistoryVersion(v => v + 1);
  }, [input]);

  const applyHistoryValue = useCallback((value: string) => {
    setInput(value);
    inputRefMirror.current = value;
    setHistoryVersion(v => v + 1);
    // 光标移到末尾
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) ta.setSelectionRange(value.length, value.length);
    });
  }, []);

  const canUndo = inputHistoryRef.current.index > 0;
  const canRedo = inputHistoryRef.current.index < inputHistoryRef.current.stack.length - 1;

  const handleUndo = useCallback(() => {
    const h = inputHistoryRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    applyHistoryValue(h.stack[h.index]);
  }, [applyHistoryValue]);

  const handleRedo = useCallback(() => {
    const h = inputHistoryRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    applyHistoryValue(h.stack[h.index]);
  }, [applyHistoryValue]);
  void historyVersion; // 仅用于触发按钮可用态刷新

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

  // MCP 按钮：点击始终展开 / 切换 MCP 选择面板（v2.11.0）
  // 不再"亮着时点击=一键清空所有工具"（极易误触丢配置）；
  // "全部关闭"操作由面板底部的「清空已启用工具」按钮承载。
  const handleToggleMcp = useCallback(() => {
    setMcpPickerOpen(prev => !prev);
  }, []);

  // 切换思考模式开关（v2.11.0: 对话级持久化）
  const handleToggleThinking = useCallback(() => {
    const next = !thinkingEnabled;
    setThinkingEnabled(next);
    persistThinkingState({ thinkingEnabled: next });
  }, [thinkingEnabled, persistThinkingState]);

  // 切换思考强度（v2.11.0: 对话级持久化）
  const handleToggleEffort = useCallback(() => {
    const next = thinkingEffort === 'high' ? 'max' : 'high';
    setThinkingEffort(next);
    persistThinkingState({ thinkingEffort: next });
  }, [thinkingEffort, persistThinkingState]);

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
          onConfirmAction={resolveConfirm}
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
          onToggleThinking={handleToggleThinking}
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
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          isMobile={isMobile}
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
