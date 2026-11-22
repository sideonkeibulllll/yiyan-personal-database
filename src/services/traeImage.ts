/**
 * TRAE 文生图（v3.8.0）—— draw_image MCP 的后端
 *
 * 三步取图（实测路径，见 2026-11-22 经验文档）：
 *   1. POST /api/ide/v1/tool_text_to_image   {prompt, image_size} → {uri}（生成+扣积分）
 *   2. POST /api/ide/v1/get_resource_url     {uri_list:[uri]} → 签名 URL（零计费）
 *   3. GET  签名 URL（不带任何 Trae 头）→ 图片字节
 *
 * ## 积分与账号（重要，主人特别交代）
 * **不在画图时实时查积分**（频繁打接口怕风控封号）。
 * 「获取积分 / 每日签到」时反正会拉余额 —— 那一刻顺手把「余额最多的账号 uid」
 * 写进账号倾向（updateTraeDrawPreference），画图时直接读倾向、零额外请求。
 * 倾向没有时回落第一个账号。
 *
 * ## 其它要点
 * - body 只能有 prompt + image_size（多塞已知字段网关直接 400 空 body）。
 * - 1920x1920 起（总像素 3686400~16777216），约 8.8 积分/张。
 * - 同 prompt+size 缓存对象 uri：重取走 get_resource_url（零计费），不重新生成。
 * - 失败不自动重试（504 也扣分），冷却交给调用方提示用户。
 * - refresh_token 轮换必须按 uid 回写（notifyTraeCredentialRotated）。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  isCredentialExpiring,
  parseCredentials,
  refreshCredential,
  replaceCredential,
  type TraeCredential,
} from '@/services/aiProviders/trae';
import { notifyTraeCredentialRotated } from '@/services/ai';

const TRAE_AGENT_HOST = 'https://trae-api-cn.mchost.guru';
const TRAE_APP_ID = '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8';
const TRAE_USER_AGENT = 'Trae/0.1.52';

/** 画图账号倾向（获取积分时顺手写入） */
const DRAW_UID_KEY = 'yiyan_trae_draw_uid_v1';
/** 同 prompt+size 的对象 uri 缓存（重取零计费） */
const URI_CACHE_KEY = 'yiyan_trae_img_uri_cache_v1';

export interface DrawResult {
  /** 图片字节 */
  bytes: Uint8Array;
  /** 生成对象 key（缓存用） */
  uri: string;
  /** 本次是否命中缓存（没扣积分） */
  cached: boolean;
  /** 实际用的账号 uid */
  uid: string;
}

// ===== 账号倾向 =====

/** 「获取积分 / 签到」后调用：把余额最多的账号记为画图倾向 */
export function updateTraeDrawPreference(accounts: Array<{ uid: string; totalBalance: number; error?: string }>): string | null {
  let best: { uid: string; totalBalance: number } | null = null;
  for (const acc of accounts) {
    if (acc.error) continue;
    if (!best || acc.totalBalance > best.totalBalance) best = acc;
  }
  if (!best) return null;
  try {
    localStorage.setItem(DRAW_UID_KEY, best.uid);
  } catch {
    /* ignore */
  }
  return best.uid;
}

export function getTraeDrawUid(): string | null {
  try {
    return localStorage.getItem(DRAW_UID_KEY);
  } catch {
    return null;
  }
}

// ===== 缓存 =====

function cacheGet(prompt: string, size: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(URI_CACHE_KEY) || '{}') as Record<string, string>;
    return map[`${prompt}\u0000${size}`] ?? null;
  } catch {
    return null;
  }
}

function cacheSet(prompt: string, size: string, uri: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(URI_CACHE_KEY) || '{}') as Record<string, string>;
    map[`${prompt}\u0000${size}`] = uri;
    // 只留最近 100 条，防止无限膨胀
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete map[k];
    localStorage.setItem(URI_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

// ===== 请求工具 =====

/** 生图较慢，原生 HTTP 给足超时（CapacitorHttp 底层默认无超时会干等） */
const DRAW_HTTP_TIMEOUT = 120_000;

/**
 * 原生端把 CapacitorHttp 包成 fetch 形状。
 *
 * ⚠️ 为什么不用 CapacitorWebFetch（v3.8.1 修复）：
 * CapacitorWebFetch 是原生桥保存的「原始 WebView fetch」，仍受 WebView CORS 约束。
 * TRAE 画图端点（tool_text_to_image / get_resource_url）的 OPTIONS 预检返回 403、
 * 且没有 Access-Control-Allow-Origin —— WebView 直接抛 TypeError: Failed to fetch。
 * 这就是「电脑上能画、手机上 Failed to fetch」的根因（本机实测：POST 直连返回
 * 1001 认证码说明接口通，唯独带 Origin 的预检 403）。
 * CapacitorHttp 走原生层、不受 CORS 限制（签到、R2 下载同款路子）。
 */
function capFetchShim(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = (init?.headers ?? undefined) as Record<string, string> | undefined;
  const rawBody = init?.body;
  const data = rawBody === undefined || rawBody === null
    ? undefined
    : typeof rawBody === 'string' ? rawBody : String(rawBody);
  return CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    responseType: 'text',
    connectTimeout: DRAW_HTTP_TIMEOUT,
    readTimeout: DRAW_HTTP_TIMEOUT,
  }).then(res => new Response(
    typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
    { status: res.status, headers: { 'Content-Type': 'application/json' } },
  ));
}

