/**
 * 待办标签状态管理（独立标签池）
 */
import { create } from 'zustand';
import type { TodoTag } from '@/types';
import { getTodoDatabase } from '@/services/todoDatabase';

interface TodoTagStore {
  tags: TodoTag[];
  isLoading: boolean;
  error: string | null;

  loadTags: () => Promise<void>;
  createTag: (name: string, color?: string) => Promise<TodoTag>;
  updateTag: (id: string, updates: Partial<TodoTag>) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
}

export const useTodoTagStore = create<TodoTagStore>((set, get) => ({
  tags: [],
  isLoading: false,
  error: null,

  loadTags: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = await getTodoDatabase();
      const tags = await db.getAllTodoTags();
      set({ tags, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createTag: async (name, color) => {
    const db = await getTodoDatabase();
    const tag = await db.createTodoTag(name, color);
    // v2.6.1：同名标签会复用已有记录（见 nativeTodoDatabase.createTodoTag），
    // 此时 tag 已存在于列表中，不能重复前插，否则 UI 会出现两个同名标签
    set(state => (state.tags.some(t => t.id === tag.id) ? state : { tags: [tag, ...state.tags] }));
    return tag;
  },

  updateTag: async (id, updates) => {
    const db = await getTodoDatabase();
    await db.updateTodoTag(id, updates);
    set(state => ({
      tags: state.tags.map(t => t.id === id ? { ...t, ...updates } : t),
    }));
  },

  deleteTag: async (id) => {
    const db = await getTodoDatabase();
    await db.deleteTodoTag(id);
    set(state => ({
      tags: state.tags.filter(t => t.id !== id),
    }));
  },
}));
