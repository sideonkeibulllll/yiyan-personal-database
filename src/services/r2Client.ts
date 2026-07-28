/**
 * Cloudflare R2 客户端封装（自定义域名直读直写，v2.1.2）
 *
 * v2.1.2 变更：
 * - 完全移除 @aws-sdk/client-s3 依赖（避免大 chunk + WebView 初始化慢）
 * - 所有操作走 fetch + 自定义域名
 * - 读操作（GET/HEAD）：公开可读，无需签名
 * - 写操作（PUT）：需要 bucket 允许公开写，或通过 Cloudflare Worker 代理
 *   （写失败不影响读，会抛出明确错误）
 *
 * 重要：使用本客户端必须配置 r2CustomDomain，否则所有操作都会失败
 */
import type { CloudBackupConfig } from './cloudBackupTypes';

/** fetch 默认超时（ms） */
const FETCH_TIMEOUT_MS = 15000;

/** 测试连接超时（ms，更短以快速失败） */
const TEST_TIMEOUT_MS = 8000;

/** 带 AbortController 超时的 fetch 封装 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 中转站 R2 逻辑桶名（个人数据库用 memory） */
const TS_BUCKET_KEY = 'memory';

export class R2Client {
  private bucket: string;
  private customDomain: string | undefined;
  private useTransferStation: boolean;
  private tsUrl: string;
  private tsToken: string;

  constructor(config: Pick<CloudBackupConfig, 'accountId' | 'r2BucketName' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2CustomDomain' | 'useTransferStation' | 'transferStationUrl' | 'transferStationToken'>) {
    this.bucket = config.r2BucketName;
    this.customDomain = config.r2CustomDomain?.trim() || undefined;
    this.useTransferStation = config.useTransferStation ?? false;
    this.tsUrl = config.transferStationUrl?.replace(/\/$/, '') ?? '';
    this.tsToken = config.transferStationToken ?? '';
  }

  /** 是否走中转站 */
  private isTransferStationMode(): boolean {
    return this.useTransferStation && !!this.tsUrl && !!this.tsToken;
  }

  /** 是否启用自定义域名（本客户端强制要求启用） */
  private hasCustomDomain(): boolean {
    return !!this.customDomain;
  }

  /** 拼接自定义域名的完整 URL */
  private buildCustomUrl(key: string): string {
    const domain = this.customDomain!.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${domain}/${key}`;
  }

  /**
   * 获取附件的公开访问 URL
   */
  getPublicUrl(key: string): string {
    if (this.hasCustomDomain()) {
      return this.buildCustomUrl(key);
    }
    return '';
  }

  /**
   * 上传二进制数据到 R2
   * - 直连模式：走自定义域名 PUT（需 bucket 公开写）
   * - 中转站模式：走 /r2/put/<key>?bucket=memory（Worker 原生绑定代理）
   */
  async putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
    if (this.isTransferStationMode()) {
      await this.putObjectViaTransferStation(key, data, contentType);
      return;
    }
    if (!this.hasCustomDomain()) {
      throw new Error('未配置 R2 自定义域名，无法上传（v2.1.2 仅支持域名连接）');
    }
    // 复制到新的 ArrayBuffer（避免 SharedArrayBuffer 类型不兼容问题）
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
    const resp = await fetchWithTimeout(this.buildCustomUrl(key), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: ab,
    });
    if (!resp.ok) {
      throw new Error(`R2 上传失败 ${resp.status}（可能 bucket 未开放公开写）: ${resp.statusText}`);
    }
  }

  /** 走中转站上传 */
  private async putObjectViaTransferStation(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const url = `${this.tsUrl}/r2/put/${encodeURIComponent(key)}?bucket=${TS_BUCKET_KEY}`;
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
    const resp = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.tsToken}`,
        'Content-Type': contentType,
      },
      body: ab,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`R2(TS) 上传失败 ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  /**
   * 上传 base64 编码的图片到 R2
   */
  async putBase64Image(key: string, base64Data: string, contentType: string = 'image/jpeg'): Promise<void> {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    await this.putObject(key, bytes, contentType);
  }

  /**
   * 从 R2 下载对象（返回 Uint8Array）
   * - 直连：自定义域名 GET
   * - 中转站：/r2/get?bucket=memory&key=...
   */
  async getObject(key: string): Promise<Uint8Array> {
    if (this.isTransferStationMode()) {
      return this.getObjectViaTransferStation(key);
    }
    if (!this.hasCustomDomain()) {
      throw new Error('未配置 R2 自定义域名，无法下载（v2.1.2 仅支持域名连接）');
    }
    const resp = await fetchWithTimeout(this.buildCustomUrl(key), { method: 'GET' });
    if (!resp.ok) {
      if (resp.status === 404) throw new Error(`R2 object not found: ${key}`);
      throw new Error(`R2 下载失败 ${resp.status}: ${resp.statusText}`);
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }

  /** 走中转站下载 */
  private async getObjectViaTransferStation(key: string): Promise<Uint8Array> {
    const url = `${this.tsUrl}/r2/get?bucket=${TS_BUCKET_KEY}&key=${encodeURIComponent(key)}`;
    const resp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.tsToken}`,
      },
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
   * 从 R2 下载对象并转为 base64
   */
  async getBase64(key: string): Promise<string> {
    const bytes = await this.getObject(key);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 检查对象是否存在（不下载内容）
   */
  async exists(key: string): Promise<boolean> {
    if (this.isTransferStationMode()) {
      // 中转站没有 HEAD 接口，用 GET 范围请求试
      try {
        const url = `${this.tsUrl}/r2/get?bucket=${TS_BUCKET_KEY}&key=${encodeURIComponent(key)}`;
        const resp = await fetchWithTimeout(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.tsToken}` },
        });
        if (resp.ok) return true;
        if (resp.status === 404) return false;
        throw new Error(`R2(TS) HEAD 失败 ${resp.status}`);
      } catch (err) {
        // 如果是 404 相关错误，返回 false
        if (err instanceof Error && err.message.includes('not found')) return false;
        throw err;
      }
    }
    if (!this.hasCustomDomain()) {
      throw new Error('未配置 R2 自定义域名');
    }
    const resp = await fetchWithTimeout(this.buildCustomUrl(key), { method: 'HEAD' });
    if (resp.ok) return true;
    if (resp.status === 404) return false;
    throw new Error(`R2 HEAD 失败 ${resp.status}: ${resp.statusText}`);
  }

  /**
   * 测试连接（HEAD 一个不存在的 key）
   * 200 / 404 都视为连接成功（域名可达，bucket 工作）
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.hasCustomDomain()) {
      return { ok: false, message: '未配置 R2 自定义域名（v2.1.2 仅支持域名连接）' };
    }
    try {
      const resp = await fetchWithTimeout(
        this.buildCustomUrl('__connection_test__'),
        { method: 'HEAD' },
        TEST_TIMEOUT_MS
      );
      if (resp.ok || resp.status === 404) {
        return { ok: true, message: 'R2 连接成功（自定义域名）' };
      }
      return { ok: false, message: `R2 连接失败 ${resp.status}: ${resp.statusText}` };
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? '连接超时（8秒）' : err.message)
        : 'R2 连接失败';
      return { ok: false, message: msg };
    }
  }
}