function rawFetch(): typeof fetch {
  if (Capacitor.isNativePlatform()) return capFetchShim as typeof fetch;
  return ((window as unknown as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? fetch).bind(window);
}

/** 原生端（Capacitor）走完整身份头；浏览器端 CORS 白名单只放行精简头 */
function buildImageHeaders(credential: TraeCredential): Record<string, string> {
  const minimal: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Cloud-IDE-JWT ${credential.access_token}`,
    'X-App-Id': TRAE_APP_ID,
  };
  if (!Capacitor.isNativePlatform()) return minimal;
  return {
    ...minimal,
    'User-Agent': TRAE_USER_AGENT,
    'X-Cloudide-Token': credential.access_token,
    'X-Ide-Token': credential.access_token,
    'X-Uid': credential.uid,
    'X-Device-Id': credential.device_id,
    'X-Machine-Id': credential.machine_id,
    'X-Device-Type': 'macos',
    'X-Os-Version': 'macOS 15.7.4',
    'X-Ide-Version': '0.1.52',
    'X-Ide-Version-Code': '20260811',
  };
}

/** 浏览器跨域受限时给出人话（draw_image 主战场是安卓/桌面端） */
function webLimitHint(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!Capacitor.isNativePlatform() && /fetch|network/i.test(msg)) {
    return '画图接口被浏览器跨域拦住了（draw_image 请在安卓/桌面端使用）';
  }
  return `画图请求失败：${msg}`;
}

async function postJson(credential: TraeCredential, path: string, body: unknown): Promise<Record<string, unknown>> {
  const fetchFn = rawFetch();
  let res: Response;
  try {
    res = await fetchFn(`${TRAE_AGENT_HOST}${path}`, {
      method: 'POST',
      headers: buildImageHeaders(credential),
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(webLimitHint(e));
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`画图接口 ${path} 返回 ${res.status}：${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`画图接口 ${path} 响应不是 JSON：${text.slice(0, 120)}`);
  }
}

/** 挑画图账号：倾向 uid 优先，回落第一个 */
function pickDrawCredential(creds: TraeCredential[]): TraeCredential {
  const pref = getTraeDrawUid();
  const hit = pref ? creds.find(c => c.uid === pref) : null;
  return hit ?? creds[0];
}

/** 续期并按 uid 回写（整包 replaceCredential） */
async function ensureFreshCredential(credential: TraeCredential): Promise<TraeCredential> {
  if (!isCredentialExpiring(credential)) return credential;
  const next = await refreshCredential(credential, rawFetch());
  const raw = useSettingsStore.getState().settings.ai.providers?.trae?.apiKey ?? '';
  if (raw) notifyTraeCredentialRotated(replaceCredential(raw, next));
  return next;
}

// ===== 主流程 =====

export interface DrawOptions {
  prompt: string;
  /** 默认 1920x1920（总像素下限 3686400） */
  imageSize?: string;
}

export async function drawTraeImage(options: DrawOptions): Promise<DrawResult> {
  const prompt = (options.prompt || '').trim();
  const size = (options.imageSize || '1920x1920').trim();
  if (!prompt) throw new Error('prompt 不能为空');

  const raw = useSettingsStore.getState().settings.ai.providers?.trae?.apiKey ?? '';
  const creds = parseCredentials(raw);
  if (creds.length === 0) throw new Error('还没配置 TRAE 账号（设置 → AI 配置 → TRAE）');

  let credential = await ensureFreshCredential(pickDrawCredential(creds));

  // 缓存命中：同一 prompt+size 只生成一次，重取零计费
  const cachedUri = cacheGet(prompt, size);
  if (cachedUri) {
    try {
      const url = await resolveSignedUrl(credential, cachedUri);
      const bytes = await downloadSigned(url);
      return { bytes, uri: cachedUri, cached: true, uid: credential.uid };
    } catch {
      cacheSet(prompt, size, ''); // 清掉坏缓存走重新生成
    }
  }

  // 1. 生成（扣积分，body 只有 prompt + image_size）
  const gen = await postJson(credential, '/api/ide/v1/tool_text_to_image', {
    prompt,
    image_size: size,
  });
  const uri = typeof gen.uri === 'string' ? gen.uri : '';
  if (!uri) {
    const msg = typeof gen.message === 'string' ? gen.message : JSON.stringify(gen).slice(0, 160);
    throw new Error(`生成失败（没拿到对象 key）：${msg}`);
  }
  cacheSet(prompt, size, uri);

  // 2. 换签名 URL（零计费）
  const url = await resolveSignedUrl(credential, uri);

  // 3. 裸 GET 下载（签名在 query，不带任何 Trae 头）
  const bytes = await downloadSigned(url);
  return { bytes, uri, cached: false, uid: credential.uid };
}

async function resolveSignedUrl(credential: TraeCredential, uri: string): Promise<string> {
  const res = await postJson(credential, '/api/ide/v1/get_resource_url', { uri_list: [uri] });
  const map = (res.url_map ?? {}) as Record<string, string>;
  const url = map[uri];
  if (!url) throw new Error('签名 URL 为空（对象可能已过期）');
  return url;
}

async function downloadSigned(url: string): Promise<Uint8Array> {
  // 原生端：签名 URL 多是第三方对象存储，WebView fetch 同样会被 CORS 拦，
  // 走 CapacitorHttp（返回 base64，见 r2Client 同款处理）。
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      connectTimeout: DRAW_HTTP_TIMEOUT,
      readTimeout: DRAW_HTTP_TIMEOUT,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`下载图片失败：${res.status}`);
    const b64 = typeof res.data === 'string' ? res.data : (res.data?.data ?? '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const fetchFn = rawFetch();
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (e) {
    throw new Error(webLimitHint(e));
  }
  if (!res.ok) throw new Error(`下载图片失败：${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/** 图片字节 → base64（写入作品文件夹用） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
