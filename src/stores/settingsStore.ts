/**
 * 设置状态管理
 */
import { create } from 'zustand';
import type { Settings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { getDatabase } from '@/services/database';

interface SettingsStore {
  settings: Settings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  setSettings: (settings: Settings) => void;
  updateAIConfig: (config: Partial<Settings['ai']>) => void;
  updateContextConfig: (config: Partial<Settings['context']>) => void;
  updatePushConfig: (config: Partial<Settings['push']>) => void;
  resetSettings: () => void;
}

const STORAGE_KEY = 'yiyan_settings';

function loadFromLocalStorage(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SETTINGS;
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
      const merged = { ...DEFAULT_SETTINGS, ...dbSettings };
      saveToLocalStorage(merged);
      set({ settings: merged, isLoaded: true });
      return;
    }
    set({ isLoaded: true });
  },

  setSettings: (settings) => {
    saveToLocalStorage(settings);
    saveToDatabase(settings);
    set({ settings });
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

  resetSettings: () => {
    saveToLocalStorage(DEFAULT_SETTINGS);
    saveToDatabase(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
  },
}));