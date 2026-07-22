/**
 * 设置页面
 * AI 配置 + 数据管理器 + 数据导入 + 随机浏览配置
 */
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEntryStore } from '@/stores/entryStore';
import { BottomNav } from '@/components/BottomNav';
import { incrementalImport } from '@/utils/import';
import { DEFAULT_PROMPTS } from '@/types';
import type { PromptConfig } from '@/types';
import type { ImportResult } from '@/features/datamanager/types';
import './SettingsPage.css';

/** 提示词标签 */
const PROMPT_LABELS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '标签建议提示词',
  relationSuggestion: '关联建议提示词',
  dialogueContext: '对话上下文提示词',
  autoLink: '自动连线提示词',
};

/** 提示词提示 */
const PROMPT_HINTS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '可用变量: {content} {context}',
  relationSuggestion: '可用变量: {contentA} {contentB}',
  dialogueContext: '可用变量: {longTermMemory} {recentEntries} {currentEntry}',
  autoLink: '可用变量: {newEntry} {candidates}',
};

/* SVG Icon Components */
const IconBot = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
  </svg>
);

const IconDatabase = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
  </svg>
);

const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const IconShuffle = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c1.3 0 2.6-.7 3.3-1.8l.5-.8" /><path d="m18 14 4 4-4 4" />
  </svg>
);

