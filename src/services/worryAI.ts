/**
 * 「怕了么」AI 生成服务
 *
 * 模型选择机制（与 Chat 页同款，用户可实时调整）：
 * - 选择值存 localStorage（键 `yiyan_worry_model_v1`）：
 *   `''`（全局默认 = 设置页激活的提供商）/ `providerId::model` / `__glm_smart__`（智能 GLM 免费池）
 * - **不再 GLM 优先**：默认走设置页激活的提供商，用户可在流程页顶部随时切换
 * - 选中哪个模型即用**那个提供商**的 baseURL / apiKey，无需回设置页
 *
 * 调用策略：
 * - 超时（AbortController 真实中断请求）：普通 30s / 深度思考 90s
 * - 流式优先（SSE，onProgress 回报「已生成字数」）；流式失败自动降级为非流式重试
 * - JSON 解析容错链：剥 ``` 围栏 → 截取首尾大括号 → parse → 字段校验
 * - 配置类错误不重试
 *
 * v3.3.0 新增：
 * - 深度思考配置（键 `yiyan_worry_thinking_v1`，默认开）：thinking.enabled + reasoning_effort，
 *   语义与 Chat 页一致（开思考时不传 temperature / max_tokens）；「已生成字数」计数含思维链
 * - Soul 人格档案：开关 `yiyan_worry_soul_v1` 打开且档案非空时注入两个 prompt；
 *   反转牌生成额外授权 AI 输出 soulUpdate（由调用方挂到主页待确认，确认后才写入）
 *
 * v3.4.0 变更：
 * - 注入改为 Soul 事实库渲染（怕了么视野：白名单 4 类 + 800 字预算），无事实时回退 legacy soul 文本
 * - soulUpdate 升级为结构化变更组（add / update / retire）
 */
import type { AIConfig, AIProviderId, SoulChanges, WorryFlipPoint } from '@/types';
import { AI_PROVIDER_ORDER, PROVIDER_PRESETS, getEnabledModels } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { parseSoulChanges, renderSoulPortrait } from './soulFacts';
import {
  resolveLiteEndpoint, liteRequestText, extractJson,
  type LiteEndpoint, type LiteRequestOpts,
} from './liteAiCall';

// v3.7.2：请求传输层已抽到 liteAiCall（TRAE / OpenAI 分流 + 凭据轮换）。
// 这里 re-export 保持对 soulDistill 的既有引用不破。
export { resolveLiteEndpoint as resolveEndpointForModelValue, extractJson } from './liteAiCall';

/** 非思考模式超时 */
const REQUEST_TIMEOUT_MS = 30_000;
/** 深度思考模式超时（思考期可能长时间不吐正文） */
const THINKING_TIMEOUT_MS = 90_000;

/** 当前生效的请求超时（按深度思考开关取值） */
function currentTimeoutMs(): number {
  return getWorryThinking().enabled ? THINKING_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}
/** 单条结局文案上限（防模型话痨） */
const MAX_OUTCOME_LEN = 220;
/** 收获点标题 / 说明上限 */
const MAX_FLIP_TITLE_LEN = 12;
const MAX_FLIP_DESC_LEN = 80;

/** 模型选择值的存储键 */
export const WORRY_MODEL_KEY = 'yiyan_worry_model_v1';

/** 复合值分隔符（与 chat 页一致：模型名里不会出现） */
const MODEL_SEP = '::';

// ============ 模型选择：读写与选项构建 ============

/** 读取当前模型选择值（'' = 全局默认） */
export function getWorryModelValue(): string {
  try {
    return localStorage.getItem(WORRY_MODEL_KEY) || '';
  } catch {
    return '';
  }
}

/** 保存模型选择值 */
export function setWorryModelValue(value: string): void {
  try {
    localStorage.setItem(WORRY_MODEL_KEY, value);
  } catch { /* 忽略写入失败 */ }
}

/** 模型选项（与 chat 页同结构：分组标题 + 复合值） */
export interface WorryModelOption {
  value: string;
  label: string;
  /** 分组标题（同一提供商的选项共享） */
  group?: string;
}

