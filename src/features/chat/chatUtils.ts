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

/**
 * 生成模型选择器选项。
 *
 * v2.5.0：改为按「当前激活提供商」的模型候选动态生成，
 * 而非写死列表，这样新增提供商（如硅基流动）能自动出现。
 * 末尾始终附带「智能 GLM」选项（免费池）。
 */
export function buildModelOptions(ai: {
  provider?: import('@/types').AIProviderId;
  isDeepSeek?: boolean;
  providers?: import('@/types').AIProvidersConfig;
}): Array<{ value: string; label: string }> {
  const providerId = ai.provider || (ai.isDeepSeek ? 'deepseek' : 'openai');
  const entry = ai.providers?.[providerId];

  const options: Array<{ value: string; label: string }> = [{ value: '', label: '全局默认' }];

  for (const m of entry?.models ?? []) {
    options.push({ value: m, label: m });
  }

  // e.4 / v2.5.0: 智能 GLM（免费模型池）
  options.push({ value: '__glm_smart__', label: '智能 GLM（免费池）' });

  return options;
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