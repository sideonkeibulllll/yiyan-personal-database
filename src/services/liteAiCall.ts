/**
 * 轻量 AI 文本调用（可复用底座）——「怕了么」与「Soul 事实档案」共用
 *
 * ## 为什么要有这一层（v3.7.2）
 *
 * previously worryAI / soulDistill 各自写了 `fetch(baseURL + '/chat/completions')`
 * 并把 `apiKey` 直接拼进 `Authorization: Bearer …`。一旦用户在模型选择器里选了
 * **TRAE**，apiKey 其实是「整包凭据 JSON」（含引号/换行），拼进 header 时
 * 浏览器直接抛 `Failed to construct 'Headers': Invalid value`。
 *
 * TRAE 的协议与 OpenAI 不兼容（见 services/aiProviders/trae.ts），必须：
 *   1. `pickCredential` 解析整包 JSON 成凭据对象
 *   2. 走 `streamTraeChat` / `traeChat`（自己构造 SOLO 请求体与 SSE 解析）
 *   3. refresh_token 轮换后按 uid 回写
 * 这与 Chat 页的处理完全一致。本模块把「解析模型 → 分流 → 请求 → JSON」收敛到一处，
 * worry / soul 只管业务 prompt，不再重复实现传输细节。
 */
import type { AIConfig, AIProviderId } from '@/types';
import { AI_PROVIDER_ORDER, GLM_FREE_MODEL_POOL, PROVIDER_PRESETS } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  pickCredential, replaceCredential, streamTraeChat, traeChat,
} from '@/services/aiProviders/trae';
import { notifyTraeCredentialRotated } from '@/services/ai';

/** 复合值分隔符（与 chat / worry 一致） */
const MODEL_SEP = '::';

/** 请求终点：openai 走标准 chat/completions，trae 走专属 SOLO 协议。 */
export interface LiteEndpoint {
  kind: 'openai' | 'trae';
  /** UI 模型名（TRAE 时由 trae.ts 内部映射成真实 id） */
  model: string;
  baseURL: string;
  /** openai 用：API Key */
  apiKey: string;
  /** trae 用：整包凭据 JSON 原文 */
  credentialRaw?: string;
  /** trae 用：手动指定的账号 uid */
  traeUid?: string;
}

/** GLM 免费池轮询游标（进程内，跨调用递增；与旧 worryAI 行为一致） */
let glmPoolCursor = 0;

/** 解析复合值：`providerId::model` / `__glm_smart__` / 裸值 */
function parseModelValue(value: string): { providerId: AIProviderId | null; model: string } {
  if (!value || value === '__glm_smart__') return { providerId: null, model: value };
  const idx = value.indexOf(MODEL_SEP);
  if (idx === -1) return { providerId: null, model: value };
  return {
    providerId: value.slice(0, idx) as AIProviderId,
    model: value.slice(idx + MODEL_SEP.length),
  };
}

/**
 * 把模型选择值解析成请求终点。
 * - `''`（全局默认）：走设置页激活提供商
 * - `providerId::model`：走该提供商（TRAE 自动走专属协议）
 * - `__glm_smart__`：GLM 免费池轮询
 */
export function resolveLiteEndpoint(value: string): LiteEndpoint {
  const aiCfg: AIConfig = useSettingsStore.getState().settings.ai;

  if (value === '__glm_smart__') {
    const glm = aiCfg.glm;
    if (!glm?.enabled || !glm.apiKey) {
      throw new Error('智谱 GLM 未配置：请切换其他模型，或在设置页启用并填写智谱 Key');
    }
    const pool = GLM_FREE_MODEL_POOL;
    const model = pool[glmPoolCursor % pool.length]!;
    glmPoolCursor = (glmPoolCursor + 1) % pool.length;
    return {
      kind: 'openai',
      model,
      baseURL: glm.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: glm.apiKey,
    };
  }

  const parsed = parseModelValue(value);

  if (parsed.providerId) {
    const pid = parsed.providerId;
    const entry = aiCfg.providers?.[pid];
    const key = entry?.apiKey || '';
    if (!key) {
      const label = PROVIDER_PRESETS[pid]?.label || pid;
      throw new Error(`${label} 未配置：请切换其他模型，或在设置页补充配置`);
    }
    if (pid === 'trae') {
      return {
        kind: 'trae',
        model: parsed.model || entry?.model || 'DeepSeek-V4.1-Flash',
        baseURL: entry?.baseURL || '',
        apiKey: '',
        credentialRaw: key,
        traeUid: entry?.activeCredentialUid,
      };
    }
    return {
      kind: 'openai',
      model: parsed.model || entry?.model || 'deepseek-v4-flash',
      baseURL: entry?.baseURL || 'https://api.deepseek.com',
      apiKey: key,
    };
  }

  // 全局默认：设置页当前激活的提供商（兼容旧扁平字段）
  const activeProviderId: AIProviderId = aiCfg.provider || (aiCfg.isDeepSeek ? 'deepseek' : 'deepseek');
  const active = aiCfg.providers?.[activeProviderId];
  const key = active?.apiKey || aiCfg.apiKey || '';
  if (!key) throw new Error('AI 未配置：请在设置页配置模型，或在顶部切换可用模型');
  if (activeProviderId === 'trae') {
    return {
      kind: 'trae',
      model: active?.model || aiCfg.model || 'DeepSeek-V4.1-Flash',
      baseURL: '',
      apiKey: '',
      credentialRaw: key,
      traeUid: active?.activeCredentialUid,
    };
  }
  return {
    kind: 'openai',
    model: active?.model || aiCfg.model || 'deepseek-v4-flash',
    baseURL: active?.baseURL || aiCfg.baseURL || 'https://api.deepseek.com',
    apiKey: key,
  };
}

