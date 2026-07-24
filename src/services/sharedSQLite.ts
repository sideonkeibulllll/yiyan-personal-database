/**
 * 共享的 SQLiteConnection 实例
 *
 * NativeDatabaseService 和 NativeTodoDatabaseService 必须共用同一个 SQLiteConnection，
 * 否则各自的 _connectionDict 会与原生层 dbDict 不一致。
 *
 * 问题根因：
 * @capacitor-community/sqlite 的 SQLiteConnection 维护一个 JS 层 _connectionDict，
 * 但底层原生 CapacitorSQLite 插件是全局单例，维护一个原生层 dbDict。
 * 如果两个 DB 服务各自 new SQLiteConnection(CapacitorSQLite)，会有两个 JS 层 dict，
 * 但只有一个原生 dict。checkConnectionsConsistency 只检查自己 dict 里的连接名，
 * 会把另一个 dict 里的连接从原生 dict 中移除，导致 "No available connection" 错误。
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

let sharedConnection: SQLiteConnection | null = null;

export function getSharedSQLiteConnection(): SQLiteConnection {
  if (!sharedConnection) {
    sharedConnection = new SQLiteConnection(CapacitorSQLite);
  }
  return sharedConnection;
}
