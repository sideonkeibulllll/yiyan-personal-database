/**
 * 作品内 AI 能力（v4.1.0）
 *
 * 给网页作品一个「AI 外设」：作品在沙箱 iframe 里调 `yiyanAI.ask()`，
 * 宿主收到请求后做授权 / 配额 / 缓存检查，再走 `liteAiCall` 发出去。
 *
 * 三条硬规则：
 * - **作品拿不到 key**：它只知道一个 postMessage 协议，永远碰不到模型配置；
 * - **每个作品独立开关 + 每天独立额度**（默认 10 次），关掉立刻失效；
 * - **默认走全局默认模型、默认不深度思考**，作品要通过 `thinking: true` 显式申请。
 *
 * 缓存 5 分钟：背单词这类场景同一句话会反复问（切页、重渲染），不缓存等于白烧配额。
 */
import { localDateKey } from '@/utils/localDate';
import { liteRequestText, resolveLiteEndpoint, extractJson } from '@/services/liteAiCall';
import { searchWeb } from '@/services/webSearch';
import { useSettingsStore } from '@/stores/settingsStore';
import { sanitizeWorkName } from '@/services/workLibrary';

const GRANT_KEY = 'yiyan_work_ai_v1';
export const DEFAULT_DAILY_LIMIT = 10;
export const MAX_DAILY_LIMIT = 200;
export const MAX_PROMPT_CHARS = 4000;
export const MAX_SYSTEM_CHARS = 2000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 40;
const REQUEST_TIMEOUT_MS = 30_000;

export interface WorkAiGrant {
  enabled: boolean;
  dailyLimit: number;
  allowSearch: boolean;
  /** 额度所属日期（localDateKey），跨天自动清零 */
  day: string;
  used: number;
}

export type WorkAiErrorCode =
  | 'unauthorized'
  | 'quota'
  | 'too_long'
  | 'no_model'
  | 'timeout'
  | 'bad_json'
  | 'search_failed'
  | 'failed';

export interface WorkAiRequest {
  work: string;
  prompt: string;
  system?: string;
  /** 深度思考（默认关，开了更慢更贵） */
  thinking?: boolean;
  /** 是否允许用联网搜索（还要看作品授权里有没有开） */
  search?: boolean;
  /** 要求返回 JSON */
  json?: boolean;
}

export interface WorkAiResult {
  ok: boolean;
  text?: string;
  data?: unknown;
  code?: WorkAiErrorCode;
  error?: string;
  /** 今天还剩几次 */
  remaining: number;
  cached?: boolean;
}

type GrantMap = Record<string, WorkAiGrant>;

function defaultGrant(): WorkAiGrant {
  return {
    enabled: false,
    dailyLimit: DEFAULT_DAILY_LIMIT,
    allowSearch: false,
    day: localDateKey(),
    used: 0,
  };
}

function loadGrants(): GrantMap {
  try {
    const raw = localStorage.getItem(GRANT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as GrantMap;
  } catch {
    return {};
  }
}

function saveGrants(map: GrantMap): void {
  try {
    localStorage.setItem(GRANT_KEY, JSON.stringify(map));
  } catch {
    /* 存不进去不影响本次调用 */
  }
}

/** 读某个作品的授权；跨天自动把 used 归零 */
export function readWorkAiGrant(rawWork: string): WorkAiGrant {
  const work = sanitizeWorkName(rawWork);
  const map = loadGrants();
  const stored = map[work];
  const today = localDateKey();
  if (!stored) return defaultGrant();
  const grant: WorkAiGrant = {
    enabled: stored.enabled === true,
    dailyLimit: clampLimit(stored.dailyLimit),
    allowSearch: stored.allowSearch === true,
    day: typeof stored.day === 'string' ? stored.day : today,
    used: typeof stored.used === 'number' && stored.used >= 0 ? stored.used : 0,
  };
  if (grant.day !== today) {
    grant.day = today;
    grant.used = 0;
    map[work] = grant;
    saveGrants(map);
  }
  return grant;
}

export function clampLimit(value: unknown): number {
  const num = typeof value === 'number' ? Math.floor(value) : DEFAULT_DAILY_LIMIT;
  if (!Number.isFinite(num)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(1, num));
}

export function updateWorkAiGrant(rawWork: string, patch: Partial<WorkAiGrant>): WorkAiGrant {
  const work = sanitizeWorkName(rawWork);
  const map = loadGrants();
  const current = readWorkAiGrant(work);
  const next: WorkAiGrant = {
    ...current,
    ...patch,
    dailyLimit: patch.dailyLimit === undefined ? current.dailyLimit : clampLimit(patch.dailyLimit),
  };
  if (next.day !== localDateKey()) {
    next.day = localDateKey();
    next.used = 0;
  }
  map[work] = next;
  saveGrants(map);
  return next;
}

/** 清空今日用量（不清开关） */
export function resetWorkAiUsage(rawWork: string): WorkAiGrant {
  const work = sanitizeWorkName(rawWork);
  const map = loadGrants();
  const current = readWorkAiGrant(work);
  const next: WorkAiGrant = { ...current, day: localDateKey(), used: 0 };
  map[work] = next;
  saveGrants(map);
  return next;
}

export function remainingWorkAi(rawWork: string): number {
  const grant = readWorkAiGrant(rawWork);
  if (!grant.enabled) return 0;
  return Math.max(0, grant.dailyLimit - grant.used);
}

// ===== 缓存 =====

interface CacheEntry {
  at: number;
  text: string;
}

const cache = new Map<string, CacheEntry>();

function hashKey(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readCache(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.text;
}

function writeCache(key: string, text: string): void {
  cache.set(key, { at: Date.now(), text });
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - CACHE_MAX_ENTRIES);
    for (const [k] of oldest) cache.delete(k);
  }
}

