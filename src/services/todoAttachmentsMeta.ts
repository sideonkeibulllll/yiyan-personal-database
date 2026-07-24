/**
 * 待办附件元数据存储（localStorage 方案）
 * c: 解决待办附件选择后在编辑页不显示的问题
 *
 * 存储结构：localStorage 中以 todoId 为键存储 TodoAttachment[]
 */

import type { TodoAttachment } from '@/types';

const STORAGE_PREFIX = '__yiyan_todo_attachments__';

function getKey(todoId: string): string {
  return `${STORAGE_PREFIX}${todoId}`;
}

/**
 * 保存附件元数据
 */
export function saveTodoAttachments(todoId: string, attachments: TodoAttachment[]): void {
  try {
    localStorage.setItem(getKey(todoId), JSON.stringify(attachments));
  } catch (e) {
    console.warn('[todoAttachmentsMeta] save failed:', e);
  }
}

/**
 * 追加单个附件
 */
export function appendTodoAttachment(todoId: string, attachment: TodoAttachment): void {
  const existing = getTodoAttachments(todoId);
  existing.push(attachment);
  saveTodoAttachments(todoId, existing);
}

/**
 * 获取附件列表
 */
export function getTodoAttachments(todoId: string): TodoAttachment[] {
  try {
    const json = localStorage.getItem(getKey(todoId));
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 删除单个附件
 */
export function removeTodoAttachment(todoId: string, attachmentId: string): TodoAttachment[] {
  const existing = getTodoAttachments(todoId);
  const filtered = existing.filter(a => a.id !== attachmentId);
  saveTodoAttachments(todoId, filtered);
  return filtered;
}

/**
 * 删除某待办的所有附件元数据
 */
export function clearTodoAttachments(todoId: string): void {
  try {
    localStorage.removeItem(getKey(todoId));
  } catch {}
}
