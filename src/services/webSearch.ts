/**
 * 联网搜索 / 读网页 —— MCP 工具（web_search / web_fetch）的引擎层
 *
 * ## 设计：只用一个引擎，不降级
 *
 * 搜索引擎完全由设置决定（`settings.ai.webSearch.engine`），选了哪个就用哪个：
 * 失败时把上游原因原样返回，**不自动切到别家** —— 速度快、花费可预期
 * （不会"以为在用免费的，其实在花付费的"），出问题也一眼看得见。
 *
 * 两个可选引擎：
 *
 * 1. **秘塔 AI 搜索**（`metaso.cn/api/v1/search`，Key 以 `mk-` 开头）
 *    - 中文检索质量好；`/api/v1/reader` 直接给 Markdown 正文。
 *    - 每次搜索扣 3 credits；⚠️ 实测**不能同时传 `size` 和 `page`**（会返回
 *      `errCode 1000 请求参数错误`），所以只发 `q / size / includeSummary / concise`。
 *    - ⚠️ 官方文档提到 IP 白名单：换网络（尤其切流量）可能被拒。
 * 2. **DeepSeek 官方 Search / Fetch**（同一个 DeepSeek Key）
 *    - `POST /v1/tools/search` → 结构化结果：`summary` 600~800 字、`rerank_score` 0~3、
 *      `authority` 0~4，过滤过 SEO 作弊与低质 AIGC。
 *    - `POST /v1/tools/fetch` → 网页正文直接给 Markdown。
 *    - 计费：5 元 / 1000 次**成功**请求（≈0.5 分/次，失败/空结果不计费）。
 *
 * 两家接口都允许跨域（实测回显 origin），所以 Web / Electron / 原生都能直连，
 * 不需要任何中转服务。原生端仍然走 CapacitorHttp（顺带绕开混合内容限制）。
 *
 * @module services/webSearch
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { WebSearchEngineId } from '@/types';

/** 秘塔 API 根地址（搜索与读网页同域）。 */
const METASO_BASE = 'https://metaso.cn/api/v1';

/** DeepSeek API 根地址（与聊天同一个域名，鉴权方式一致）。 */
const DEEPSEEK_BASE = 'https://api.deepseek.com';

/** 默认引擎：秘塔（有免费额度）。 */
const DEFAULT_ENGINE: WebSearchEngineId = 'metaso';

/** 搜索单次默认/上限条数（上限别开太大，tool 消息会挤爆上下文）。 */
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 8;

/** 抓网页默认/上限字符数。 */
const DEFAULT_FETCH_CHARS = 5000;
const MAX_FETCH_CHARS = 8000;

/** 搜索结果里的单条命中。 */
export interface WebSearchHit {
  title: string;
  url: string;
  /** 摘要（秘塔给的是正文节选，可到 400 字；DeepSeek 给一句话） */
  snippet: string;
  /** DeepSeek 的长摘要（约 600~800 字，这里截到 420） */
  summary?: string;
  /** 站点名 */
  site?: string;
  /** 发布时间（可能为 null） */
  date?: string;
  /** 权威度 0~4（3 以上为高权威，-1 未知） */
  authority?: number;
  /** 相关度 0~3（1.5 以上算高质量） */
  score?: number;
}

/** 搜索整体结果。 */
export interface WebSearchOutcome {
  engine: WebSearchEngineId;
  query: string;
  hits: WebSearchHit[];
}

/** 网页抓取结果。 */
export interface WebFetchOutcome {
  engine: WebSearchEngineId;
  url: string;
  title: string;
  text: string;
  /** 原文总字数（截断前） */
  chars: number;
  truncated: boolean;
}

/** 引擎显示名（报错用）。 */
function engineLabel(engine: WebSearchEngineId): string {
  return engine === 'metaso' ? '秘塔' : 'DeepSeek';
}

// ── 通用 HTTP（原生走 CapacitorHttp，Web 走 fetch） ──

interface HttpResult {
  status: number;
  text: string;
}

