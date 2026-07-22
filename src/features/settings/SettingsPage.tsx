/**
 * 设置页面
 * AI 配置 + 数据管理 + 标签管理 + 关于
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEntryStore } from '@/stores/entryStore';
import { BottomNav } from '@/components/BottomNav';
import './SettingsPage.css';

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const entries = useEntryStore(state => state.entries);
  const [showAIConfig, setShowAIConfig] = useState(false);

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="page-title">设置</h1>
      </header>

      <main className="page-content">
        {/* AI 配置入口 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowAIConfig(!showAIConfig)}
          >
            <div className="item-left">
              <span className="item-icon">🤖</span>
              <div>
                <span className="item-title">AI 配置</span>
                <span className="item-desc">
                  {settings.ai.apiKey ? '已配置' : '未配置'}
                </span>
              </div>
            </div>
            <span className="item-arrow">{showAIConfig ? '▲' : '▼'}</span>
          </button>

          {showAIConfig && (
            <div className="settings-detail glass">
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input
                  type="password"
                  className="form-input glass"
                  value={settings.ai.apiKey}
                  onChange={e => updateAIConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">API 地址</label>
                <input
                  type="text"
                  className="form-input glass"
                  value={settings.ai.baseURL}
                  onChange={e => updateAIConfig({ baseURL: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">模型</label>
                <input
                  type="text"
                  className="form-input glass"
                  value={settings.ai.model}
                  onChange={e => updateAIConfig({ model: e.target.value })}
                  placeholder="gpt-4o-mini"
                />
              </div>

              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.ai.isDeepSeek}
                    onChange={e => updateAIConfig({ isDeepSeek: e.target.checked })}
                  />
                  <span>使用 DeepSeek 模型</span>
                </label>
              </div>

              {settings.ai.isDeepSeek && (
                <>
                  <div className="form-group">
                    <label className="form-label">Temperature</label>
                    <input
                      type="number"
                      className="form-input glass"
                      value={settings.ai.deepSeekOptions.temperature}
                      onChange={e => updateAIConfig({
                        deepSeekOptions: {
                          ...settings.ai.deepSeekOptions,
                          temperature: parseFloat(e.target.value) || 0.7,
                        },
                      })}
                      min="0"
                      max="2"
                      step="0.1"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Tokens</label>
                    <input
                      type="number"
                      className="form-input glass"
                      value={settings.ai.deepSeekOptions.maxTokens}
                      onChange={e => updateAIConfig({
                        deepSeekOptions: {
                          ...settings.ai.deepSeekOptions,
                          maxTokens: parseInt(e.target.value) || 2000,
                        },
                      })}
                      min="100"
                      max="32000"
                      step="100"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* 标签管理 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/tags')}
          >
            <div className="item-left">
              <span className="item-icon">🏷️</span>
              <div>
                <span className="item-title">标签管理</span>
                <span className="item-desc">合并、重命名、删除标签</span>
              </div>
            </div>
            <span className="item-arrow">▶</span>
          </button>
        </section>

        {/* 数据导出 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/export')}
          >
            <div className="item-left">
              <span className="item-icon">💾</span>
              <div>
                <span className="item-title">数据导出</span>
                <span className="item-desc">{entries.length} 条记录可导出</span>
              </div>
            </div>
            <span className="item-arrow">▶</span>
          </button>
        </section>

        {/* 数据本地化 */}
        <section className="settings-section">
          <div className="settings-item glass">
            <div className="item-left">
              <span className="item-icon">📱</span>
              <div>
                <span className="item-title">数据存储</span>
                <span className="item-desc">本地 SQLite 数据库</span>
              </div>
            </div>
          </div>
        </section>

        {/* 关于 */}
        <section className="settings-section">
          <div className="settings-item glass">
            <div className="item-left">
              <span className="item-icon">ℹ️</span>
              <div>
                <span className="item-title">关于</span>
                <span className="item-desc">记忆库 v0.1.0</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