const IconChevronUp = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);
  const updateRandomConfig = useSettingsStore(state => state.updateRandomConfig);
  const entries = useEntryStore(state => state.entries);
  const [showAIConfig, setShowAIConfig] = useState(false);
  const [showRandomConfig, setShowRandomConfig] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 处理文件选择 - 增量导入
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const result = await incrementalImport(text);
      setImportResult(result);
      // 刷新条目列表
      window.location.reload();
    } catch (err) {
      setImportResult({
        total: 0,
        imported: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : '导入失败'],
      });
    } finally {
      setImporting(false);
      // 清空 input 以便重复选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="settings-page">
      <main className="page-content">
        {/* AI 配置入口 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowAIConfig(!showAIConfig)}
          >
            <div className="item-left">
              <span className="item-icon"><IconBot /></span>
              <div>
                <span className="item-title">AI 配置</span>
                <span className="item-desc">
                  {settings.ai.apiKey ? '已配置' : '未配置'}
                </span>
              </div>
            </div>
            <span className="item-arrow">{showAIConfig ? <IconChevronUp /> : <IconChevronDown />}</span>
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
                {settings.ai.isDeepSeek ? (
                  <select
                    className="form-input glass"
                    value={settings.ai.model}
                    onChange={e => updateAIConfig({ model: e.target.value })}
                  >
                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input glass"
                    value={settings.ai.model}
                    onChange={e => updateAIConfig({ model: e.target.value })}
                    placeholder="gpt-4o-mini"
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.ai.isDeepSeek}
                    onChange={e => {
                      if (e.target.checked) {
                        updateAIConfig({
                          isDeepSeek: true,
                          baseURL: 'https://api.deepseek.com',
                          model: 'deepseek-v4-flash',
                        });
                      } else {
                        updateAIConfig({
                          isDeepSeek: false,
                          baseURL: 'https://api.openai.com/v1',
                          model: 'gpt-4o-mini',
                        });
                      }
                    }}
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

              {/* 智能标签配置 */}
              <div className="settings-subsection-title">智能标签</div>
              <div className="form-group">
                <label className="form-label">最近使用标签数量</label>
                <input
                  type="number"
                  className="form-input glass"
                  value={settings.ai.smartTag?.recentTagCount ?? 50}
                  onChange={e => updateAIConfig({
                    smartTag: {
                      ...settings.ai.smartTag,
                      recentTagCount: parseInt(e.target.value) || 50,
                      tagSuggestPrompt: settings.ai.smartTag?.tagSuggestPrompt || '',
                    },
                  })}
                  min="5"
                  max="200"
                  step="5"
                />
                <span className="form-hint">标签建议时发送给 AI 的最近标签数（越多越准，但耗 token）</span>
              </div>
              <div className="form-group">
                <label className="form-label">标签建议提示词</label>
                <textarea
                  className="form-input glass"
                  style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  value={settings.ai.smartTag?.tagSuggestPrompt ?? ''}
                  onChange={e => updateAIConfig({
                    smartTag: {
                      recentTagCount: settings.ai.smartTag?.recentTagCount ?? 50,
                      tagSuggestPrompt: e.target.value,
                    },
                  })}
                  placeholder="可用变量: {recentTags} {content}"
                  rows={6}
                />
                <span className="form-hint">变量: {`{recentTags}`} = 最近标签列表, {`{content}`} = 当前条目内容</span>
              </div>

              {/* 提示词配置 */}
              <div className="settings-subsection-title">提示词配置</div>
              {(['tagSuggestion', 'relationSuggestion', 'dialogueContext', 'autoLink'] as const).map(key => (
                <div key={key} className="form-group">
                  <label className="form-label">{PROMPT_LABELS[key]}</label>
                  <textarea
                    className="form-input glass"
                    style={{ minHeight: '80px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                    value={settings.ai.prompts[key]}
                    onChange={e => updateAIConfig({
                      prompts: {
                        ...settings.ai.prompts,
                        [key]: e.target.value,
                      },
                    })}
                    rows={4}
                  />
                  <span className="form-hint">{PROMPT_HINTS[key]}</span>
                </div>
              ))}
              {/* 重置提示词按钮 */}
              <div className="form-group">
                <button
                  className="form-reset-btn"
                  onClick={() => {
                    if (confirm('确定重置所有提示词为默认值？')) {
                      updateAIConfig({ prompts: DEFAULT_PROMPTS });
                    }
                  }}
                >
                  重置提示词为默认
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 随机浏览配置 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => setShowRandomConfig(!showRandomConfig)}
          >
            <div className="item-left">
              <span className="item-icon"><IconShuffle /></span>
              <div>
                <span className="item-title">随机浏览</span>
                <span className="item-desc">每屏 {settings.random?.cardsPerPage ?? 7} 张卡片</span>
              </div>
            </div>
            <span className="item-arrow">{showRandomConfig ? <IconChevronUp /> : <IconChevronDown />}</span>
          </button>

          {showRandomConfig && (
            <div className="settings-detail glass">
              <div className="form-group">
                <label className="form-label">每屏随机卡片数</label>
                <input
                  type="number"
                  className="form-input glass"
                  value={settings.random?.cardsPerPage ?? 7}
                  onChange={e => updateRandomConfig({
                    cardsPerPage: Math.max(1, Math.min(50, parseInt(e.target.value) || 7)),
                  })}
                  min="1"
                  max="50"
                  step="1"
                />
                <span className="form-hint">推荐 5-10 张，根据屏幕大小调整</span>
              </div>
            </div>
          )}
        </section>

        {/* 数据管理器 - 合并标签/组/数据存储 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/data-manager/tags')}
          >
            <div className="item-left">
              <span className="item-icon"><IconDatabase /></span>
              <div>
                <span className="item-title">数据管理器</span>
                <span className="item-desc">标签 · 组 · 数据存储综合管理</span>
              </div>
            </div>
            <span className="item-arrow"><IconChevronRight /></span>
          </button>
        </section>

        {/* 数据导入 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <div className="item-left">
              <span className="item-icon"><IconUpload /></span>
              <div>
                <span className="item-title">数据导入</span>
                <span className="item-desc">
                  {importing ? '导入中...' : '选择 JSON 文件增量导入'}
                </span>
              </div>
            </div>
            <span className="item-arrow"><IconChevronRight /></span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {importResult && (
            <div className="settings-detail glass">
              <div className="import-result">
                <p>导入完成</p>
                <p>新增: {importResult.imported} 条 · 跳过: {importResult.skipped} 条</p>
                {importResult.errors.length > 0 && (
                  <p className="import-errors">
                    错误: {importResult.errors.join(', ')}
                  </p>
                )}
                <button
                  className="import-close-btn"
                  onClick={() => setImportResult(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 数据导出 */}
        <section className="settings-section">
          <button
            className="settings-item glass"
            onClick={() => navigate('/export')}
          >
            <div className="item-left">
              <span className="item-icon"><IconDatabase /></span>
              <div>
                <span className="item-title">数据导出</span>
                <span className="item-desc">{entries.length} 条记录可导出</span>
              </div>
            </div>
            <span className="item-arrow"><IconChevronRight /></span>
          </button>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
