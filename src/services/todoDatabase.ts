/**
 * 待办数据库服务工厂
 * 根据平台返回合适的待办数据库实现
 * - electron: 使用 ElectronSQLite 适配器（IPC + sql.js）
 * - web: 使用 WebTodoDatabaseService（jeep-sqlite/IndexedDB）
 * - android/ios: 使用 NativeTodoDatabaseService（Capacitor SQLite）
 */
import type { ITodoDatabaseService } from './types';
import { isElectron } from './electronAdapter';

let todoDbInstance: ITodoDatabaseService | null = null;

export async function getTodoDatabase(): Promise<ITodoDatabaseService> {
  if (todoDbInstance) {
    // 健康检查
    const nativeDb = todoDbInstance as any;
    if (typeof nativeDb.ensureConnection === 'function') {
      try {
        await nativeDb.ensureConnection();
      } catch (err) {
        console.warn('[todoDatabase] ensureConnection failed, recreating instance:', err);
        todoDbInstance = null;
      }
    }
  }

  if (todoDbInstance) return todoDbInstance;

  if (isElectron()) {
    const { NativeTodoDatabaseService } = await import('./nativeTodoDatabase');
    todoDbInstance = new NativeTodoDatabaseService(true);
  } else {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() === 'web') {
      const { WebTodoDatabaseService } = await import('./webTodoDatabase');
      todoDbInstance = new WebTodoDatabaseService();
    } else {
      const { NativeTodoDatabaseService } = await import('./nativeTodoDatabase');
      todoDbInstance = new NativeTodoDatabaseService();
    }
  }

  await todoDbInstance.init();
  return todoDbInstance;
}

export type { ITodoDatabaseService };
