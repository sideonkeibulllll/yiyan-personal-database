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
 * - 30s 超时（AbortController 真实中断请求）
 * - 流式优先（SSE，onProgress 回报「已生成字数」）；流式失败自动降级为非流式重试
 * - JSON 解析容错链：剥 ``` 围栏 → 截取首尾大括号 → parse → 字段校验
 * - 配置类错误不重试
 */
import type { AIConfig, AIProviderId, WorryFlipPoint } from '@/types';
import { AI_PROVIDER_ORDER, GLM_FREE_MODEL_POOL, PROVIDER_PRESETS } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';

const REQUEST_TIMEOUT_MS = 30_000;
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
    const models = entry?.models?.length ? entry.models : preset.models;
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

/** 解析复合值：`providerId::model` / `__glm_smart__` / 裸值 */
function parseModelValue(value: string): { providerId: AIProviderId | null; model: string } {
  if (!value || value === '__glm_smart__') return { providerId: null, model: value };
  const idx = value.indexOf(MODEL_SEP);
  if (idx === -1) return { providerId: null, model: value };
  const pid = value.slice(0, idx) as AIProviderId;
  const model = value.slice(idx + MODEL_SEP.length);
  return { providerId: pid, model };
}

/** GLM 免费池轮询游标（进程内，跨调用递增） */
let glmPoolCursor = 0;

interface ResolvedEndpoint {
  model: string;
  baseURL: string;
  apiKey: string;
}

/**
 * 解析当前模型选择 → 实际请求终点。
 * 规则与 Chat 页一致；默认（''）走设置页激活提供商，**不做 GLM 优先**。
 */
function resolveEndpoint(): ResolvedEndpoint {
  const aiCfg = useSettingsStore.getState().settings.ai;
  const value = getWorryModelValue();

  // 智能 GLM（免费池）：轮询池中模型
  if (value === '__glm_smart__') {
    const glm = aiCfg.glm;
    if (!glm?.enabled || !glm.apiKey) {
      throw new Error('智谱 GLM 未配置：请切换其他模型，或在设置页启用并填写智谱 Key');
    }
    const pool = GLM_FREE_MODEL_POOL;
    const model = pool[glmPoolCursor % pool.length];
    glmPoolCursor = (glmPoolCursor + 1) % pool.length;
    return {
      model,
      baseURL: glm.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: glm.apiKey,
    };
  }

  const parsed = parseModelValue(value);

  // 指定了提供商：用该提供商的配置
  if (parsed.providerId) {
    const entry = aiCfg.providers?.[parsed.providerId];
    const apiKey = entry?.apiKey || '';
    if (!apiKey) {
      const label = PROVIDER_PRESETS[parsed.providerId]?.label || parsed.providerId;
      throw new Error(`${label} 未配置 API Key：请切换其他模型，或在设置页补充配置`);
    }
    return {
      model: parsed.model || entry?.model || 'deepseek-v4-flash',
      baseURL: entry?.baseURL || 'https://api.deepseek.com',
      apiKey,
    };
  }

  // 全局默认：设置页当前激活的提供商（兼容旧扁平字段）
  const activeProviderId: AIProviderId = aiCfg.provider || (aiCfg.isDeepSeek ? 'deepseek' : 'deepseek');
  const active = aiCfg.providers?.[activeProviderId];
  const apiKey = active?.apiKey || aiCfg.apiKey || '';
  if (!apiKey) {
    throw new Error('AI 未配置：请在设置页配置模型，或在顶部切换可用模型');
  }
  return {
    model: active?.model || aiCfg.model || 'deepseek-v4-flash',
    baseURL: active?.baseURL || aiCfg.baseURL || 'https://api.deepseek.com',
    apiKey,
  };
}

// ============ 请求与 JSON 解析 ============

export interface GeneratedOutcomes {
  worst: string;
  normal: string;
  best: string;
}

/** 从模型输出中提取 JSON 对象（剥 ``` 围栏 + 截取首尾大括号容错） */
function extractJson(text: string): any {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('AI 返回内容格式不正确');
  }
  return JSON.parse(s.slice(start, end + 1));
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

/** 构造请求体（流式 / 非流式共用） */
function buildBody(model: string, opts: RequestOpts, stream: boolean): string {
  return JSON.stringify({
    model,
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userMessage },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 900,
    ...(stream ? { stream: true } : {}),
  });
}

