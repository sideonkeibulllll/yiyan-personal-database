/**
 * Electron 数据库桥接（sql.js 实现）
 *
 * 使用 sql.js（纯 WASM SQLite）替代 @capacitor-community/sqlite
 * - 无需原生编译，跨平台一致
 * - 数据库以单文件存储，方便备份
 * - 提供 run/query 接口，与 Capacitor SQLite 兼容
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

// sql.js 的类型定义不够完整，使用 require 方式加载
type SqlJsDatabase = {
  run(sql: string, params?: unknown[]): SqlJsDatabase;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
  getRowsModified(): number;
};

type SqlJsStatement = {
  bind(params?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
};

type SqlJsStatic = {
  Database: new (data?: Uint8Array | null) => SqlJsDatabase;
};

let SQL: SqlJsStatic | null = null;
const databases = new Map<string, SqlJsDatabase>();
const dbPaths = new Map<string, string>();
const saveTimers = new Map<string, NodeJS.Timeout>();

/** 初始化 sql.js WASM 引擎 */
async function initSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  // sql.js 需要指定 wasm 文件路径
  // 开发环境从 node_modules 加载，生产环境从 extraResources 加载
  const path = require('path');
  const fs = require('fs');

  let wasmPath: string;
  if (app.isPackaged) {
    // 生产环境：extraResources 中的 sql-wasm.wasm
    wasmPath = path.join(process.resourcesPath, 'sql-wasm.wasm');
  } else {
    // 开发环境：node_modules 中的 wasm 文件
    wasmPath = path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm');
  }

  const initSqlJs = require('sql.js');
  const sql = await initSqlJs({
    locateFile: () => wasmPath,
  });
  SQL = sql as SqlJsStatic;
  return SQL;
}

/** 获取数据库存储目录 */
function getDbDir(): string {
  const dir = path.join(app.getPath('userData'), 'databases');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 获取数据库文件路径 */
function getDbPath(name: string): string {
  return path.join(getDbDir(), `${name}.sqlite`);
}

/** 延迟保存（防抖，避免频繁写盘） */
function scheduleSave(name: string): void {
  const existing = saveTimers.get(name);
  if (existing) clearTimeout(existing);
  saveTimers.set(name, setTimeout(() => {
    saveDatabase(name).catch(() => { /* ignore */ });
  }, 1000));
}

/** 保存数据库到文件 */
async function saveDatabase(name: string): Promise<void> {
  const db = databases.get(name);
  if (!db) return;
  const dbPath = dbPaths.get(name);
  if (!dbPath) return;
  const data = db.export();
  await fsp.writeFile(dbPath, Buffer.from(data));
}

/**
 * 打开/创建数据库连接
 * @param name 数据库名称（如 memorydb, memorydb_todo）
 */
export async function openDatabase(name: string): Promise<void> {
  if (databases.has(name)) return;
  const sql = await initSqlJs();
  const dbPath = getDbPath(name);
  let data: Uint8Array | null = null;
  if (fs.existsSync(dbPath)) {
    const buffer = await fsp.readFile(dbPath);
    data = new Uint8Array(buffer);
  }
  const db = new sql.Database(data);
  databases.set(name, db);
  dbPaths.set(name, dbPath);
}

/**
 * 执行 SQL（INSERT/UPDATE/DELETE/CREATE 等）
 * 兼容 Capacitor SQLite 的 db.run(sql, params) 接口
 */
export function dbRun(name: string, sql: string, params: unknown[] = []): void {
  const db = databases.get(name);
  if (!db) throw new Error(`Database "${name}" not opened`);
  db.run(sql, params);
  scheduleSave(name);
}

/**
 * 查询 SQL（SELECT）
 * 兼容 Capacitor SQLite 的 db.query(sql, params) 接口
 * 返回 { values: Record<string, unknown>[] }
 */
export function dbQuery(name: string, sql: string, params: unknown[] = []): { values: Record<string, unknown>[] } {
  const db = databases.get(name);
  if (!db) throw new Error(`Database "${name}" not opened`);

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const values: Record<string, unknown>[] = [];
  while (stmt.step()) {
    values.push(stmt.getAsObject());
  }
  stmt.free();
  return { values };
}

/** 立即保存所有数据库到磁盘 */
export async function flushAll(): Promise<void> {
  const names = Array.from(databases.keys());
  for (const name of names) {
    const timer = saveTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(name);
    }
    await saveDatabase(name);
  }
}

/** 关闭所有数据库 */
export async function closeAll(): Promise<void> {
  await flushAll();
  for (const [name, db] of databases) {
    db.close();
  }
  databases.clear();
  dbPaths.clear();
}
