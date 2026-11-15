/**
 * 主入口文件
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { setAICredentialUpdateHandler } from './services/ai';
import { useSettingsStore } from './stores/settingsStore';
import './styles/theme.css';

/**
 * TRAE 的 refresh_token 每轮换一次就作废旧的，所以续期后必须立刻写回设置。
 * 这里注册一次全局钩子，AI 服务在拿到新凭据时回调它。
 */
setAICredentialUpdateHandler((providerId, apiKey) => {
  const store = useSettingsStore.getState();
  const ai = store.settings.ai;
  const providers = ai.providers;
  if (!providers) return;
  const entry = providers[providerId];
  if (!entry) return;

  store.updateAIConfig({
    providers: { ...providers, [providerId]: { ...entry, apiKey } },
    // 扁平字段只在它指向同一个提供商时同步，避免覆盖用户当前选择
    ...(ai.provider === providerId ? { apiKey } : {}),
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
