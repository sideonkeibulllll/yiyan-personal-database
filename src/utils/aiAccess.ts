/**
 * AI 可用性判断（v2.6.3 统一）
 *
 * 背景：「付费 provider 的 key」与「GLM 免费池的 key」是两套独立配置。
 * 非 chat 场景（智能标签 / 智能分组 / 连线建议）在 services/ai.ts 内部会走 GLM 免费池。
 *
 * 此前多处 UI 只用扁平字段 `ai.apiKey`（付费 provider）做 gate，
 * 导致「只启用 GLM 免费池」的用户按钮被错误禁用（明明能跑）。
 *
 * 本函数口径与 services/ai.ts 的内部守卫保持一致：
 *   付费 provider key 或 GLM key 任一存在即可。
 */
import type { AIConfig } from '@/types';

export function hasAIAccess(ai: AIConfig | undefined | null): boolean {
  if (!ai) return false;
  return !!(ai.apiKey || ai.glm?.apiKey);
}