/**
 * 构建模型选择器选项（与 chat 页 buildModelOptions 规则一致）：
 * 全局默认 → 各提供商分组模型 → 智能 GLM（免费池）。
 */
export function buildWorryModelOptions(ai: AIConfig): WorryModelOption[] {
  const options: WorryModelOption[] = [{ value: '', label: '全局默认（设置页激活）' }];

  for (const pid of AI_PROVIDER_ORDER) {
    const entry = ai.providers?.[pid];
    const preset = PROVIDER_PRESETS[pid];
    // v3.7.2：与 chat 页一致，尊重设置页「启用模型」勾选，不再全量列出
    const models = entry ? getEnabledModels(entry) : preset.models;
    for (const m of models) {
      options.push({
        value: `${pid}${MODEL_SEP}${m}`,
        label: m,
        group: preset.label,
      });
    }
  }

  options.push({ value: '__glm_smart__', label: '智能 GLM（免费池）' });
  return options;
}

// ============ 深度思考配置（v3.3.0，与 Chat 页同款语义）============

/** 思考强度（与 Chat 页一致） */
export type WorryThinkingEffort = 'high' | 'max';

export interface WorryThinkingConfig {
  enabled: boolean;
  effort: WorryThinkingEffort;
}

/** 深度思考配置的存储键 */
export const WORRY_THINKING_KEY = 'yiyan_worry_thinking_v1';

/** 默认：开启深度思考（质量优先；可在「开始」页随时关闭） */
const DEFAULT_THINKING: WorryThinkingConfig = { enabled: true, effort: 'high' };

/** 读取深度思考配置（容错：坏数据回退默认） */
export function getWorryThinking(): WorryThinkingConfig {
  try {
    const raw = localStorage.getItem(WORRY_THINKING_KEY);
    if (!raw) return { ...DEFAULT_THINKING };
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : DEFAULT_THINKING.enabled,
      effort: parsed?.effort === 'max' ? 'max' : 'high',
    };
  } catch {
    return { ...DEFAULT_THINKING };
  }
}

/** 保存深度思考配置 */
export function setWorryThinking(cfg: WorryThinkingConfig): void {
  try {
    localStorage.setItem(WORRY_THINKING_KEY, JSON.stringify(cfg));
  } catch { /* 忽略写入失败 */ }
}

// ============ Soul 人格档案（v3.3.0）============

/** 「启用 soul 记忆」开关的存储键 */
export const WORRY_SOUL_KEY = 'yiyan_worry_soul_v1';

/** 是否启用 soul 记忆（默认关；打开一次后记住） */
export function getWorrySoulEnabled(): boolean {
  try {
    return localStorage.getItem(WORRY_SOUL_KEY) === '1';
  } catch {
    return false;
  }
}

/** 保存「启用 soul 记忆」开关 */
export function setWorrySoulEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(WORRY_SOUL_KEY, '1');
    else localStorage.removeItem(WORRY_SOUL_KEY);
  } catch { /* 忽略写入失败 */ }
}

/** 读取当前应注入的 Soul 档案内容（开关关 / 无内容 → null）。
 *  v3.4.0：优先事实库渲染（怕了么视野：白名单 4 类 + 800 字预算）；无事实时回退旧文本（兼容期） */
export function getWorrySoulContent(): string | null {
  if (!getWorrySoulEnabled()) return null;
  const portrait = renderSoulPortrait('worry');
  if (portrait) return portrait;
  const soul = (useSettingsStore.getState().settings.ai.soul || '').trim();
  return soul || null;
}

/** 拼「Soul 背景」提示词段（两个生成函数复用） */
function buildSoulSection(soul: string): string {
  return `\n\n【关于用户（来自 ta 自己维护的人格档案）】\n${soul}\n（以上背景帮助你写出更贴合 ta 真实生活的结局，不要生硬复述档案内容，也不要在回复里提及档案本身。）`;
}

// v3.7.2：模型解析下沉到 liteAiCall（见顶部 re-export 的 resolveEndpointForModelValue）
/** 解析当前模型选择 → 请求终点（TRAE 走专属协议） */
function resolveEndpoint(): LiteEndpoint {
  return resolveLiteEndpoint(getWorryModelValue());
}

