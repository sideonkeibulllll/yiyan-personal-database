/**
 * 数据库服务工厂
 * 根据平台返回合适的数据库实现
 * - electron: 使用 ElectronSQLite 适配器（IPC + sql.js）
 * - web: 使用 WebDatabaseService（jeep-sqlite/IndexedDB）
 * - android/ios: 使用 NativeDatabaseService（Capacitor SQLite）
 */
import type { IDatabaseService } from './types';
import { isElectron } from './electronAdapter';

let dbInstance: IDatabaseService | null = null;

export async function getDatabase(): Promise<IDatabaseService> {
  if (dbInstance) {
    // 健康检查：确保连接仍然可用
    // Android 上应用切后台再恢复可能导致连接丢失
    const nativeDb = dbInstance as any;
    if (typeof nativeDb.ensureConnection === 'function') {
      try {
        await nativeDb.ensureConnection();
      } catch (err) {
        console.warn('[database] ensureConnection failed, recreating instance:', err);
        dbInstance = null;
      }
    }
  }

  if (dbInstance) return dbInstance;

  if (isElectron()) {
    // Electron 桌面端：复用 NativeDatabaseService 的业务逻辑，
    // 但通过适配器将 SQLite 调用转发到主进程的 sql.js
    const { NativeDatabaseService } = await import('./nativeDatabase');
    const { getElectronSQLiteAdapter } = await import('./electronAdapter');
    const { CapacitorSQLite, SQLiteConnection } = getElectronSQLiteAdapter();
    // 临时替换全局的 CapacitorSQLite，让 NativeDatabaseService 使用适配器
    (globalThis as any).__ELECTRON_SQLITE__ = { CapacitorSQLite, SQLiteConnection };
    dbInstance = new NativeDatabaseService(true);
  } else {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() === 'web') {
      const { WebDatabaseService } = await import('./webDatabase');
      dbInstance = new WebDatabaseService();
    } else {
      const { NativeDatabaseService } = await import('./nativeDatabase');
      dbInstance = new NativeDatabaseService();
    }
  }

  try {
    await dbInstance.init();
  } catch (err) {
    // init 失败，清除单例，让下次调用重试
    console.error('[database] init failed:', err);
    dbInstance = null;
    throw err;
  }
  return dbInstance;
}

export type { IDatabaseService };
