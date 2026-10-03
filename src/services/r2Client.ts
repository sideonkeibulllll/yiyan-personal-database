// Cloudflare R2 客户端 — 函数式扁平结构
//
// v2.7.0：**只走中转站**（Cloudflare Worker 代理）。
// 直连模式（aws4fetch 签名 + R2 AK/SK + R2_ENDPOINT）已整体移除，
// 因为那些密钥会被打包进 APK。附件读取仍可用公开域名直链（非密钥）。
import { CapacitorHttp, Capacitor } from "@capacitor/core";
import { CF, TRANSFER_STATION, assertTransferReady } from "@/config/cloudflare";

function extOf(name: string, mime: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name);
  if (m) return m[1].toLowerCase();
  const sub = mime.split("/")[1];
  return sub === "jpeg" ? "jpg" : sub || "bin";
}

/** fetch 默认超时（ms） */
const FETCH_TIMEOUT_MS = 15000;
/** 测试连接超时（ms，更短以快速失败） */
const TEST_TIMEOUT_MS = 8000;
/**
 * CapacitorHttp 超时（ms）。
 * ⚠️ 原生端底层是 HttpURLConnection，**默认没有超时**，
 * 网络异常时会一直干等（表现就是「测试连接」转圈十几秒）。
 */
const HTTP_TIMEOUT_MS = 10000;

/** 带 AbortController 超时的 fetch 封装 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 拼接自定义域名的完整 URL（附件公开直链，非密钥） */
function buildCustomUrl(key: string): string {
  const domain = CF.r2PublicDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}/${key}`;
}

/**
 * 获取附件的公开访问 URL
 */
export function r2GetPublicUrl(key: string): string {
  return buildCustomUrl(key);
}

/**
 * 上传 base64 图片到 R2（走中转站 Worker 代理 PUT）
 */
export async function r2PutBase64Image(
  key: string,
  base64Data: string,
  contentType: string = "image/jpeg",
): Promise<void> {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  await r2PutViaTransferStation(key, bytes, contentType);
}

/**
 * 走中转站上传 — 原生端用 CapacitorHttp，Web 端用 fetch
 */
async function r2PutViaTransferStation(
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  assertTransferReady();
  const url = `${TRANSFER_STATION.url}/r2/put/${encodeURIComponent(key)}?bucket=${TRANSFER_STATION.bucket}`;

  if (Capacitor.isNativePlatform()) {
    // 原生端：base64 传输
    let binary = "";
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const b64 = btoa(binary);
    const res = await CapacitorHttp.put({
      url,
      headers: {
        Authorization: `Bearer ${TRANSFER_STATION.token}`,
        "Content-Type": contentType,
      },
      data: b64,
      connectTimeout: HTTP_TIMEOUT_MS,
      readTimeout: HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`R2(TS) 上传失败 ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    return;
  }

  // Web 端
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const res = await fetchWithTimeout(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TRANSFER_STATION.token}`,
      "Content-Type": contentType,
    },
    body: ab,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2(TS) 上传失败 ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * 从 R2 下载对象并转 base64（走中转站 Worker 代理 GET）
 */
export async function r2GetBase64(key: string): Promise<string> {
  const bytes = await r2GetViaTransferStation(key);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 走中转站下载 */
async function r2GetViaTransferStation(key: string): Promise<Uint8Array> {
  assertTransferReady();
  const url = `${TRANSFER_STATION.url}/r2/get?bucket=${TRANSFER_STATION.bucket}&key=${encodeURIComponent(key)}`;

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
      connectTimeout: HTTP_TIMEOUT_MS,
      readTimeout: HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      if (res.status === 404) throw new Error(`R2 object not found: ${key}`);
      throw new Error(`R2(TS) 下载失败 ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    // CapacitorHttp 返回 base64
    const b64 = typeof res.data === "string" ? res.data : res.data?.data ?? "";
    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  const resp = await fetchWithTimeout(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
  });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`R2 object not found: ${key}`);
    const text = await resp.text();
    throw new Error(`R2(TS) 下载失败 ${resp.status}: ${text.slice(0, 200)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * 判定探测响应。
 * 404 表示「连上了，只是这个测试对象不存在」—— 符合预期；
 * 401/403 才是密钥问题；5xx 是中转站/上游故障。
 */
function judgeProbe(status: number): { ok: boolean; message: string } {
  if (status === 401 || status === 403) {
    return { ok: false, message: `中转站密钥无效（HTTP ${status}）` };
  }
  if (status >= 500) {
    return { ok: false, message: `中转站服务异常（HTTP ${status}）` };
  }
  return { ok: true, message: `R2 中转站连接成功（HTTP ${status}）` };
}

/**
 * 测试连接：用一个必定 404 的 key 探测中转站是否可达
 * （404 说明「连上了，只是对象不存在」，符合预期）
 *
 * 注：这个探测会真的走一趟 Worker → R2，实测比 D1 慢 2~4 秒，属于正常现象。
 */
export async function r2TestConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    assertTransferReady();

    const url = `${TRANSFER_STATION.url}/r2/get?bucket=${TRANSFER_STATION.bucket}&key=__connection_test__`;

    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({
        url,
        headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
        connectTimeout: TEST_TIMEOUT_MS,
        readTimeout: TEST_TIMEOUT_MS,
      });
      return judgeProbe(res.status);
    }

    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
    }, TEST_TIMEOUT_MS);
    return judgeProbe(resp.status);
  } catch (err) {
    const msg = err instanceof Error
      ? (err.name === "AbortError" ? "连接超时（8秒）" : err.message)
      : "R2 连接失败";
    return { ok: false, message: msg };
  }
}