export interface LiteRequestOpts {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  /** 深度思考配置（与 Chat 页语义一致；开时不传 temperature/max_tokens） */
  thinking?: { enabled: boolean; effort?: 'high' | 'max' };
  timeoutMs: number;
  /** true=流式（带进度回调）；false=一次性返回 */
  stream: boolean;
  onProgress?: (chars: number) => void;
  signal?: AbortSignal;
}

/** 组装 messages（system + user） */
function buildMessages(opts: LiteRequestOpts): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userMessage },
  ];
}

/** 组装 thinking / temperature / max_tokens（两种协议共用语义） */
function buildGenFields(opts: LiteRequestOpts): Record<string, unknown> {
  if (opts.thinking?.enabled) {
    return {
      thinking: { type: 'enabled' },
      ...(opts.thinking.effort ? { reasoning_effort: opts.thinking.effort } : {}),
    };
  }
  return {
    // 显式 disabled：对默认开启思考的模型（如 DeepSeek-V4 系列）才是「真关」，
    // 与 worryAI 旧行为一致；OpenAI 兼容端点忽略未知字段，无害。
    thinking: { type: 'disabled' },
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 900,
  };
}

/** TRAE 通道：pickCredential + SOLO 协议（流式 / 非流式），凭据轮换按 uid 回写 */
async function requestTrae(endpoint: LiteEndpoint, opts: LiteRequestOpts): Promise<string> {
  const raw = endpoint.credentialRaw ?? '';
  const credential = pickCredential(raw, endpoint.traeUid);
  if (credential === null) {
    throw new Error('TRAE 凭据格式不正确：需要包含 access_token / refresh_token / machine_id / device_id 的 JSON');
  }
  const body: Record<string, unknown> = {
    messages: buildMessages(opts),
    ...buildGenFields(opts),
  };
  const onCredentialRotated = (next: Parameters<NonNullable<Parameters<typeof traeChat>[0]['onCredentialRotated']>>[0]) => {
    notifyTraeCredentialRotated(replaceCredential(raw, next));
  };

  if (!opts.stream) {
    return traeChat({ credential, model: endpoint.model, body, signal: opts.signal, onCredentialRotated });
  }

  const webFetch = (window as any).CapacitorWebFetch as typeof fetch | undefined;
  let full = '';
  let reasoningLen = 0;
  await streamTraeChat({
    credential,
    model: endpoint.model,
    body,
    signal: opts.signal,
    fetchFn: webFetch ?? fetch,
    onCredentialRotated,
    callbacks: {
      onReasoning: (chunk) => {
        reasoningLen += chunk.length;
        opts.onProgress?.(full.length + reasoningLen);
      },
      onContent: (chunk) => {
        full += chunk;
        opts.onProgress?.(full.length + reasoningLen);
      },
    },
  });
  return full;
}

/** OpenAI 兼容通道（含 GLM 池） */
async function requestOpenAI(endpoint: LiteEndpoint, opts: LiteRequestOpts): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  // 流式在 Android/Capacitor 必须用原始 WebView fetch（CapacitorHttp 不支持流）
  const fetchFn = opts.stream ? ((window as any).CapacitorWebFetch as typeof fetch | undefined) ?? fetch : fetch;
  try {
    const response = await fetchFn(`${endpoint.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: buildMessages(opts),
        ...buildGenFields(opts),
        ...(opts.stream ? { stream: true } : {}),
      }),
      signal: opts.signal ?? controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({} as any));
      throw new Error(error?.error?.message || `AI 请求失败: ${response.status}`);
    }

    if (!opts.stream) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let reasoningLen = 0;
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
          if (delta?.reasoning_content) {
            reasoningLen += String(delta.reasoning_content).length;
            opts.onProgress?.(full.length + reasoningLen);
          }
          if (delta?.content) {
            full += delta.content;
            opts.onProgress?.(full.length + reasoningLen);
          }
        } catch { /* 忽略单帧解析错误 */ }
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一文本请求入口：按 endpoint.kind 分流到 TRAE 专属协议或 OpenAI 兼容协议 */
export async function liteRequestText(endpoint: LiteEndpoint, opts: LiteRequestOpts): Promise<string> {
  if (endpoint.kind === 'trae') return requestTrae(endpoint, opts);
  return requestOpenAI(endpoint, opts);
}

/** 从模型输出中提取 JSON 对象（剥 ``` 围栏 + 截取首尾大括号容错） */
export function extractJson(text: string): any {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 返回内容格式不正确');
  return JSON.parse(s.slice(start, end + 1));
}
