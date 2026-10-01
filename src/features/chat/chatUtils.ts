/**
 * Chat 页面工具函数与常量
 */
import type { ChatSession } from './chatTypes';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS } from '@/types';

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
    const models = entry?.models?.length ? entry.models : preset.models;
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