interface HttpOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/**
 * 统一请求入口。
 *
 * ⚠️ 原生端必须显式 `responseType: 'text'`：CapacitorHttp 默认按 JSON 解析，
 * 拿去读非 JSON 响应会直接抛错。
 * ⚠️ CapacitorHttp 底层没有超时，网络异常会一直干等 → 必须传 connect/readTimeout。
 */
async function httpRequest(options: HttpOptions): Promise<HttpResult> {
  const method = options.method ?? 'GET';
  const timeout = options.timeoutMs ?? 15_000;

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url: options.url,
      method,
      headers: options.headers,
      data: options.body,
      responseType: 'text',
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    const data: unknown = res.data;
    return {
      status: res.status,
      text: typeof data === 'string' ? data : JSON.stringify(data ?? ''),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(options.url, {
      method,
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** 把底层异常翻成人话（超时 / 网络被拒）。 */
function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '请求超时';
  if (error instanceof Error) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
      return '网络请求被拒（检查网络，或该接口是否允许跨域）';
    }
    return error.message;
  }
  return String(error);
}

/** 从 OpenAI 风格的错误体里抠 message。 */
function readApiError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message.trim();
  } catch {
    // 不是 JSON，走下面的截断
  }
  return text.trim().slice(0, 200) || '未知错误';
}

// ── 文本工具 ──

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–',
};

/** 解 HTML 实体（含数字实体）。 */
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (all, name: string) => ENTITIES[name] ?? all);
}

/** 去标签 + 收空白。 */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** 按字数截断。 */
function cut(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}…`, truncated: true };
}

/** 从响应里读业务码：0 才算成功（秘塔把错误塞在 200 里）。 */
function readBizCode(payload: Record<string, unknown>): { code: number; message: string } {
  const raw = payload.code ?? payload.errCode ?? payload.status;
  const code = typeof raw === 'number' ? raw : Number(raw);
  const messageRaw = payload.message ?? payload.errMsg ?? payload.msg;
  return {
    code: Number.isFinite(code) ? code : 0,
    message: typeof messageRaw === 'string' ? messageRaw : '',
  };
}

// ── 地址安全检查 ──

/**
 * 只允许公网 http/https。
 *
 * 客户端没有 SSRF 风险，但让模型读本机/内网地址没有正当理由，
 * 随手挡掉更省心（也顺手挡掉 file:// 之类）。
 */
function assertPublicUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`地址无效：${raw.slice(0, 120)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http / https 地址');
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('地址里不要带账号密码');
  }
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) throw new Error('不允许访问本机 / 内网地址');
  return parsed.toString();
}

// ── 引擎一：秘塔 AI 搜索 ──

/** 秘塔搜索结果里的单条（字段名按可选处理，不同版本有差异）。 */
interface MetasoItem {
  title?: unknown;
  link?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
  date?: unknown;
  score?: unknown;
}

async function metasoSearch(apiKey: string, query: string, count: number): Promise<WebSearchHit[]> {
  const res = await httpRequest({
    url: `${METASO_BASE}/search`,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: {
      q: query,
      size: count,
      includeSummary: true,
      concise: true,
    },
    timeoutMs: 30_000,
  });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${res.status}：响应不是 JSON`);
  }
  const biz = readBizCode(payload);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}${biz.message ? `：${biz.message}` : ''}`);
  if (biz.code !== 0) throw new Error(`code ${biz.code}${biz.message ? `：${biz.message}` : ''}`);

  const data = (payload.data as Record<string, unknown> | undefined) ?? undefined;
  const list = (payload.webpages ?? data?.webpages ?? payload.results ?? data?.results ?? []) as MetasoItem[];
  if (!Array.isArray(list)) return [];

  const hits: WebSearchHit[] = [];
  for (const item of list) {
    const url = typeof item.link === 'string' ? item.link : typeof item.url === 'string' ? item.url : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const snippet = typeof item.snippet === 'string' ? item.snippet : '';
    const summary = typeof item.summary === 'string' ? item.summary : '';
    const hit: WebSearchHit = {
      title: stripTags(typeof item.title === 'string' ? item.title : url),
      url,
      // 秘塔的 snippet 本身就是正文节选（常上千字），比"一句话摘要"信息量大得多，
      // 截到 400 字给模型用；再长就会把 tool 消息挤爆。
      snippet: cut(stripTags(snippet), 400).text,
    };
    if (summary.length > 0) hit.summary = cut(stripTags(summary), 420).text;
    if (typeof item.date === 'string' && item.date.length > 0) hit.date = item.date.slice(0, 20);
    if (typeof item.score === 'number') hit.score = Math.round(item.score * 100) / 100;
    hits.push(hit);
    if (hits.length >= count) break;
  }
  return hits;
}

