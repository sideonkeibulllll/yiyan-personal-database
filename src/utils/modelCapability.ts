/**
 * 模型能力判别（v3.5.3）
 *
 * 用途：Chat 里发图前判断「当前模型能不能看图」。判断错了的代价是用户白拍一张、
 * 或者一次 400 报错，所以：
 *  - 只对**已知明确支持**的模型放行（宁严勿宽）
 *  - 无法确定的一律按「不支持」处理，用户可在 Chat 页切模型
 *
 * 事实依据（官方文档，非猜测）：
 *  - DeepSeek：`deepseek-flash`（旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`
 *    均路由到 V4.1-Flash）支持图像理解，单图折算 ≤384 tokens；
 *    `deepseek-v4-pro` 明确「不支持」。
 *  - TRAE（SOLO 通道）：请求体是字节自定义协议，image_url 块未经验证 → 保守判否。
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

/**
 * 当前模型是否支持图片输入。
 *
 * @param providerId 实际使用的提供商（GLM 场景传 'glm' 之外的值也可，函数内会先看 model）
 * @param model      实际模型名（不含 `providerId::` 前缀）
 */
export function supportsVision(
  providerId: AIProviderId | string | null,
  model: string,
): boolean {
  const name = (model || '').toLowerCase().trim();
  if (!name) return false;

  // 智能 GLM 免费池：池内均为文本模型
  if (name === '__glm_smart__') return false;

  if (providerId === 'deepseek') {
    // 官方文档：Pro 系列不支持图像理解，Flash 系（含旧版 vision 实验名）支持
    if (name.includes('pro')) return false;
    return name.includes('flash') || name.includes('vision');
  }

  // TRAE 走自定义 SOLO 协议，多模态结构未验证 —— 不冒险
  if (providerId === 'trae') return false;

  return VISION_NAME_PATTERNS.some(p => name.includes(p));
}

/** 给用户的解释文案（拦截发图时展示） */
export const VISION_UNSUPPORTED_HINT =
  '当前模型不支持看图。可在上方模型下拉里切到 deepseek-v4-flash（或带 VL / Vision 的模型）再发图片。';
