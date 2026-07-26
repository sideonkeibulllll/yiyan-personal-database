/**
 * Cloudflare R2 客户端封装（S3 兼容 API + 自定义域名直读）
 *
 * R2 S3 兼容 API 文档: https://developers.cloudflare.com/r2/api/s3/api/
 *
 * 端点格式: https://{account_id}.r2.cloudflarestorage.com
 * 使用 AWS Signature V4 签名（由 @aws-sdk/client-s3 处理）
 *
 * 优化策略（v2.0.6）：
 * - 读操作（testConnection / getObject / getBase64 / exists）优先走自定义域名
 *   （公开可读，无需签名，避免 AWS Sig V4 + CORS 预检 + 海外握手开销）
 * - 写操作（putObject / putBase64Image）仍走 S3 API（自定义域名通常只读）
 * - 自定义域名失败时自动降级回 S3 API，保证可用性
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { CloudBackupConfig } from './cloudBackupTypes';

/** 自定义域名 fetch 的默认超时（ms） */
const FETCH_TIMEOUT_MS = 15000;

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

export class R2Client {
  private s3: S3Client;
  private bucket: string;
  private customDomain: string | undefined;

  constructor(config: Pick<CloudBackupConfig, 'accountId' | 'r2BucketName' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2CustomDomain'>) {
    this.bucket = config.r2BucketName;
    this.customDomain = config.r2CustomDomain?.trim() || undefined;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  /** 是否启用自定义域名直读 */
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
   * 如果配置了自定义域名，优先使用自定义域名（更快）；否则用 R2 默认路径
   */
  getPublicUrl(key: string): string {
    if (this.hasCustomDomain()) {
      return this.buildCustomUrl(key);
    }
    // 无自定义域名时返回空字符串（调用方应通过 getObject 下载）
    return '';
  }

  /**
   * 上传二进制数据到 R2
   * 写操作必须走 S3 API（自定义域名通常只读）
   */
  async putObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });
    await this.s3.send(cmd);
  }

  /**
   * 上传 base64 编码的图片到 R2
   */
  async putBase64Image(key: string, base64Data: string, contentType: string = 'image/jpeg'): Promise<void> {
    // base64 → Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    await this.putObject(key, bytes, contentType);
  }

  /**
   * 从 R2 下载对象（返回 Uint8Array）
   * 优先走自定义域名（无签名、无 CORS 预检），失败回退 S3 API
   */
  async getObject(key: string): Promise<Uint8Array> {
    // 优先走自定义域名
    if (this.hasCustomDomain()) {
      try {
        const resp = await fetchWithTimeout(this.buildCustomUrl(key), { method: 'GET' });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          return new Uint8Array(buf);
        }
        // 404 直接抛出，不降级（自定义域名已确认对象不存在）
        if (resp.status === 404) {
          throw new Error(`R2 object not found: ${key}`);
        }
        // 其他错误降级到 S3 API
        console.warn(`[R2] 自定义域名 GET 失败 ${resp.status}，降级 S3 API: ${key}`);
      } catch (err) {
        // 404 错误不降级（已确认不存在）
        if (err instanceof Error && err.message.includes('not found')) {
          throw err;
        }
        console.warn(`[R2] 自定义域名 GET 异常，降级 S3 API:`, err);
      }
    }

    // 降级：S3 API
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const resp = await this.s3.send(cmd);
    if (!resp.Body) {
      throw new Error(`R2 object not found: ${key}`);
    }
    const chunks: Uint8Array[] = [];
    const reader = (resp.Body as any).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
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
   * 优先走自定义域名 HEAD，失败回退 S3 API
   */
  async exists(key: string): Promise<boolean> {
    // 优先走自定义域名
    if (this.hasCustomDomain()) {
      try {
        const resp = await fetchWithTimeout(this.buildCustomUrl(key), { method: 'HEAD' });
        if (resp.ok) return true;
        if (resp.status === 404) return false;
        // 其他错误降级到 S3 API
        console.warn(`[R2] 自定义域名 HEAD 失败 ${resp.status}，降级 S3 API: ${key}`);
      } catch (err) {
        console.warn(`[R2] 自定义域名 HEAD 异常，降级 S3 API:`, err);
      }
    }

    // 降级：S3 API
    try {
      const cmd = new HeadObjectCommand({ Bucket: this.bucket, Key: key });
      await this.s3.send(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 测试连接
   * 优先走自定义域名 HEAD（百毫秒级），失败回退 S3 API（秒级）
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    // 优先走自定义域名
    if (this.hasCustomDomain()) {
      try {
        const testUrl = this.buildCustomUrl('__connection_test__');
        const resp = await fetchWithTimeout(testUrl, { method: 'HEAD' }, 8000);
        // 200 = 域名可达，且 R2 工作正常（说明自定义域名已绑定 bucket）
        // 404 = 域名可达，对象不存在但 R2 工作正常
        if (resp.ok || resp.status === 404) {
          return { ok: true, message: 'R2 连接成功（自定义域名）' };
        }
        // 403 / 其他 = 自定义域名配置异常，降级到 S3 API
        console.warn(`[R2] 自定义域名测试返回 ${resp.status}，降级 S3 API`);
      } catch (err) {
        console.warn(`[R2] 自定义域名测试异常，降级 S3 API:`, err);
      }
    }

    // 降级：S3 API
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: '__connection_test__',
      });
      try {
        await this.s3.send(cmd);
      } catch (err: any) {
        // 404 = 对象不存在，但 bucket 可访问 → 连接正常
        // 403 = 凭证无效或 bucket 不存在
        const name = err?.name || '';
        if (name === 'NotFound' || name === 'NoSuchKey') {
          return { ok: true, message: 'R2 连接成功（S3 API）' };
        }
        if (name === 'NoSuchBucket') {
          return { ok: false, message: `Bucket "${this.bucket}" 不存在` };
        }
        if (name === 'Forbidden' || name === 'AccessDenied') {
          return { ok: false, message: '凭证无效或无权限访问该 Bucket' };
        }
      }
      return { ok: true, message: 'R2 连接成功（S3 API）' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'R2 连接失败',
      };
    }
  }
}
