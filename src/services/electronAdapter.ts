/**
 * Electron 平台检测与 SQLite 适配器
 *
 * 检测是否在 Electron 环境中运行
 * 如果是，提供一个模拟 Capacitor SQLiteDBConnection 的适配器
 * 这样 NativeDatabaseService 的业务逻辑可以零改动复用
 */

/** 检测是否在 Electron 环境中 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

/**
 * 模拟 Capacitor SQLiteDBConnection 的适配器
 * 将 db.run / db.query 转发到 IPC
 */
class ElectronSQLiteDBConnection {
  constructor(private dbName: string) {}

  async open(): Promise<void> {
    await (window as any).electronAPI.db.open(this.dbName);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await (window as any).electronAPI.db.run(this.dbName, sql, params);
  }

  async query(sql: string, params: unknown[] = []): Promise<{ values: Record<string, unknown>[] }> {
    return await (window as any).electronAPI.db.query(this.dbName, sql, params);
  }
}

/**
 * 模拟 Capacitor SQLiteConnection 的适配器
 * 提供 checkConnectionsConsistency / isConnection / createConnection / retrieveConnection
 */
class ElectronSQLiteConnection {
  async checkConnectionsConsistency(): Promise<{ result: boolean }> {
    return { result: true };
  }

  async isConnection(_name: string, _readonly: boolean): Promise<{ result: boolean }> {
    return { result: false };
  }

  async createConnection(name: string, _readonly: boolean, _encryption: string, _version: number, _web: boolean): Promise<ElectronSQLiteDBConnection> {
    return new ElectronSQLiteDBConnection(name);
  }

  async retrieveConnection(name: string, _readonly: boolean): Promise<ElectronSQLiteDBConnection> {
    return new ElectronSQLiteDBConnection(name);
  }

  // Electron 不需要 web store
  async initWebStore(): Promise<void> {}
}

/**
 * 获取 Electron 环境下的 SQLite 适配器
 * 兼容 @capacitor-community/sqlite 的接口
 */
export function getElectronSQLiteAdapter(): {
  CapacitorSQLite: any;
  SQLiteConnection: any;
} {
  return {
    CapacitorSQLite: {}, // Electron 不需要原始插件
    SQLiteConnection: ElectronSQLiteConnection,
  };
}

/** Electron 平台标识（替代 Capacitor.getPlatform()） */
export function getPlatform(): 'electron' | 'web' | 'android' | 'ios' {
  if (isElectron()) return 'electron';
  // 复用 Capacitor 的平台检测
  try {
    const { Capacitor } = require('@capacitor/core');
    return Capacitor.getPlatform() as any;
  } catch {
    return 'web';
  }
}
