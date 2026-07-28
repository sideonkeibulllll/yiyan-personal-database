/**
 * Cloudflare D1 REST API 客户端封装
 *
 * D1 REST API 文档: https://developers.cloudflare.com/d1/d1-client-api/
 *
 * 支持两种模式：
 * 1. 直连 Cloudflare D1 REST API（默认）
 * 2. 走中转站（Cloudflare Worker 代理）— 设置 config.useTransferStation = true
 *
 * 注意：D1 单次查询支持多条 SQL 语句（通过 sql 字段传多条 ; 分隔语句），
 *       但参数绑定只在第一条生效。需要参数绑定的多条 INSERT 要分多次请求。
 *       为了减少请求次数，无参数的 SQL 可以合并成一条请求。
 */
import type { D1QueryResponse, CloudBackupConfig } from './cloudBackupTypes';

const D1_API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
/** 中转站 D1 逻辑库名（个人数据库用 memory） */
const TS_DB_KEY = 'memory';

export class D1Client {
  private accountId: string;
  private databaseId: string;
  private token: string;
  private baseUrl: string;
  private useTransferStation: boolean;
  private tsUrl: string;
  private tsToken: string;

  constructor(config: Pick<CloudBackupConfig, 'accountId' | 'd1DatabaseId' | 'd1ApiToken' | 'useTransferStation' | 'transferStationUrl' | 'transferStationToken'>) {
    this.accountId = config.accountId;
    this.databaseId = config.d1DatabaseId;
    this.token = config.d1ApiToken;
    this.baseUrl = `${D1_API_BASE}/${this.accountId}/d1/database/${this.databaseId}`;
    this.useTransferStation = config.useTransferStation ?? false;
    this.tsUrl = config.transferStationUrl?.replace(/\/$/, '') ?? '';
    this.tsToken = config.transferStationToken ?? '';
  }

  /** 是否走中转站 */
  private isTransferStationMode(): boolean {
    return this.useTransferStation && !!this.tsUrl && !!this.tsToken;
  }

  /**
   * 执行单条 SQL（带参数绑定）
   */
  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (this.isTransferStationMode()) {
      return this.queryViaTransferStation(sql, params);
    }
    return this.queryDirect(sql, params);
  }

  /** 直连 D1 REST API 查询 */
  private async queryDirect(sql: string, params: any[]): Promise<any[]> {
    const resp = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`D1 API ${resp.status}: ${text}`);
    }

    const data: D1QueryResponse = await resp.json();
    if (data.errors && data.errors.length > 0) {
      throw new Error(`D1 error: ${data.errors.map(e => e.message).join('; ')}`);
    }
    if (!data.result || data.result.length === 0) {
      return [];
    }
    return data.result[0].results || [];
  }

  /** 走中转站 D1 查询 */
  private async queryViaTransferStation(sql: string, params: any[]): Promise<any[]> {
    const resp = await fetch(`${this.tsUrl}/d1/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.tsToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ db: TS_DB_KEY, sql, params }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`D1(TS) API ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (!data.ok) {
      throw new Error(`D1(TS) error: ${data.error ?? JSON.stringify(data)}`);
    }
    return data.results ?? [];
  }

  /**
   * 批量执行多条 SQL（不带参数绑定，用于建表、清空等）
   * D1 支持在一条请求的 sql 字段中放多条 ; 分隔的语句
   */
  async batchExec(sql: string): Promise<void> {
    if (this.isTransferStationMode()) {
      // 中转站用 /d1/batch 发送单条无参数语句
      await this.queryViaTransferStation(sql, []);
      return;
    }
    const resp = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`D1 batchExec ${resp.status}: ${text}`);
    }

    const data: D1QueryResponse = await resp.json();
    if (data.errors && data.errors.length > 0) {
      throw new Error(`D1 batch error: ${data.errors.map(e => e.message).join('; ')}`);
    }
  }

  /**
   * 批量插入（参数化）
   * - 直连模式：D1 REST API 一次请求只能绑定一组 params，多条 INSERT 需多次请求，每批 10 条并发
   * - 中转站模式：用 /d1/batch 一次性发送所有语句（Worker 用 native binding batch 执行，更快）
   */
  async batchInsert(sql: string, paramsList: any[][]): Promise<void> {
    if (this.isTransferStationMode()) {
      await this.batchInsertViaTransferStation(sql, paramsList);
      return;
    }
    const BATCH_CONCURRENCY = 10;
    for (let i = 0; i < paramsList.length; i += BATCH_CONCURRENCY) {
      const batch = paramsList.slice(i, i + BATCH_CONCURRENCY);
      await Promise.all(batch.map(params => this.query(sql, params)));
    }
  }

  /** 走中转站批量插入 */
  private async batchInsertViaTransferStation(sql: string, paramsList: any[][]): Promise<void> {
    const CHUNK = 50; // 中转站单块语句数上限
    for (let i = 0; i < paramsList.length; i += CHUNK) {
      const slice = paramsList.slice(i, i + CHUNK);
      const statements = slice.map(params => ({ sql, params }));
      const resp = await fetch(`${this.tsUrl}/d1/batch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tsToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ db: TS_DB_KEY, statements }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`D1(TS) batch ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      if (!data.ok) {
        throw new Error(`D1(TS) batch error: ${data.error ?? JSON.stringify(data)}`);
      }
    }
  }

  /**
   * 初始化数据库表结构
   */
  async initSchema(initSql: string): Promise<void> {
    await this.batchExec(initSql);
  }

  /**
   * 获取 _sync_state 中的值
   */
  async getSyncState(key: string): Promise<string | null> {
    const rows = await this.query(
      'SELECT value FROM _sync_state WHERE key = ?',
      [key]
    );
    return rows.length > 0 ? rows[0].value : null;
  }

  /**
   * 设置 _sync_state 中的值
   */
  async setSyncState(key: string, value: string): Promise<void> {
    await this.query(
      'INSERT OR REPLACE INTO _sync_state (key, value) VALUES (?, ?)',
      [key, value]
    );
  }

  /**
   * 测试连接（尝试查询 _sync_state 表）
   * 如果表不存在会自动创建（调用 initSchema）
   */
  async testConnection(initSql: string): Promise<{ ok: boolean; message: string }> {
    try {
      // 先尝试建表（如果已存在会 IF NOT EXISTS 跳过）
      await this.batchExec(initSql);
      // 再查询验证
      await this.query('SELECT COUNT(*) as c FROM _sync_state', []);
      return { ok: true, message: '连接成功，数据库已就绪' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '连接失败',
      };
    }
  }
}
