/**
 * 首页 - 录入页面
 * 极简输入框 + 粘贴/发送按钮
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clipboard } from '@capacitor/clipboard';
import { Capacitor } from '@capacitor/core';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTodoTagStore } from '@/stores/todoTagStore';
import type { Todo } from '@/types';
import { TagSelector } from '@/components/TagSelector/TagSelector';
import { BottomNav } from '@/components/BottomNav';
import { getDatabase } from '@/services/database';
import { pickImages, takePhoto, type SelectedImage } from '@/services/attachmentService';
import { isElectron } from '@/services/electronAdapter';
import './HomePage.css';

type InputMode = 'input' | 'tag' | 'info';

/** 暖色调色板（8 种交替分配，与待办管理器/待办页一致） */
const COLOR_PALETTE = [
  '#f76707', // 鲜橙
  '#f59f00', // 琥珀金
  '#fa5252', // 珊瑚红
  '#e67700', // 暗琥珀
  '#d6336c', // 暖玫瑰
  '#f08c00', // 金橙
  '#c04509', // 深铜
  '#e8590c', // 焦橙
];

/** 快捷时间预设
 * type: 'relative' = 基于已选时间递增/递减 (e.g. -10min, +30min)
 * type: 'absolute' = 绝对时间 (e.g. 当前时间, 明天6点)
 */
const QUICK_TIME_PRESETS: { label: string; offsetMinutes: number; type: 'relative' | 'absolute' }[] = [
  { label: '-10分钟', offsetMinutes: -10, type: 'relative' },
  { label: '当前时间', offsetMinutes: 0, type: 'absolute' },
  { label: '+30分钟', offsetMinutes: 30, type: 'relative' },
  { label: '+1小时', offsetMinutes: 60, type: 'relative' },
  { label: '+4小时', offsetMinutes: 240, type: 'relative' },
  { label: '明天6点', offsetMinutes: -3, type: 'absolute' }, // 特殊值
];