/** 非流式请求：一次性返回完整文本（兜底路径） */
async function requestTextPlain(opts: RequestOpts): Promise<string> {
  const endpoint = resolveEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${endpoint.apiKey}`,
      },
      body: buildBody(endpoint.model, opts, false),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({} as any));
      throw new Error(error?.error?.message || `AI 请求失败: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI 请求超时，请重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 流式请求（SSE）：逐增量回调「已生成字符数」，返回完整文本。
 *
 * ⚠️ Android/Capacitor 上原生 HTTP（被 CapacitorHttp patch 的 fetch）不支持流式读取，
 * 必须使用原始 WebView fetch（`CapacitorWebFetch`，与 chatStream.ts 同款处理）。
 */
async function requestTextStream(
  opts: RequestOpts,
  onProgress?: (chars: number) => void,
): Promise<string> {
  const endpoint = resolveEndpoint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const fetchFn = (window as any).CapacitorWebFetch || fetch;
  try {
    const response = await fetchFn(`${endpoint.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${endpoint.apiKey}`,
      },
      body: buildBody(endpoint.model, opts, true),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({} as any));
      throw new Error(error?.error?.message || `AI 请求失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            full += delta.content;
            onProgress?.(full.length);
          }
        } catch {
          // 忽略单帧解析错误
        }
      }
    }
    return full;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI 请求超时，请重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求并解析 JSON：
 * ① 流式优先（带「已生成字数」进度回调）
 * ② 流式失败自动降级为非流式重试（覆盖流式不可用/中断的环境）
 * 配置缺失类错误直接抛出，不做无谓重试。
 */
async function requestJson(opts: RequestOpts, onProgress?: (chars: number) => void): Promise<any> {
  try {
    const text = await requestTextStream(opts, onProgress);
    return extractJson(text);
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : '';
    if (msg.includes('未配置')) throw firstErr;
    // 兜底：非流式重试一次（GLM 池轮询天然换模型）
    const text = await requestTextPlain(opts);
    return extractJson(text);
  }
}

// ============ 业务生成函数 ============

/** 生成三种结局（最坏 / 普通 / 最好）；onProgress 回报「已生成字数」 */
export async function generateOutcomes(
  content: string,
  onProgress?: (chars: number) => void,
): Promise<GeneratedOutcomes> {
  const systemPrompt = `你是一位温和、专业的心理支持助手。用户会写下自己正在担心的一件事，请你客观地帮 ta 想象这件事往后发展可能出现的三种结局。

要求：
1. 分别给出：最坏结果、普通结果、最好结果
2. 每条结局 40~90 字，用第二人称「你」叙述，像在描述一种可能发生的平常生活
3. 最坏结果要真实，但不夸张、不渲染灾难；普通结果最贴近现实、最可能发生；最好结果合理可信，不轻浮、不像鸡汤
4. 语气温和、克制、平实，不用感叹号，避免「一定会」「彻底完蛋」这类绝对化、吓人的措辞
5. 只输出一个 JSON 对象，不要输出任何其他文字

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

/** 生成反转牌收获点（「即使发生，我也会获得」）；onProgress 回报「已生成字数」 */
export async function generateFlipPoints(
  content: string,
  worstText: string,
  onProgress?: (chars: number) => void,
): Promise<WorryFlipPoint[]> {
  const systemPrompt = `你是一位温和的心理支持助手。用户担心的一件事可能发生最坏的结果，用户已经看到了这个最坏结果。请你帮 ta 换一个角度：即使这个最坏结果真的发生，ta 的生活中也可能获得什么？

要求：
1. 给出 3 个可能的收获，每个包含 title（不超过 6 个字）和 desc（不超过 40 字）
2. 收获要具体、真诚、贴合用户担心的这件事，不要空洞的鸡汤
3. 用温和的第二人称「你」叙述，传递「即使发生，你也不会一无所有」的支撑感
4. 只输出一个 JSON 对象，不要输出任何其他文字

输出格式（严格按此 JSON 结构）：
{"points": [{"title": "收获标题", "desc": "一句话说明……"}, {"title": "收获标题", "desc": "一句话说明……"}, {"title": "收获标题", "desc": "一句话说明……"}]}`;

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
  return points;
}
