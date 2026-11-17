/**
 * 模型能力判别（v3.5.3，v3.6.3 放宽）
 *
 * 用途：Chat 里发图前判断「当前模型能不能看图」。判断错了的代价是用户白拍一张、
 * 或者一次 400 报错，所以：
 *  - 只对**已知明确支持**的模型直接放行（宁严勿宽）
 *  - 但**不确定 ≠ 禁止**：调用方拿到 false 时只做「确认后仍可发送」的软拦截，
 *    用户手动指定过的模型（settings.ai.visionModels）优先于所有启发式
 *
 * 事实依据：
 *  - DeepSeek：V4.1-Flash（旧名 `deepseek-v4-flash` / `deepseek-flash` /
 *    `deepseek-v4-flash-vision-exp`）支持图像理解，单图折算 ≤384 tokens；
 *    Pro 系列明确「不支持」。**第三方中转 / 硅基流动 / OpenRouter 上同名的 Flash
 *    同样按支持处理**——这是 v3.6.3 的改动，此前只认 providerId==='deepseek'，
 *    导致用「别家 v4.1-flash」的用户图片入口永远是灰的。
 *  - TRAE（SOLO 通道）：请求体是字节自定义协议，image_url 块未经验证 → 默认判否，
 *    需要用户手动勾「该模型支持看图」才会放行。
 *  - 智谱免费池（`__glm_smart__`）：池内是文本模型 → 判否。
 *  - SiliconFlow / OpenRouter：按模型名特征匹配（含 vl / vision / 多模态系列）。
 */
import type { AIProviderId } from '@/types';

/** 模型名命中任一子串即视为支持图像输入（小写比对） */
const VISION_NAME_PATTERNS = [
  'vision',
  'vl',
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'gemini',
  'claude-3',
  'claude-4',
  'claude-sonnet',
  'claude-opus',
  'glm-4v',
  'glm-4.5v',
  'glm-5v',
  'doubao-vision',
  'internvl',
  'llava',
  'pixtral',
  'molmo',
];

/** 手动覆盖表的键：`providerId::model`（与 chat 页模型下拉的复合键同构） */
export function visionKey(providerId: AIProviderId | string | null | undefined, model: string): string {
  return `${providerId ?? ''}::${model}`;
}

/**
 * 当前模型是否支持图片输入。
 *
 * @param providerId 实际使用的提供商（GLM 场景传 'glm' 之外的值也可，函数内会先看 model）
 * @param model      实际模型名（不含 `providerId::` 前缀）
 * @param overrides  用户在设置里手动指定的「支持看图」键列表（visionKey 生成）
 */
export function supportsVision(
  providerId: AIProviderId | string | null,
  model: string,
  overrides?: readonly string[],
): boolean {
  const name = (model || '').toLowerCase().trim();
  if (!name) return false;

  // 智能 GLM 免费池：池内均为文本模型（手动覆盖也不放行，避免误判）
  if (name === '__glm_smart__') return false;

  // 用户手动指定优先于一切启发式
  if (Array.isArray(overrides) && overrides.includes(visionKey(providerId, model))) {
    return true;
  }

  // TRAE 走自定义 SOLO 协议，多模态结构未验证 —— 只有手动勾选才放行
  if (providerId === 'trae') return false;

  // DeepSeek 血统：不限提供商。第三方的 deepseek-xxx-flash / v4.1-flash 也认
  if (name.includes('deepseek') && (name.includes('flash') || name.includes('vision'))) {
    return true;
  }

  if (providerId === 'deepseek') {
    // 官方文档：Pro 系列不支持图像理解
    if (name.includes('pro')) return false;
    return name.includes('flash') || name.includes('vision');
  }

  return VISION_NAME_PATTERNS.some(p => name.includes(p));
}

/** 给用户的解释文案（软拦截确认框里展示） */
export const VISION_UNSUPPORTED_HINT =
  '当前模型没被识别为支持看图。可以继续发送试试；也可以去设置 → AI 配置勾上「该模型支持看图」，或在模型下拉里切到带 VL / Vision 的模型。';