// ============ 请求与 JSON 解析 ============

export interface GeneratedOutcomes {
  worst: string;
  normal: string;
  best: string;
}

function clipText(value: unknown, maxLen: number): string {
  return String(value ?? '').trim().slice(0, maxLen);
}

interface RequestOpts {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 请求并解析 JSON（v3.7.2：委托 liteAiCall 公共传输层）。
 * ① 流式优先（带「已生成字数」进度回调）
 * ② 流式失败自动降级为非流式重试（覆盖流式不可用/中断的环境）
 * TRAE 时 liteAiCall 内部自动走 SOLO 协议，不再把整包凭据 JSON 拼进 Bearer header。
 * 配置缺失类错误直接抛出，不做无谓重试。
 */
async function requestJson(opts: RequestOpts, onProgress?: (chars: number) => void): Promise<any> {
  const thinking = getWorryThinking();
  const makeOpts = (stream: boolean): LiteRequestOpts => ({
    ...opts,
    thinking: { enabled: thinking.enabled, effort: thinking.effort },
    timeoutMs: currentTimeoutMs(),
    stream,
  });
  try {
    const text = await liteRequestText(resolveEndpoint(), makeOpts(true));
    return extractJson(text);
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : '';
    if (msg.includes('未配置') || msg.includes('凭据格式不正确')) throw firstErr;
    // 兜底：非流式重试一次（GLM 池轮询天然换模型）
    const text = await liteRequestText(resolveEndpoint(), makeOpts(false));
    return extractJson(text);
  }
}

// ============ 业务生成函数 ============

/** 生成三种结局（最坏 / 普通 / 最好）；onProgress 回报「已生成字数」（含思维链） */
export async function generateOutcomes(
  content: string,
  onProgress?: (chars: number) => void,
): Promise<GeneratedOutcomes> {
  const soul = getWorrySoulContent();
  const systemPrompt = `你是一位温和、专业的心理支持助手。用户会写下自己正在担心的一件事，请你客观地帮 ta 想象这件事往后发展可能出现的三种结局。

要求：
1. 分别给出：最坏结果、普通结果、最好结果
2. 每条结局 40~90 字，用第二人称「你」叙述，像在描述一种可能发生的平常生活
3. 最坏结果要真实，但不夸张、不渲染灾难；普通结果最贴近现实、最可能发生；最好结果合理可信，不轻浮、不像鸡汤
4. 语气温和、克制、平实，不用感叹号，避免「一定会」「彻底完蛋」这类绝对化、吓人的措辞
5. 必须贴合用户写下的具体处境来写（如下方提供了关于用户的背景，请结合背景，让结局落在 ta 真实的生活里），不要写「对谁都成立」的万能句子
6. 只输出一个 JSON 对象，不要输出任何其他文字${soul ? buildSoulSection(soul) : ''}

输出格式（严格按此 JSON 结构）：
{"worst": "最坏结果的描述……", "normal": "普通结果的描述……", "best": "最好结果的描述……"}`;

  const json = await requestJson({
    systemPrompt,
    userMessage: `我的担心是：${content}`,
    temperature: 0.7,
    maxTokens: 900,
  }, onProgress);

  const worst = clipText(json?.worst, MAX_OUTCOME_LEN);
  const normal = clipText(json?.normal, MAX_OUTCOME_LEN);
  const best = clipText(json?.best, MAX_OUTCOME_LEN);
  if (!worst || !normal || !best) {
    throw new Error('AI 生成内容不完整，请重试');
  }
  return { worst, normal, best };
}

/** 反转牌生成时 AI 附带的 Soul 变更提议（可选；v3.4.0 升级为结构化变更组） */
export interface SoulUpdateProposal {
  /** AI 写的更新理由（为什么更新、改了什么，给用户看） */
  reason: string;
  /** 结构化变更组（add / update / retire） */
  changes: SoulChanges;
}

export interface FlipGenerateResult {
  points: WorryFlipPoint[];
  /** AI 提议的 Soul 更新（仅当「启用 soul 记忆」且 AI 自愿附带时存在） */
  soulUpdate?: SoulUpdateProposal;
}

/**
 * 生成反转牌收获点（「即使发生，我也会获得」）；onProgress 回报「已生成字数」（含思维链）。
 * 若已启用 soul 记忆：prompt 注入档案背景，并授权 AI 在发现重要长期信息时
 * 附带可选的 soulUpdate 提议（由调用方挂到主页待确认，确认后才写入）。
 */
export async function generateFlipPoints(
  content: string,
  worstText: string,
  onProgress?: (chars: number) => void,
): Promise<FlipGenerateResult> {
  const soul = getWorrySoulContent();
  const updateSection = soul
    ? `\n\n【档案更新】如果你从这次担心中获知了关于用户的重要长期信息（新的处境、在意的点、被证实的有效应对方式等），可以在 JSON 中附带可选的 soulUpdate 字段，提议更新 ta 的事实档案；没有这样的信息就完全不要输出该字段。\n只记事实与状态，不记指令/偏好/倾向。soulUpdate 结构：{"reason": "一两句说明（会展示给用户看）", "add": [{"content": "一条独立事实，≤100字", "category": "identity|situation|state|goal|history"}]}；如需修正已有事实，可额外带 "update": [{"matchText": "档案中逐字出现且唯一的原文片段", "content": "改后内容"}]；已明显不再成立的用 "retire": [{"matchText": "原文片段"}]（不确定原文时就不要带 update/retire）。`
    : '';

  const systemPrompt = `你是一位温和的心理支持助手。用户担心的一件事可能发生最坏的结果，用户已经看到了这个最坏结果。请你帮 ta 换一个角度：即使这个最坏结果真的发生，ta 的生活中也可能获得什么？

要求：
1. 给出 3 个可能的收获，每个包含 title（不超过 6 个字）和 desc（不超过 40 字）
2. 收获要具体、真诚、贴合用户担心的这件事（如下方提供了关于用户的背景，请结合背景来写），不要空洞的鸡汤
3. 用温和的第二人称「你」叙述，传递「即使发生，你也不会一无所有」的支撑感
4. 只输出一个 JSON 对象，不要输出任何其他文字${soul ? buildSoulSection(soul) : ''}${updateSection}

输出格式（严格按此 JSON 结构）：
{"points": [{"title": "收获标题", "desc": "一句话说明……"}, {"title": "收获标题", "desc": "一句话说明……"}, {"title": "收获标题", "desc": "一句话说明……"}]${soul ? ', "soulUpdate": {"reason": "为什么更新、改了什么（可选字段，没有重要信息就不要带上）", "add": [{"content": "一条新事实", "category": "situation"}]}' : ''}}`;

  const json = await requestJson({
    systemPrompt,
    userMessage: `我担心的事：${content}\n我担心的最坏结果：${worstText}`,
    temperature: 0.7,
    maxTokens: 700,
  }, onProgress);

  const rawPoints = Array.isArray(json?.points) ? json.points : [];
  const points: WorryFlipPoint[] = rawPoints
    .filter((p: any) => p && typeof p.title === 'string')
    .slice(0, 3)
    .map((p: any) => ({
      title: clipText(p.title, MAX_FLIP_TITLE_LEN),
      desc: clipText(p.desc, MAX_FLIP_DESC_LEN),
    }))
    .filter((p: WorryFlipPoint) => p.title.length > 0);

  if (points.length === 0) {
    throw new Error('AI 生成内容不完整，请重试');
  }

  // 可选：Soul 变更提议（仅当开关开启且 AI 附带有效变更组时提取）
  let soulUpdate: SoulUpdateProposal | undefined;
  if (soul) {
    const raw = json?.soulUpdate;
    if (raw && typeof raw === 'object') {
      const changes = parseSoulChanges(raw);
      if (changes.add.length + changes.update.length + changes.retire.length > 0) {
        soulUpdate = {
          reason: clipText(raw.reason, 200),
          changes,
        };
      }
    }
  }

  return { points, soulUpdate };
}
