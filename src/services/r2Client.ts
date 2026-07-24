/**
 * Cloudflare R2 客户端封装（S3 兼容 API）
 *
 * R2 S3 兼容 API 文档: https://developers.cloudflare.com/r2/api/s3/api/
 *
 * 端点格式: https://{account_id}.r2.cloudflarestorage.com
 * 使用 AWS Signature V4 签名（由 @aws-sdk/client-s3 处理）
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { CloudBackupConfig } from './cloudBackupTypes';

export class R2Client {
  private s3: S3Client;
  private bucket: string;
  private customDomain: string | undefined;

  constructor(config: Pick<CloudBackupConfig, 'accountId' | 'r2BucketName' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2CustomDomain'>) {
    this.bucket = config.r2BucketName;
    this.customDomain = config.r2CustomDomain;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    });
  }

  /**
   * 获取附件的公开访问 URL
   * 如果配置了自定义域名，优先使用自定义域名（更快）；否则用 R2 默认路径
   */
  getPublicUrl(key: string): string {
    if (this.customDomain) {
      const domain = this.customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `https://${domain}/${key}`;
    }
    // 无自定义域名时返回空字符串（调用方应通过 getObject 下载）
    return '';
  }

  /**
   * 上传二进制数据到 R2
   * @param key 对象 key（如 attachments/xxx_orig.jpg）
   * @param data 二进制数据
   * @param contentType MIME 类型
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
   */
  async getObject(key: string): Promise<Uint8Array> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const resp = await this.s3.send(cmd);
    if (!resp.Body) {
      throw new Error(`R2 object not found: ${key}`);
    }
    // resp.Body 是 Readable 流，转成 Uint8Array
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
   */
  async exists(key: string): Promise<boolean> {
    try {
      const cmd = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(cmd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 测试连接（尝试 HEAD bucket）
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // 尝试 HEAD 一个不存在的 key，只要不报 NoSuchBucket 就说明 bucket 存在且凭证有效
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
          return { ok: true, message: 'R2 连接成功' };
        }
        if (name === 'NoSuchBucket') {
          return { ok: false, message: `Bucket "${this.bucket}" 不存在` };
        }
        // 其他错误也可能是凭证问题但连接通了
        if (name === 'Forbidden' || name === 'AccessDenied') {
          return { ok: false, message: '凭证无效或无权限访问该 Bucket' };
        }
      }
      // 如果 HeadObject 成功（不太可能，因为 key 不存在），也视为连接正常
      return { ok: true, message: 'R2 连接成功' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'R2 连接失败',
      };
    }
  }
}
