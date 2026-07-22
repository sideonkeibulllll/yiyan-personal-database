# Task: Settings Persistence + Default AI Config Update

## Objective
1. **Task 1**: Persist settings to SQLite database (native) so Android app reinstall won't lose settings. Backward-compatible with localStorage.
2. **Task 2**: Change default AI config to DeepSeek and add model dropdown selector in settings UI.

## Key Changes

### Task 1: Settings persistence across app reinstalls

**`src/services/types.ts`**
- Added `import type { Settings }` to imports
- Added `getSettings(): Promise<Settings | null>` and `saveSettings(settings: Settings): Promise<void>` to `IDatabaseService` interface

**`src/services/nativeDatabase.ts`**
- Added `Settings` to type imports
- Added `settings` table schema in `createTables()`: single-row table with `id INTEGER PRIMARY KEY DEFAULT 1`, `data TEXT`, `updated_at INTEGER`
- Implemented `getSettings()`: reads JSON string from settings table, parses to Settings object
- Implemented `saveSettings()`: serializes Settings to JSON, uses `INSERT OR REPLACE` to upsert

**`src/services/webDatabase.ts`**
- Added `Settings` to type imports
- Implemented `getSettings()`: reads from localStorage key `yiyan_settings`
- Implemented `saveSettings()`: writes to localStorage key `yiyan_settings`

**`src/stores/settingsStore.ts`** (full rewrite)
- Added `isLoaded: boolean` state and `loadSettings: () => Promise<void>` method
- `loadSettings()`: prioritizes database load, falls back to localStorage; merges with DEFAULT_SETTINGS for forward compatibility
- All mutator methods (`setSettings`, `updateAIConfig`, `updateContextConfig`, `updatePushConfig`, `resetSettings`) now write to **both** localStorage and database
- Database writes are fire-and-forget (wrapped in try/catch) to avoid failures if DB unavailable

**`src/app/App.tsx`**
- Imports `useSettingsStore` and calls `loadSettings()` during app initialization alongside `loadEntries()` and `loadTags()`

### Task 2: Default AI config + UI changes

**`src/types/index.ts`** — `DEFAULT_SETTINGS.ai`:
- `model`: `'gpt-4o-mini'` → `'deepseek-v4-flash'`
- `baseURL`: `'https://api.openai.com/v1'` → `'https://api.deepseek.com'`
- `isDeepSeek`: `false` → `true`

**`src/features/settings/SettingsPage.tsx`**:
- Model field: when `isDeepSeek === true`, renders `<select>` dropdown with options `deepseek-v4-flash` and `deepseek-v4-pro`; when `false`, renders free-text `<input>`
- DeepSeek checkbox `onChange`: checking sets `isDeepSeek: true`, `baseURL: 'https://api.deepseek.com'`, `model: 'deepseek-v4-flash'`; unchecking sets `isDeepSeek: false`, `baseURL: 'https://api.openai.com/v1'`, `model: 'gpt-4o-mini'`

**`src/features/settings/SettingsPage.css`**:
- Added `select.form-input` styles: custom dropdown arrow, appearance reset, option background theming

## Verification
- `npx tsc --noEmit` — **passed** (0 errors)
- `npm run build` — **passed** (93 modules transformed, built in 1.62s)
- No git commits made (as instructed)
