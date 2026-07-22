/**
 * 标签状态管理
 */
import { create } from 'zustand';
import type { Tag } from '@/types';
import { getDatabase } from '@/services/database';

interface TagStore {
  tags: Tag[];
  isLoading: boolean;

  loadTags: () => Promise<void>;
  addTag: (name: string) => Promise<Tag>;
  removeTag: (id: string) => Promise<void>;
  renameTag: (id: string, newName: string) => Promise<void>;
  addTagToEntry: (entryId: string, tagId: string) => Promise<void>;
  removeTagFromEntry: (entryId: string, tagId: string) => Promise<void>;
  getTagsByEntryId: (entryId: string) => Promise<Tag[]>;
}

export const useTagStore = create<TagStore>((set, get) => ({
  tags: [],
  isLoading: false,

  loadTags: async () => {
    set({ isLoading: true });
    try {
      const db = await getDatabase();
      const tags = await db.getAllTags();
      set({ tags, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  addTag: async (name) => {
    const db = await getDatabase();
    const existing = get().tags.find(t => t.name === name);
    if (existing) return existing;

    const tag = await db.createTag(name);
    set(state => ({ tags: [tag, ...state.tags] }));
    return tag;
  },

  removeTag: async (id) => {
    const db = await getDatabase();
    await db.deleteTag(id);
    set(state => ({ tags: state.tags.filter(t => t.id !== id) }));
  },

  renameTag: async (id, newName) => {
    const db = await getDatabase();
    await db.renameTag(id, newName);
    set(state => ({
      tags: state.tags.map(t => t.id === id ? { ...t, name: newName } : t),
    }));
  },

  addTagToEntry: async (entryId, tagId) => {
    const db = await getDatabase();
    await db.addTagToEntry(entryId, tagId);
  },

  removeTagFromEntry: async (entryId, tagId) => {
    const db = await getDatabase();
    await db.removeTagFromEntry(entryId, tagId);
  },

  getTagsByEntryId: async (entryId) => {
    const db = await getDatabase();
    return db.getTagsByEntryId(entryId);
  },
}));