/** 清空内存缓存（改授权 / 换模型时可以调） */
export function clearWorkAiCache(): void {
  cache.clear();
}

// ===== 提示词 =====

const DEFAULT_SYSTEM = [
  '你是嵌在一个网页作品里的 AI 引擎。你的输出会被程序直接拿去用，不是给人看的聊天。',
  '要求：直接给结果，不寒暄、不复述问题、不解释你打算怎么做。',
  '如果被要求输出 JSON，只输出 JSON，不要加代码围栏以外的任何说明。',
].join('\n');

async function buildSearchContext(query: string): Promise<{ text: string; engine: string } | null> {
  try {
    const state = useSettingsStore.getState();
    const cfg = state.settings?.ai?.webSearch;
    const outcome = await searchWeb(query.slice(0, 200), {
      engine: cfg?.engine,
      metasoKey: cfg?.metasoKey,
      count: 3,
    });
    const hits = (outcome.hits ?? []).slice(0, 3);
    if (hits.length === 0) return null;
    const text = hits
      .map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.snippet ?? ''}\n${hit.url ?? ''}`.trim())
      .join('\n\n');
    return { text, engine: outcome.engine };
  } catch {
    return null;
  }
}

// ===== 主入口 =====

export async function runWorkAi(req: WorkAiRequest): Promise<WorkAiResult> {
  const work = sanitizeWorkName(req.work);
  const grant = readWorkAiGrant(work);
  const fallbackRemaining = Math.max(0, grant.dailyLimit - grant.used);

  if (!grant.enabled) {
    return { ok: false, code: 'unauthorized', error: 'AI 还没授权：在作品详情页的「AI 权限」里开启', remaining: 0 };
  }
  if (grant.used >= grant.dailyLimit) {
    return { ok: false, code: 'quota', error: `今天的 ${grant.dailyLimit} 次 AI 额度已用完`, remaining: 0 };
  }

  const prompt = String(req.prompt ?? '').trim();
  if (!prompt) return { ok: false, code: 'too_long', error: 'prompt 不能为空', remaining: fallbackRemaining };
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      ok: false,
      code: 'too_long',
      error: `单次请求最多 ${MAX_PROMPT_CHARS} 字，当前 ${prompt.length} 字`,
      remaining: fallbackRemaining,
    };
  }

  const system = String(req.system ?? '').slice(0, MAX_SYSTEM_CHARS);
  const useSearch = req.search === true && grant.allowSearch;

  const cacheKey = hashKey([work, system, prompt, req.thinking ? '1' : '0', useSearch ? '1' : '0', req.json ? 'json' : 'text'].join('|'));
  const cachedText = readCache(cacheKey);
  if (cachedText) {
    return { ok: true, text: cachedText, data: tryParseJson(cachedText, req.json), remaining: fallbackRemaining, cached: true };
  }

  let endpoint;
  try {
    endpoint = resolveLiteEndpoint('');
  } catch (err) {
    return {
      ok: false,
      code: 'no_model',
      error: `没有可用的模型：${err instanceof Error ? err.message : String(err)}`,
      remaining: fallbackRemaining,
    };
  }

  let userMessage = prompt;
  if (useSearch) {
    const found = await buildSearchContext(prompt);
    if (found) {
      userMessage = `【联网搜索到的资料】\n${found.text}\n\n【用户请求】\n${prompt}\n\n请结合上面的资料回答，不要编造资料里没有的事实。`;
    }
  }

  let text = '';
  try {
    text = await liteRequestText(endpoint, {
      systemPrompt: system || DEFAULT_SYSTEM,
      userMessage,
      temperature: req.json ? 0.3 : 0.6,
      maxTokens: req.json ? 1400 : 900,
      // 默认关思考：这类调用要的是快和便宜，深度思考留给 Chat
      thinking: { enabled: req.thinking === true },
      timeoutMs: REQUEST_TIMEOUT_MS,
      stream: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code: WorkAiErrorCode = /timeout|超时|abort/i.test(message) ? 'timeout' : 'failed';
    return { ok: false, code, error: message, remaining: fallbackRemaining };
  }

  const clean = String(text ?? '').trim();
  if (!clean) {
    return { ok: false, code: 'failed', error: '模型返回了空内容', remaining: fallbackRemaining };
  }

  // 成功了才扣额度
  updateWorkAiGrant(work, { used: grant.used + 1, day: grant.day });
  writeCache(cacheKey, clean);

  const remaining = Math.max(0, grant.dailyLimit - grant.used - 1);

  if (req.json) {
    try {
      return { ok: true, text: clean, data: extractJson(clean), remaining };
    } catch {
      return { ok: false, code: 'bad_json', error: 'AI 返回的不是合法 JSON，可以让它重试一次', text: clean, remaining };
    }
  }
  return { ok: true, text: clean, remaining };
}

function tryParseJson(text: string, wantJson?: boolean): unknown {
  if (!wantJson) return undefined;
  try {
    return extractJson(text);
  } catch {
    return undefined;
  }
}
