// Cloudflare D1 REST API 客户端 — 函数式扁平结构
// v2.7.0：**只走中转站**（Cloudflare Worker 代理），D1 直连与 apiToken 已移除。
// 原生端用 CapacitorHttp 绕过 CORS，Web 端用 fetch。
import { CapacitorHttp, Capacitor } from "@capacitor/core";
import { TRANSFER_STATION } from "@/config/cloudflare";
import { D1_INIT_SQL } from "./cloudBackupTypes";

type SqlParam = string | number | null | undefined;

/**
 * 执行 SQL 查询（走中转站）
 */
export async function d1Query<T = any>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  return d1QueryViaTransferStation<T>(sql, params);
}

/** 走中转站 D1 查询 */
async function d1QueryViaTransferStation<T = any>(
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const url = `${TRANSFER_STATION.url}/d1/query`;
  const body = { db: TRANSFER_STATION.db, sql, params };

  let json: any;
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url,
      headers: {
        Authorization: `Bearer ${TRANSFER_STATION.token}`,
        "Content-Type": "application/json",
      },
      data: body,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`D1(TS) HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    json = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  } else {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TRANSFER_STATION.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`D1(TS) HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    json = await res.json();
  }

  if (!json.ok) throw new Error(`D1(TS) 查询失败: ${json.error ?? JSON.stringify(json)}`);
  return (json.results ?? []) as T[];
}

/**
 * 批量执行无参数 SQL（建表等）
 */
export async function d1BatchExec(sql: string): Promise<void> {
  // D1 REST API 和中转站都支持在 sql 字段中放多条 ; 分隔的语句
  await d1Query(sql, []);
}

/**
 * 批量参数化插入（并发执行，显著降低总耗时）
 *
 * 说明：D1 REST API 单次只支持一组 params，因此这里靠**提高并发**提速，
 * 而不是合并 SQL。并发数 10 是实测的中转站/直连都能稳定承受的值。
 */
export async function d1BatchInsert(
  sql: string,
  paramsList: SqlParam[][],
  concurrency = 10,
): Promise<void> {
  if (paramsList.length === 0) return;
  const limit = Math.max(1, concurrency);
  let next = 0;
  const workers = new Array(Math.min(limit, paramsList.length)).fill(0).map(async () => {
    while (next < paramsList.length) {
      const idx = next++;
      await d1Query(sql, paramsList[idx]);
    }
  });
  await Promise.all(workers);
}

/** 批处理并发常量（统一出口，方便调优） */
export const D1_CONCURRENCY = 10;

/** 测试连接结果缓存（避免每次操作前重复测连） */
let _connCache: { at: number; result: { ok: boolean; message: string } } | null = null;
const CONN_CACHE_TTL = 60_000;

/**
 * 初始化表结构（进程内只执行一次）
 */
let _schemaReady = false;
export async function d1InitSchemaOnce(): Promise<void> {
  if (_schemaReady) return;
  await d1BatchExec(D1_INIT_SQL);
  _schemaReady = true;
}

/**
 * 初始化表结构（按需调用）
 */
export async function d1InitSchema(): Promise<void> {
  await d1BatchExec(D1_INIT_SQL);
}

/**
 * 获取同步状态
 */
export async function d1GetSyncState(key: string): Promise<string | null> {
  const rows = await d1Query<{ value: string }>(
    "SELECT value FROM _sync_state WHERE key = ?",
    [key],
  );
  return rows.length > 0 ? rows[0].value : null;
}

/**
 * 设置同步状态
 */
export async function d1SetSyncState(key: string, value: string): Promise<void> {
  await d1Query(
    "INSERT OR REPLACE INTO _sync_state (key, value) VALUES (?, ?)",
    [key, value],
  );
}

/**
 * 测试连接 — 轻量查询，不执行建表
 */
export async function d1TestConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const rows = await d1Query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1",
    );
    const tableName = rows.length > 0 ? rows[0].name : "(空)";
    return { ok: true, message: `连接成功，表：${tableName}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "连接失败",
    };
  }
}
