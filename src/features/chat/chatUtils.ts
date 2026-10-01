/**
 * Chat 页面工具函数与常量
 */
import type { ChatSession } from './chatTypes';

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

/** 可选模型列表 */
export const MODEL_OPTIONS = [
  { value: '', label: '全局默认' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  // e.4: 添加「智能GLM」选项
  { value: '__glm_smart__', label: '智能 GLM' },
];

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