/**
 * 待办数据库服务工厂
 * 根据平台返回合适的待办数据库实现
 */
import type { ITodoDatabaseService } from './types';

let todoDbInstance: ITodoDatabaseService | null = null;

export async function getTodoDatabase(): Promise<ITodoDatabaseService> {
  if (todoDbInstance) return todoDbInstance;

  const { Capacitor } = await import('@capacitor/core');

  if (Capacitor.getPlatform() === 'web') {
    const { WebTodoDatabaseService } = await import('./webTodoDatabase');
    todoDbInstance = new WebTodoDatabaseService();
  } else {
    const { NativeTodoDatabaseService } = await import('./nativeTodoDatabase');
    todoDbInstance = new NativeTodoDatabaseService();
  }

  await todoDbInstance.init();
  return todoDbInstance;
}

export type { ITodoDatabaseService };
