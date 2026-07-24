/**
 * 对话历史持久化服务（v2.0.0）
 *
 * 将对话历史从 localStorage 迁移到 SQLite 数据库，
 * 实现 chat_sessions 表的统一读写，并支持备份/恢复。
 *
 * 兼容策略：首次调用时自动从旧 localStorage key 迁移数据。
 */

import { getDatabase } from './database';
import type { ChatSession } from './types';

const LEGACY_SESSIONS_KEY = 'yiyan_chat_sessions';
const MIGRATION_FLAG_KEY = 'yiyan_chat_sessions_migrated';

/** 自动迁移：首次运行时把旧 localStorage 数据导入数据库 */
async function migrateIfNeeded(): Promise<void> {
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return;
  try {
    const stored = localStorage.getItem(LEGACY_SESSIONS_KEY);
    if (stored) {
      const legacySessions = JSON.parse(stored) as ChatSession[];
      if (Array.isArray(legacySessions) && legacySessions.length > 0) {
        const db = await getDatabase();
        for (const session of legacySessions) {
          await db.saveChatSession(session);
        }
      }
      // 迁移后清除旧数据，避免重复
      localStorage.removeItem(LEGACY_SESSIONS_KEY);
    }
  } catch {
    // 忽略迁移错误
  }
  localStorage.setItem(MIGRATION_FLAG_KEY, '1');
}

/** 加载所有对话会话 */
export async function loadChatSessions(): Promise<ChatSession[]> {
  await migrateIfNeeded();
  const db = await getDatabase();
  return db.getAllChatSessions();
}

/** 保存单个对话会话（新增或更新） */
export async function saveChatSession(session: ChatSession): Promise<void> {
  const db = await getDatabase();
  await db.saveChatSession(session);
}

/** 批量保存对话会话（用于批量替换场景） */
export async function saveAllChatSessions(sessions: ChatSession[]): Promise<void> {
  const db = await getDatabase();
  // 先清空再批量写入（简单实现，数据量不大）
  await db.deleteAllChatSessions();
  for (const session of sessions) {
    await db.saveChatSession(session);
  }
}

/** 删除单个对话会话 */
export async function deleteChatSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.deleteChatSession(id);
}

/** 删除所有对话会话 */
export async function deleteAllChatSessions(): Promise<void> {
  const db = await getDatabase();
  await db.deleteAllChatSessions();
}
