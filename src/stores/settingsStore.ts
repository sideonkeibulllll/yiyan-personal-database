/**
 * 设置状态管理
 */
import { create } from 'zustand';
import type { Settings } from '@/types';
import { DEFAULT_SETTINGS, migrateAIConfig } from '@/types';
import { getDatabase } from '@/services/database';

interface SettingsStore {
  settings: Settings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setSettings: (settings: Settings) => void;
  updateAIConfig: (config: Partial<Settings['ai']>) => void;
  updateContextConfig: (config: Partial<Settings['context']>) => void;
  updatePushConfig: (config: Partial<Settings['push']>) => void;
  updateRandomConfig: (config: Partial<Settings['random']>) => void;
  updateTodoConfig: (config: Partial<Settings['todo']>) => void;
  resetSettings: () => void;
}

const STORAGE_KEY = 'yiyan_settings';

/**
 * 深合并 ai 段（浅合并会让 ai 整个被替换，导致新增的 providers 丢失），
 * 并对 AI 配置跑一次迁移，兼容老版本扁平的 apiKey/baseURL/model 结构。
 *
 * 注意：合并时**不能**把 DEFAULT_SETTINGS.ai.providers 带入，
 * 否则老配置会被误判为「已有 providers」而丢失 apiKey/model。
 */
function normalizeSettings(raw: Partial<Settings>): Settings {
  const rawAi: Partial<Settings['ai']> = raw.ai || {};
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...rawAi,
      prompts: {
        ...DEFAULT_SETTINGS.ai.prompts,
        ...(rawAi.prompts || {}),
      },
      deepSeekOptions: {
        ...DEFAULT_SETTINGS.ai.deepSeekOptions,
        ...(rawAi.deepSeekOptions || {}),
      },
      // 只有原始数据真的带了 providers 才保留，否则交由 migrateAIConfig 从扁平字段推导
      providers: rawAi.providers,
    },
  };
  merged.ai = migrateAIConfig(merged.ai);
  return merged;
}

function loadFromLocalStorage(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeSettings(JSON.parse(stored));
    }
  } catch {
    // ignore
  }
  return normalizeSettings({});
}

function saveToLocalStorage(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

async function saveToDatabase(settings: Settings): Promise<void> {
  try {
    const db = await getDatabase();
    await db.saveSettings(settings);
  } catch {
    // ignore
  }
}

async function loadFromDatabase(): Promise<Settings | null> {
  try {
    const db = await getDatabase();
    return await db.getSettings();
  } catch {
    return null;
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadFromLocalStorage(),
  isLoaded: false,

  loadSettings: async () => {
    const dbSettings = await loadFromDatabase();
    if (dbSettings) {
      const merged = normalizeSettings(dbSettings);
      saveToLocalStorage(merged);
      set({ settings: merged, isLoaded: true });
      return;
    }
    set({ isLoaded: true });
  },

  setSettings: (settings) => {
    // 云备份恢复可能带回老结构，统一走一次归一化
    const normalized = normalizeSettings(settings);
    saveToLocalStorage(normalized);
    saveToDatabase(normalized);
    set({ settings: normalized });
  },

  updateAIConfig: (config) => {
    const settings = {
      ...get().settings,
      ai: { ...get().settings.ai, ...config },
    };
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
  },

  updateContextConfig: (config) => {
    const settings = {
      ...get().settings,
      context: { ...get().settings.context, ...config },
    };
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
  },

  updatePushConfig: (config) => {
    const settings = {
      ...get().settings,
      push: { ...get().settings.push, ...config },
    };
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
  },

  updateRandomConfig: (config) => {
    const settings = {
      ...get().settings,
      random: { ...get().settings.random, ...config },
    };
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
  },

  updateTodoConfig: (config) => {
    const settings = {
      ...get().settings,
      todo: { ...get().settings.todo, ...config },
    };
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
  },

  resetSettings: () => {
    saveToLocalStorage(DEFAULT_SETTINGS);
    saveToDatabase(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },
}));