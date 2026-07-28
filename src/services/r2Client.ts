// Cloudflare R2 客户端 — 函数式扁平结构
// 参照 Blog 项目 r2.ts 重构：中转站模式走 Worker 代理，直连模式用 aws4fetch 签名
// 修复原 Bug：中转站模式不再强制要求自定义域名
import { CapacitorHttp, Capacitor } from "@capacitor/core";
import { CF, R2_ENDPOINT, TRANSFER_STATION } from "@/config/cloudflare";

// 动态加载 aws4fetch（仅直连模式需要，中转站模式不需要）
let _AwsClient: any = null;
async function getAwsClient() {
  if (!_AwsClient) {
    const mod = await import(/* @vite-ignore */ "aws4fetch");
    _AwsClient = mod.AwsClient;
  }
  return new _AwsClient({
    accessKeyId: CF.r2AccessKeyId,
    secretAccessKey: CF.r2SecretAccessKey,
    service: "s3",
    region: "auto",
  });
}

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

/** 是否走中转站 */
function useTransferStation(): boolean {
  return !!TRANSFER_STATION.url && !!TRANSFER_STATION.token;
}

/** 拼接自定义域名的完整 URL（仅直连读操作用） */
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
 * 上传 base64 图片到 R2
 * - 中转站模式：走 Worker 代理 PUT
 * - 直连模式：走 aws4fetch 签名 S3 PUT
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

  if (useTransferStation()) {
    await r2PutViaTransferStation(key, bytes, contentType);
    return;
  }
  await r2PutDirect(key, bytes, contentType);
}

/**
 * 上传二进制数据到 R2（直连，aws4fetch 签名）
 */
async function r2PutDirect(
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const s3 = await getAwsClient();
  const url = `${R2_ENDPOINT}/${CF.r2Bucket}/${key}`;
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);

  const res = await s3.fetch(url, {
    method: "PUT",
    body: ab,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 上传失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * 走中转站上传 — 原生端用 CapacitorHttp，Web 端用 fetch
 */
async function r2PutViaTransferStation(
  key: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  const url = `${TRANSFER_STATION.url}/r2/put/${encodeURIComponent(key)}?bucket=${TRANSFER_STATION.bucket}`;
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);

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
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`R2(TS) 上传失败 ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    return;
  }

  // Web 端
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
 * 从 R2 下载对象并转 base64
 * - 中转站模式：走 Worker 代理 GET
 * - 直连模式：走自定义域名 GET
 */
export async function r2GetBase64(key: string): Promise<string> {
  let bytes: Uint8Array;

  if (useTransferStation()) {
    bytes = await r2GetViaTransferStation(key);
  } else {
    bytes = await r2GetDirect(key);
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 直连下载 */
async function r2GetDirect(key: string): Promise<Uint8Array> {
  const url = buildCustomUrl(key);
  const resp = await fetchWithTimeout(url, { method: "GET" });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`R2 object not found: ${key}`);
    throw new Error(`R2 下载失败 ${resp.status}: ${resp.statusText}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/** 走中转站下载 */
async function r2GetViaTransferStation(key: string): Promise<Uint8Array> {
  const url = `${TRANSFER_STATION.url}/r2/get?bucket=${TRANSFER_STATION.bucket}&key=${encodeURIComponent(key)}`;

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
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
 * 测试连接
 * - 中转站模式：HEAD Worker 代理 URL
 * - 直连模式：HEAD 自定义域名
 */
export async function r2TestConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    if (useTransferStation()) {
      // 中转站模式：用一个 GET 范围请求测试
      const url = `${TRANSFER_STATION.url}/r2/get?bucket=${TRANSFER_STATION.bucket}&key=__connection_test__`;
      if (Capacitor.isNativePlatform()) {
        const res = await CapacitorHttp.get({
          url,
          headers: { Authorization: `Bearer ${TRANSFER_STATION.token}` },
        });
        // 404 表示连接成功但对象不存在（符合预期）
        if (res.status === 404 || (res.status >= 200 && res.status < 300)) {
          return { ok: true, message: "R2 中转站连接成功" };
        }
        return { ok: false, message: `R2(TS) 连接失败 ${res.status}` };
      }
      const resp = await fetchWithTimeout(url, { method: "GET" }, TEST_TIMEOUT_MS);
      if (resp.ok || resp.status === 404) {
        return { ok: true, message: "R2 中转站连接成功" };
      }
      return { ok: false, message: `R2(TS) 连接失败 ${resp.status}: ${resp.statusText}` };
    }

    // 直连模式：HEAD 自定义域名
    if (!CF.r2PublicDomain) {
      return { ok: false, message: "未配置 R2 自定义域名" };
    }
    const resp = await fetchWithTimeout(
      buildCustomUrl("__connection_test__"),
      { method: "HEAD" },
      TEST_TIMEOUT_MS,
    );
    if (resp.ok || resp.status === 404) {
      return { ok: true, message: "R2 连接成功（自定义域名）" };
    }
    return { ok: false, message: `R2 连接失败 ${resp.status}: ${resp.statusText}` };
  } catch (err) {
    const msg = err instanceof Error
      ? (err.name === "AbortError" ? "连接超时（8秒）" : err.message)
      : "R2 连接失败";
    return { ok: false, message: msg };
  }
}