/** 获取当天指定小时的时间戳 */
function getTodayAtHour(hour: number): number {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

/** 获取明天指定小时的时间戳 */
function getTomorrowAtHour(hour: number): number {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  now.setHours(hour, 0, 0, 0);
  return now.getTime();
}

/** 格式化倒计时（天/时/分/秒，紧凑） */
function formatCountdownCompact(ms: number): string {
  if (ms <= 0) return '已结束';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}天${hours}时${minutes}分`;
  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

/** 格式化时间为 HH:MM */
function formatTimeShort(ts?: number): string {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 将时间戳转为本地 datetime-local 格式 (不使用 ISO，避免时区问题) */
function toLocalDatetimeInput(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** 将时间戳转为 YYYY-MM-DD */
function timestampToFolderDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Clipboard SVG icon */
const ClipboardIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

/** Send SVG icon */
const SendIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/** Tag SVG icon */
const TagIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

/** Paperclip/Attachment SVG icon */
const PaperclipIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

/** Stacked cards SVG icon */
const CardsIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="16" height="14" rx="2" />
    <rect x="6" y="4" width="16" height="14" rx="2" />
  </svg>
);

/** Search SVG icon */
const SearchIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

/** Image SVG icon (相册选图) */
const ImageIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

/** Camera SVG icon (拍照) */
const CameraIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

/** Close (×) SVG icon */
const CloseSmIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export function HomePage() {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<InputMode>('input');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [lastEntryContent, setLastEntryContent] = useState<string | null>(null);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const [isTodoMode, setIsTodoMode] = useState(false);
  const [todoStartTime, setTodoStartTime] = useState<number | undefined>(undefined);
  const [todoEndTime, setTodoEndTime] = useState<number | undefined>(undefined);
  const [todoIsToday, setTodoIsToday] = useState(true);
  const [showTodoAdvanced, setShowTodoAdvanced] = useState(false);
  const [lastTodoId, setLastTodoId] = useState<string | null>(null);

  // === 顶部待办卡片（pin + 自动补满） ===
  // 2 个 slot：timed（有 startTime/endTime）、untimed（无时间）。各显示 1 条。
  // pin 优先；pin 的待办过期（timed）或完成（untimed）后自动移除；空 slot 自动选取补满。
  const [pinnedTimedId, setPinnedTimedId] = useState<string | null>(
    () => localStorage.getItem('yiyan_input_pinned_timed'),
  );
  const [pinnedUntimedId, setPinnedUntimedId] = useState<string | null>(
    () => localStorage.getItem('yiyan_input_pinned_untimed'),
  );
  const [allTodos, setAllTodos] = useState<Todo[]>([]);
  const [now, setNow] = useState(Date.now());

  // 录入时待保存的图片
  const [pendingImages, setPendingImages] = useState<SelectedImage[]>([]);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();
  const addEntry = useEntryStore(state => state.addEntry);
  const addTagToEntry = useTagStore(state => state.addTagToEntry);
  const removeTagFromEntry = useTagStore(state => state.removeTagFromEntry);
  const getTagsByEntryId = useTagStore(state => state.getTagsByEntryId);
  const addTodo = useTodoStore(state => state.addTodo);
  const todoTags = useTodoTagStore(state => state.tags);

  // 显示轻提示（提前定义，供后续 useEffect/回调使用）
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, []);

  // 自动聚焦（仅 PC 端；手机端进入时不主动吊起键盘，由用户点击输入框唤起）
  useEffect(() => {
    if (mode === 'input' && textareaRef.current && Capacitor.getPlatform() === 'web') {
      textareaRef.current.focus();
    }
  }, [mode]);

  // 监听待办页"添加到录入"事件 → pin 到对应 slot（不填输入框）
  // pin 优先 + 自动补满：用户手动 pin 的占对应 slot（timed/untimed），其余 slot 自动选取补满
  useEffect(() => {
    const handleAddToInput = (e: Event) => {
      const detail = (e as CustomEvent<{ todoId: string; title: string; startTime?: number; endTime?: number }>).detail;
      if (!detail?.todoId) return;
      const isTimed = !!(detail.startTime && detail.endTime);
      if (isTimed) {
        localStorage.setItem('yiyan_input_pinned_timed', detail.todoId);
        setPinnedTimedId(detail.todoId);
      } else {
        localStorage.setItem('yiyan_input_pinned_untimed', detail.todoId);
        setPinnedUntimedId(detail.todoId);
      }
      showToastMessage(`已置顶: ${detail.title}`);
    };
    window.addEventListener('yiyan-add-to-input', handleAddToInput);
    return () => {
      window.removeEventListener('yiyan-add-to-input', handleAddToInput);
    };
  }, [showToastMessage]);

  // 加载所有待办 + 每秒 tick（倒计时 + 周期性 reload 同步完成/删除状态）
  // 同时加载待办标签（用于卡片颜色）
  const loadTodoTags = useTodoTagStore(state => state.loadTags);
  useEffect(() => {
    let tick = 0;
    const loadAll = async () => {
      try {
        const { getTodoDatabase } = await import('@/services/todoDatabase');
        const db = await getTodoDatabase();
        const todos = await db.getAllTodos();
        setAllTodos(todos);
      } catch (err) {
        console.error('[HomePage] 加载待办失败:', err);
      }
    };
    loadAll();
    loadTodoTags();
    const timer = setInterval(() => {
      setNow(Date.now());
      tick++;
      if (tick % 10 === 0) loadAll(); // 每 10 秒 reload 一次
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // pin 失效自动清理（timed：过期/完成/删除；untimed：完成/删除）
  useEffect(() => {
    if (!pinnedTimedId) return;
    const t = allTodos.find(x => x.id === pinnedTimedId);
    const invalid = !t || t.status !== 'pending' || t.deletedAt ||
      !t.startTime || !t.endTime || t.endTime <= now;
    if (invalid) {
      localStorage.removeItem('yiyan_input_pinned_timed');
      setPinnedTimedId(null);
    }
  }, [pinnedTimedId, allTodos, now]);

  useEffect(() => {
    if (!pinnedUntimedId) return;
    const t = allTodos.find(x => x.id === pinnedUntimedId);
    const invalid = !t || t.status !== 'pending' || t.deletedAt || t.startTime || t.endTime;
    if (invalid) {
      localStorage.removeItem('yiyan_input_pinned_untimed');
      setPinnedUntimedId(null);
    }
  }, [pinnedUntimedId, allTodos]);

  // === 顶部卡片颜色获取 ===
  // 取最后一个标签的颜色，无标签则用 COLOR_PALETTE 轮换（基于 createdAt 哈希，分配后不变）
  const getTodoCardColor = useCallback((todo: Todo): string => {
    if (todo.tagIds && todo.tagIds.length > 0) {
      const lastTagId = todo.tagIds[todo.tagIds.length - 1];
      const tag = todoTags.find(t => t.id === lastTagId);
      if (tag?.color) return tag.color;
    }
    // 无标签：用 createdAt 哈希取调色板，确保分配后不变
    const hash = Math.floor(todo.createdAt / 1000) % COLOR_PALETTE.length;
    return COLOR_PALETTE[hash];
  }, [todoTags]);

  // === 顶部卡片选取算法 ===
  // timed slot：pin 优先；失效则 auto 选取
  //   优先级1：当前在 period 内（startTime <= now <= endTime）→ endTime 最早
  //   优先级2：未来候选 → startTime 最早；若相同 → duration 最短
  const timedCard = useMemo<Todo | null>(() => {
    if (pinnedTimedId) {
      const t = allTodos.find(x => x.id === pinnedTimedId);
      if (t && t.status === 'pending' && !t.deletedAt && t.startTime && t.endTime && t.endTime > now) {
        return t;
      }
    }
    const candidates = allTodos.filter(x =>
      x.status === 'pending' && !x.deletedAt &&
      x.startTime && x.endTime && x.endTime > now,
    );
    if (candidates.length === 0) return null;
    const inPeriod = candidates.filter(x => x.startTime! <= now && x.endTime! >= now);
    if (inPeriod.length > 0) {
      return inPeriod.reduce((a, b) => (a.endTime! < b.endTime! ? a : b));
    }
    const future = candidates.filter(x => x.startTime! > now);
    if (future.length === 0) return null;
    future.sort((a, b) => {
      if (a.startTime !== b.startTime) return a.startTime! - b.startTime!;
      return (a.endTime! - a.startTime!) - (b.endTime! - b.startTime!);
    });
    return future[0];
  }, [pinnedTimedId, allTodos, now]);

  // untimed slot：pin 优先；失效则 auto 选取（createdAt 最早的 pending 且无时间）
  const untimedCard = useMemo<Todo | null>(() => {
    if (pinnedUntimedId) {
      const t = allTodos.find(x => x.id === pinnedUntimedId);
      if (t && t.status === 'pending' && !t.deletedAt && !t.startTime && !t.endTime) return t;
    }
    const candidates = allTodos.filter(x =>
      x.status === 'pending' && !x.deletedAt && !x.startTime && !x.endTime,
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
  }, [pinnedUntimedId, allTodos]);

  // 读取剪贴板
  const readClipboard = useCallback(async () => {
    try {
      const { value } = await Clipboard.read();
      if (value) {
        setContent(value);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    } catch {
      // 剪贴板读取失败，静默处理
    }
  }, []);

  // 发送/录入
  const handleSend = useCallback(async () => {
    if (!content.trim()) return;

    if (isTodoMode) {
      // 待办模式：创建待办
      try {
        const now = Date.now();
        const startTime = todoStartTime;
        const endTime = todoEndTime;
        // folderDate 以开始时间为准，没开始时间则用当天
        const refTime = startTime || now;
        const folderDate = timestampToFolderDate(refTime);
        const todo = await addTodo({
          title: content.trim(),
          startTime,
          endTime,
          isToday: todoIsToday,
          folderDate,
        });
        setLastTodoId(todo.id);

        // c: 处理待办图片附件
        if (pendingImages.length > 0) {
          setIsUploading(true);
          try {
            const { saveImageForTodo } = await import('@/services/todoAttachmentService');
            const { appendTodoAttachment } = await import('@/services/todoAttachmentsMeta');
            const { getTodoDatabase } = await import('@/services/todoDatabase');
            const db = await getTodoDatabase();
            for (let i = 0; i < pendingImages.length; i++) {
              const att = await saveImageForTodo(todo.id, pendingImages[i]);
              const fullAtt = {
                ...att,
                id: `att_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
                todoId: todo.id,
              };
              appendTodoAttachment(todo.id, fullAtt);
            }
          } catch (e) {
            console.error('[HomePage] 待办附件保存失败:', e);
          } finally {
            setIsUploading(false);
          }
        }

        setContent('');
        setPendingImages([]);
        showToastMessage('待办已创建');

        // 修复5：待办模式发送后确保回到input模式，不出现"为上一条添加信息"
        setMode('input');
        if (modeTimerRef.current) {
          clearTimeout(modeTimerRef.current);
        }
        // 快速提示后重置高级选项
        setTodoStartTime(undefined);
        setTodoEndTime(undefined);
        setShowTodoAdvanced(false);
      } catch (err) {
        console.error('创建待办失败:', err);
        showToastMessage(
          err instanceof Error
            ? `创建失败: ${err.message}`
            : '创建失败，请重试'
        );
      }
      return;
    }

    // 普通录入模式
    try {
      const entry = await addEntry(content.trim());
      setLastEntryId(entry.id);
      setLastEntryContent(content.trim());
      setContent('');

      // 处理图片附件（普通录入模式）
      let attachError = false;
      if (pendingImages.length > 0) {
        setIsUploading(true);
        try {
          const db = await getDatabase();
          const { saveImageForEntry } = await import('@/services/attachmentService');
          for (let i = 0; i < pendingImages.length; i++) {
            const attData = await saveImageForEntry(entry.id, pendingImages[i]);
            attData.sortOrder = i;
            await db.addAttachment(attData);
          }
          // 刷新 store 以包含 attachments
          await useEntryStore.getState().loadEntries();
        } catch (attachErr) {
          console.error('图片保存失败:', attachErr);
          attachError = true;
        } finally {
          setIsUploading(false);
        }
      }

      const hadImages = pendingImages.length > 0;
      setPendingImages([]);
      showToastMessage(
        attachError ? '条目已入库，但部分图片保存失败'
        : hadImages ? '已入库（含图片）'
        : '已入库'
      );

      // 切换到标签/信息选择模式
      setMode('tag');

      // 3秒后自动回退到输入模式
      if (modeTimerRef.current) {
        clearTimeout(modeTimerRef.current);
      }
      modeTimerRef.current = setTimeout(() => {
        setMode('input');
      }, 3000);
    } catch (err) {
      console.error('录入失败:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      showToastMessage(
        msg.includes('no available connection') || msg.includes('no avaliable')
          ? '数据库连接丢失，正在重试...'
          : `录入失败: ${msg}`
      );
      // 如果是连接问题，尝试重新初始化数据库
      if (msg.includes('connection') || msg.includes('database')) {
        const { getDatabase } = await import('@/services/database');
        getDatabase().catch(() => {/* 重试将在下次调用时生效 */});
      }
    }
  }, [content, addEntry, showToastMessage, isTodoMode, todoStartTime, todoEndTime, todoIsToday, addTodo, pendingImages]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 选择图片（相册）
  const handlePickImages = useCallback(async () => {
    setIsPickingImage(true);
    try {
      const imgs = await pickImages(9);
      if (imgs.length > 0) {
        setPendingImages(prev => [...prev, ...imgs]);
      }
    } catch (err) {
      console.error('选图失败:', err);
      showToastMessage('选图失败');
    } finally {
      setIsPickingImage(false);
    }
  }, [showToastMessage]);

  // 拍照（仅 Android）
  const handleTakePhoto = useCallback(async () => {
    setIsPickingImage(true);
    try {
      const img = await takePhoto();
      if (img) {
        setPendingImages(prev => [...prev, img]);
      }
    } catch (err) {
      console.error('拍照失败:', err);
      showToastMessage('拍照失败');
    } finally {
      setIsPickingImage(false);
    }
  }, [showToastMessage]);

  // 移除待上传图片
  const removePendingImage = useCallback((idx: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // 是否展示拍照按钮：仅 Android（Electron/Web 不显示）
  const showCameraButton = !isElectron() && Capacitor.getPlatform() === 'android';

  // 选择添加标签
  const handleAddTag = useCallback(async () => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    if (!lastEntryId) {
      showToastMessage('无法获取条目ID');
      setMode('input');
      return;
    }
    // 加载当前条目已有的标签
    const existingTags = await getTagsByEntryId(lastEntryId);
    setPendingTagIds(existingTags.map(t => t.id));
    setShowTagSelector(true);
    setMode('input');
  }, [lastEntryId, getTagsByEntryId, showToastMessage]);

  // 确认保存标签
  const handleConfirmTags = useCallback(async () => {
    if (!lastEntryId) return;
    try {
      const existingTags = await getTagsByEntryId(lastEntryId);
      const currentTagIds = new Set(existingTags.map(t => t.id));
      const newTagIds = new Set(pendingTagIds);

      // 添加新标签
      for (const tagId of pendingTagIds) {
        if (!currentTagIds.has(tagId)) {
          await addTagToEntry(lastEntryId, tagId);
        }
      }

      // 移除旧标签
      for (const tagId of currentTagIds) {
        if (!newTagIds.has(tagId)) {
          await removeTagFromEntry(lastEntryId, tagId);
        }
      }

      setShowTagSelector(false);
      showToastMessage('标签已保存');
    } catch (err) {
      console.error('保存标签失败:', err);
      showToastMessage('保存失败');
    }
  }, [lastEntryId, pendingTagIds, getTagsByEntryId, addTagToEntry, removeTagFromEntry, showToastMessage]);

  // 选择添加信息
  const handleAddInfo = useCallback(() => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    if (!lastEntryId) {
      showToastMessage('无法获取条目ID');
      setMode('input');
      return;
    }
    setMode('input');
    navigate(`/entry/${lastEntryId}/edit`);
  }, [lastEntryId, navigate, showToastMessage]);

  // 处理快捷时间预设
  const handleQuickTime = useCallback((preset: typeof QUICK_TIME_PRESETS[0], target: 'start' | 'end') => {
    const currentVal = target === 'start' ? todoStartTime : todoEndTime;
    let ts: number;
    if (preset.type === 'absolute') {
      // 绝对时间
      if (preset.offsetMinutes === 0) {
        // 当前时间
        ts = Date.now();
      } else if (preset.offsetMinutes === -3) {
        // 明天6点
        ts = getTomorrowAtHour(6);
      } else {
        ts = Date.now();
      }
    } else {
      // relative: 基于当前已选时间或当前时间
      const base = currentVal ?? Date.now();
      ts = base + preset.offsetMinutes * 60 * 1000;
    }
    if (target === 'start') {
      setTodoStartTime(ts);
    } else {
      setTodoEndTime(ts);
    }
  }, [todoStartTime, todoEndTime]);

  return (
    <div className="home-page">
      <header className="home-page-header">
        {/* 顶部 2 张待办卡片（纵向）：timed + untimed，替换原标题 */}
        <div className="home-todo-cards">
          {/* timed 卡片（有 startTime/endTime，带倒计时） */}
          {timedCard ? (
            (() => {
              const phase = now < (timedCard.startTime ?? 0) ? 'before' : now < (timedCard.endTime ?? Infinity) ? 'ongoing' : 'ended';
              const cardColor = getTodoCardColor(timedCard);
              // 进行中：颜色背景从右往左缩短，右侧露出暗色底
              const progressPct = (phase === 'ongoing' && timedCard.startTime && timedCard.endTime)
                ? ((timedCard.endTime - now) / (timedCard.endTime - timedCard.startTime)) * 100
                : null;
              return (
                <div
                  className={`home-todo-card timed phase-${phase}`}
                  style={progressPct !== null ? {
                    background: `linear-gradient(to right, ${cardColor}cc ${progressPct}%, var(--color-surface-2) ${progressPct}%)`,
                    borderLeftColor: cardColor,
                  } : phase === 'before' ? {
                    background: `${cardColor}22`,
                    borderLeftColor: cardColor,
                  } : {
                    borderLeftColor: cardColor,
                  }}
                  onClick={() => navigate(`/todo/${timedCard.id}/edit`)}
                >
                  {/* 文字遮罩层，确保文字可读 */}
                  <div className="home-todo-card-overlay" />
                  <div className="home-todo-card-main">
                    <span className="home-todo-card-title">{timedCard.title}</span>
                    <span className="home-todo-card-time">{formatTimeShort(timedCard.startTime)} - {formatTimeShort(timedCard.endTime)}</span>
                  </div>
                  <span className="home-todo-card-countdown">
                    {now < (timedCard.startTime ?? 0)
                      ? `${formatCountdownCompact((timedCard.startTime ?? 0) - now)} 后开始`
                      : now < (timedCard.endTime ?? Infinity)
                        ? `${formatCountdownCompact((timedCard.endTime ?? 0) - now)} 后结束`
                        : '已结束'}
                  </span>
                </div>
              );
            })()
          ) : (
            <div className="home-todo-card empty"><span className="home-todo-card-placeholder">暂无定时待办</span></div>
          )}

          {/* untimed 卡片（无时间，待处理） */}
          {untimedCard ? (
            (() => {
              const cardColor = getTodoCardColor(untimedCard);
              return (
                <div
                  className="home-todo-card untimed"
                  style={{
                    background: `${cardColor}22`,
                    borderLeftColor: cardColor,
                  }}
                  onClick={() => navigate(`/todo/${untimedCard.id}/edit`)}
                >
                  {/* 文字遮罩层，确保文字可读 */}
                  <div className="home-todo-card-overlay" />
                  <div className="home-todo-card-main">
                    <span className="home-todo-card-title">{untimedCard.title}</span>
                    <span className="home-todo-card-time">待处理</span>
                  </div>
                  <span className="home-todo-card-countdown">无截止</span>
                </div>
              );
            })()
          ) : (
            <div className="home-todo-card empty"><span className="home-todo-card-placeholder">暂无待办事项</span></div>
          )}
        </div>
      </header>
      <main className="page-content">
        <div className="center-area">
        {mode === 'input' ? (
          <div className="input-section">
            <div className="input-wrapper glass">
            <textarea
                ref={textareaRef}
                className="content-input"
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isTodoMode ? '开始你的规划...' : '记录你的想法...'}
                rows={4}
              />
            </div>

            {/* 已选图片预览（普通录入模式 + 待办模式） */}
            {pendingImages.length > 0 && (
              <div className="pending-images">
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="pending-image-item">
                    <img
                      src={`data:${img.mimeType};base64,${img.base64}`}
                      alt={`待上传 ${idx + 1}`}
                    />
                    <button
                      className="pending-image-remove"
                      onClick={() => removePendingImage(idx)}
                      title="移除"
                    >
                      {CloseSmIcon}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 待办模式切换 */}
            <label className="todo-mode-toggle">
              <input
                type="checkbox"
                checked={isTodoMode}
                onChange={e => {
                  setIsTodoMode(e.target.checked);
                  if (e.target.checked) {
                    setShowTodoAdvanced(true); // 点击待办模式后自动展开高级选项
                  } else {
                    setShowTodoAdvanced(false);
                    setTodoStartTime(undefined);
                    setTodoEndTime(undefined);
                  }
                }}
              />
              <span>待办模式</span>
            </label>

            {/* 待办高级选项 */}
            {isTodoMode && (
              <div className="todo-advanced">
                <button
                  className="todo-advanced-toggle"
                  onClick={() => setShowTodoAdvanced(!showTodoAdvanced)}
                >
                  <span>{showTodoAdvanced ? '收起选项' : '高级选项'}</span>
                </button>
                {showTodoAdvanced && (
                  <div className="todo-advanced-body glass">
                    {/* 开始时间 */}
                    <div className="todo-time-group">
                      <label className="todo-time-label">开始时间</label>
                      <div className="todo-time-presets">
                        {QUICK_TIME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            className={`todo-preset-chip ${todoStartTime && preset.label === 'test' ? 'active' : ''}`}
                            onClick={() => handleQuickTime(preset, 'start')}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="datetime-local"
                        className="todo-time-input glass"
                        value={todoStartTime ? toLocalDatetimeInput(todoStartTime) : ''}
                        onChange={e => setTodoStartTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
                      />
                    </div>

                    {/* 结束时间 */}
                    <div className="todo-time-group">
                      <label className="todo-time-label">结束时间</label>
                      <div className="todo-time-presets">
                        {QUICK_TIME_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            className="todo-preset-chip"
                            onClick={() => handleQuickTime(preset, 'end')}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="datetime-local"
                        className="todo-time-input glass"
                        value={todoEndTime ? toLocalDatetimeInput(todoEndTime) : ''}
                        onChange={e => setTodoEndTime(e.target.value ? new Date(e.target.value).getTime() : undefined)}
                      />
                    </div>

                    {/* 今日处理 */}
                    <label className="todo-mode-toggle">
                      <input
                        type="checkbox"
                        checked={todoIsToday}
                        onChange={e => setTodoIsToday(e.target.checked)}
                      />
                      <span>今日处理</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="input-actions">
              <button className="action-btn secondary" onClick={readClipboard}>
                <span className="btn-icon">{ClipboardIcon}</span>
                <span>粘贴</span>
              </button>
              {/* c: 待办模式也支持选图 */}
              <button
                className="action-btn secondary"
                onClick={handlePickImages}
                disabled={isPickingImage || isUploading}
                title="从相册选择图片"
              >
                <span className="btn-icon">{ImageIcon}</span>
                <span>选图</span>
              </button>
              {showCameraButton && (
                <button
                  className="action-btn secondary"
                  onClick={handleTakePhoto}
                  disabled={isPickingImage || isUploading}
                  title="拍照"
                >
                  <span className="btn-icon">{CameraIcon}</span>
                  <span>拍照</span>
                </button>
              )}
              <button
                className="action-btn primary"
                onClick={handleSend}
                disabled={!content.trim() || isUploading}
              >
                <span className="btn-icon">{SendIcon}</span>
                <span>{isUploading ? '上传中...' : '发送'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mode-section">
            <p className="mode-hint">为上一条添加信息？</p>
            <div className="mode-actions">
              <button className="mode-btn glass" onClick={handleAddTag}>
                <span className="btn-icon">{TagIcon}</span>
                <span>添加标签</span>
              </button>
              <button className="mode-btn glass" onClick={handleAddInfo}>
                <span className="btn-icon">{PaperclipIcon}</span>
                <span>添加信息</span>
              </button>
            </div>
            <p className="mode-timer">3秒后自动回退...</p>
          </div>
        )}
        </div>

        {/* 快捷入口 */}
        <div className="quick-actions">
          <button className="quick-btn glass" onClick={() => navigate('/random')}>
            <span className="btn-icon">{CardsIcon}</span>
            <span>随机浏览</span>
          </button>
          <button className="quick-btn glass" onClick={() => navigate('/search')}>
            <span className="btn-icon">{SearchIcon}</span>
            <span>搜索</span>
          </button>
        </div>
      </main>

      {/* 标签选择器弹层 */}
      {showTagSelector && (
        <div className="home-tag-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="home-tag-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={pendingTagIds}
              onSelectionChange={setPendingTagIds}
              onClose={() => setShowTagSelector(false)}
              entryId={lastEntryId ?? undefined}
              entryContent={lastEntryContent ?? undefined}
            />
            <div className="home-tag-actions">
              <button
                className="home-tag-btn home-tag-cancel"
                onClick={() => setShowTagSelector(false)}
              >
                取消
              </button>
              <button
                className="home-tag-btn home-tag-confirm"
                onClick={handleConfirmTags}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 轻提示 */}
      {showToast && (
        <div className="toast glass">
          <span>{toastMessage}</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
