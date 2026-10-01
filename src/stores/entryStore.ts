/**
 * 条目状态管理
 */
import { create } from 'zustand';
import type { Entry } from '@/types';
import { getDatabase } from '@/services/database';

interface EntryStore {
  entries: Entry[];
  currentEntry: Entry | null;
  isLoading: boolean;
  error: string | null;

  // 操作
  loadEntries: () => Promise<void>;
  /** 启动优化（v2.4.3）：先取最近 N 条让首屏可用，剩余全量在后台补齐 */
  loadEntriesProgressive: (firstBatch?: number) => Promise<void>;
  addEntry: (content: string, options?: { source?: string; groupId?: string; supplement?: string }) => Promise<Entry>;
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  markAsUsed: (id: string) => Promise<void>;
  setCurrentEntry: (entry: Entry | null) => void;
  search: (keyword: string, options?: { tagIds?: string[]; isStarred?: boolean; hasAttachment?: boolean }) => Promise<Entry[]>;
  importEntries: (jsonText: string) => Promise<{ imported: number; skipped: number; total: number; errors: string[] }>;
}

export const useEntryStore = create<EntryStore>((set, get) => ({
  entries: [],
  currentEntry: null,
  isLoading: false,
  error: null,

  loadEntries: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const entries = await db.getAllEntries();
      set({ entries, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  /**
   * 启动优化（v2.4.3）
   * 两段式加载：先用 SQL 层 LIMIT 取回最近 N 条（首页只需要看最近几条），
   * 让界面尽快可用；随后在后台静默补齐全量数据。
   * 全量数据补齐后覆盖 entries，保证搜索/随机等页面拿到的仍是完整列表。
   */
  loadEntriesProgressive: async (firstBatch = 50) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();

      // 第一段：只要最近 N 条（优先走支持 LIMIT 的实现）
      const recent = await db.getRecentEntries(firstBatch);
      set({ entries: recent, isLoading: false });

      // 第二段：后台补齐全量，不阻塞任何渲染
      const all = await db.getAllEntries();
      if (all.length > recent.length) {
        set({ entries: all });
      }
    } catch (error) {
      // 降级：任一步失败都退回全量加载
      try {
        const db = await getDatabase();
        set({ entries: await db.getAllEntries(), isLoading: false });
      } catch (e) {
        set({ error: (e as Error).message, isLoading: false });
      }
    }
  },

  addEntry: async (content, options) => {
    const now = Date.now();
    const db = await getDatabase();
    const entry = await db.createEntry({
      id: `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`,
      content,
      source: options?.source,
      groupId: options?.groupId,
      supplement: options?.supplement,
      isStarred: false,
      createdAt: now,
      updatedAt: now,
      copyCount: 0,
    });

    set(state => ({ entries: [entry, ...state.entries] }));
    return entry;
  },

  updateEntry: async (id, updates) => {
    const db = await getDatabase();
    await db.updateEntry(id, updates);
    set(state => ({
      entries: state.entries.map(e => e.id === id ? { ...e, ...updates } : e),
      currentEntry: state.currentEntry?.id === id ? { ...state.currentEntry, ...updates } : state.currentEntry,
    }));
  },

  deleteEntry: async (id) => {
    const db = await getDatabase();
    await db.deleteEntry(id);
    set(state => ({
      entries: state.entries.filter(e => e.id !== id),
      currentEntry: state.currentEntry?.id === id ? null : state.currentEntry,
    }));
  },

  toggleStar: async (id) => {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;

    const newStarred = !entry.isStarred;
    const db = await getDatabase();
    await db.updateEntry(id, { isStarred: newStarred });
    set(state => ({
      entries: state.entries.map(e => e.id === id ? { ...e, isStarred: newStarred } : e),
      currentEntry: state.currentEntry?.id === id ? { ...state.currentEntry, isStarred: newStarred } : state.currentEntry,
    }));
  },

  markAsUsed: async (id) => {
    const entry = get().entries.find(e => e.id === id);
    if (!entry) return;

    const now = Date.now();
    const newCount = (entry.copyCount || 0) + 1;
    const db = await getDatabase();
    await db.updateEntry(id, { lastUsedAt: now, copyCount: newCount });
    set(state => ({
      entries: state.entries.map(e => e.id === id ? { ...e, lastUsedAt: now, copyCount: newCount } : e),
      currentEntry: state.currentEntry?.id === id ? { ...state.currentEntry, lastUsedAt: now, copyCount: newCount } : state.currentEntry,
    }));
  },

  setCurrentEntry: (entry) => set({ currentEntry: entry }),

  search: async (keyword, options) => {
    const db = await getDatabase();
    return db.searchEntries(keyword, options);
  },

  importEntries: async (jsonText) => {
    const { incrementalImport } = await import('@/utils/import');
    const result = await incrementalImport(jsonText);
    // 刷新本地缓存
    await get().loadEntries();
    return result;
  },
}));
