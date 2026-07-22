/**
 * 数据库服务工厂
 * 根据平台返回合适的数据库实现
 */
import type { IDatabaseService } from './types';

let dbInstance: IDatabaseService | null = null;

export async function getDatabase(): Promise<IDatabaseService> {
  if (dbInstance) return dbInstance;

  const { Capacitor } = await import('@capacitor/core');

  if (Capacitor.getPlatform() === 'web') {
    const { WebDatabaseService } = await import('./webDatabase');
    dbInstance = new WebDatabaseService();
  } else {
    const { NativeDatabaseService } = await import('./nativeDatabase');
    dbInstance = new NativeDatabaseService();
  }

  await dbInstance.init();
  return dbInstance;
}

export type { IDatabaseService };