async function metasoFetch(apiKey: string, url: string): Promise<{ title: string; text: string }> {
  const res = await httpRequest({
    url: `${METASO_BASE}/reader`,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { url, format: 'markdown' },
    timeoutMs: 40_000,
  });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${res.status}：响应不是 JSON`);
  }
  const biz = readBizCode(payload);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}${biz.message ? `：${biz.message}` : ''}`);
  if (biz.code !== 0) throw new Error(`code ${biz.code}${biz.message ? `：${biz.message}` : ''}`);

  const title = typeof payload.title === 'string' ? payload.title : '';
  const text = typeof payload.markdown === 'string'
    ? payload.markdown
    : typeof payload.content === 'string' ? payload.content : '';
  if (text.trim().length === 0) throw new Error('页面没有可读正文');
  return { title, text };
}

// ── 引擎二：DeepSeek 官方 Search / Fetch ──

/** DeepSeek 搜索响应里的单条结果。 */
interface DeepSeekResult {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
  site_name?: unknown;
  date?: unknown;
  authority?: unknown;
  rerank_score?: unknown;
}

async function deepseekSearch(
  apiKey: string,
  query: string,
  count: number,
  oriQuestion?: string,
): Promise<WebSearchHit[]> {
  const body: Record<string, unknown> = { query, count, need_content: false };
  if (oriQuestion !== undefined && oriQuestion.length > 0) body.ori_question = oriQuestion.slice(0, 128);

  const res = await httpRequest({
    url: `${DEEPSEEK_BASE}/v1/tools/search`,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
    timeoutMs: 30_000,
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}：${readApiError(res.text)}`);

  let payload: { results?: DeepSeekResult[] };
  try {
    payload = JSON.parse(res.text) as { results?: DeepSeekResult[] };
  } catch {
    throw new Error('搜索响应不是合法 JSON');
  }

  const list = Array.isArray(payload.results) ? payload.results : [];
  const hits: WebSearchHit[] = [];
  for (const item of list) {
    const url = typeof item.url === 'string' ? item.url : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const snippet = typeof item.snippet === 'string' ? item.snippet : '';
    const summary = typeof item.summary === 'string' ? item.summary : '';
    const hit: WebSearchHit = {
      title: stripTags(typeof item.title === 'string' ? item.title : url),
      url,
      snippet: cut(snippet, 160).text,
    };
    if (summary.length > 0) hit.summary = cut(summary, 420).text;
    if (typeof item.site_name === 'string' && item.site_name.length > 0) hit.site = item.site_name;
    if (typeof item.date === 'string' && item.date.length > 0) hit.date = item.date.slice(0, 10);
    if (typeof item.authority === 'number') hit.authority = item.authority;
    if (typeof item.rerank_score === 'number') hit.score = Math.round(item.rerank_score * 100) / 100;
    hits.push(hit);
    if (hits.length >= count) break;
  }
  return hits;
}

async function deepseekFetch(apiKey: string, url: string): Promise<{ title: string; text: string }> {
  const res = await httpRequest({
    url: `${DEEPSEEK_BASE}/v1/tools/fetch`,
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { url },
    timeoutMs: 40_000,
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}：${readApiError(res.text)}`);
  let payload: { title?: unknown; content?: unknown };
  try {
    payload = JSON.parse(res.text) as { title?: unknown; content?: unknown };
  } catch {
    throw new Error('抓取响应不是合法 JSON');
  }
  const title = typeof payload.title === 'string' ? payload.title : '';
  const text = typeof payload.content === 'string' ? payload.content : '';
  if (text.trim().length === 0) throw new Error('页面没有可读正文');
  return { title, text };
}

// ── 对外：搜索 ──

/**
 * 联网搜索（单一引擎，不降级）。
 *
 * @param query 搜索词（1~128 字；DeepSeek 支持 site: / lang:zh / after:2025 等运算符）
 * @param options.engine 设置里选的引擎（缺省秘塔）
 */
export async function searchWeb(
  query: string,
  options: {
    engine?: WebSearchEngineId;
    metasoKey?: string;
    deepseekKey?: string;
    count?: number;
    oriQuestion?: string;
  } = {},
): Promise<WebSearchOutcome> {
  const clean = query.trim();
  if (clean.length === 0) throw new Error('搜索词不能为空');
  const count = Math.min(MAX_SEARCH_COUNT, Math.max(1, Math.floor(options.count ?? DEFAULT_SEARCH_COUNT)));
  const engine = options.engine ?? DEFAULT_ENGINE;
  const metasoKey = (options.metasoKey ?? '').trim();
  const deepseekKey = (options.deepseekKey ?? '').trim();

  let hits: WebSearchHit[];
  try {
    if (engine === 'metaso') {
      if (metasoKey.length === 0) {
        throw new Error('还没有填秘塔 API Key（设置 → AI 配置 → 联网搜索），或在同一处把搜索引擎改成 DeepSeek');
      }
      hits = await metasoSearch(metasoKey, clean, count);
    } else {
      if (deepseekKey.length === 0) {
        throw new Error('还没有配置 DeepSeek Key（设置 → AI 配置），或在同一处把搜索引擎改成秘塔');
      }
      hits = await deepseekSearch(deepseekKey, clean, count, options.oriQuestion);
    }
  } catch (error) {
    throw new Error(`${engineLabel(engine)}搜索失败：${describeError(error)}`);
  }

  if (hits.length === 0) {
    throw new Error(`${engineLabel(engine)}搜索没有返回结果，换个更具体的说法再试`);
  }
  return { engine, query: clean, hits };
}

// ── 对外：抓网页 ──

/**
 * 抓一个网页的正文（单一引擎，不降级）。
 *
 * 秘塔 reader / DeepSeek Fetch 都直接给 Markdown；失败就直接报错。
 */
export async function fetchPageText(
  rawUrl: string,
  options: {
    engine?: WebSearchEngineId;
    metasoKey?: string;
    deepseekKey?: string;
    maxChars?: number;
  } = {},
): Promise<WebFetchOutcome> {
  const url = assertPublicUrl(rawUrl);
  const maxChars = Math.min(MAX_FETCH_CHARS, Math.max(500, Math.floor(options.maxChars ?? DEFAULT_FETCH_CHARS)));
  const engine = options.engine ?? DEFAULT_ENGINE;
  const metasoKey = (options.metasoKey ?? '').trim();
  const deepseekKey = (options.deepseekKey ?? '').trim();

  let page: { title: string; text: string };
  try {
    if (engine === 'metaso') {
      if (metasoKey.length === 0) {
        throw new Error('还没有填秘塔 API Key（设置 → AI 配置 → 联网搜索），或在同一处把搜索引擎改成 DeepSeek');
      }
      page = await metasoFetch(metasoKey, url);
    } else {
      if (deepseekKey.length === 0) {
        throw new Error('还没有配置 DeepSeek Key（设置 → AI 配置），或在同一处把搜索引擎改成秘塔');
      }
      page = await deepseekFetch(deepseekKey, url);
    }
  } catch (error) {
    throw new Error(`${engineLabel(engine)}抓取失败：${describeError(error)}`);
  }

  const clipped = cut(page.text, maxChars);
  return {
    engine,
    url,
    title: page.title,
    text: clipped.text,
    chars: page.text.length,
    truncated: clipped.truncated,
  };
}
