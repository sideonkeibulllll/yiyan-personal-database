/**
 * 连线展示页面 v2
 * 显示与某条目相关的所有连线
 * v2 变更：
 * - b.4: 底部添加「连线建议」按钮，发送最近100条给 AI
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { ai } from '@/services/ai';
import { BottomNav } from '@/components/BottomNav';
import type { Entry, Link } from '@/types';
import './LinkPage.css';

/* SVG Icon Components */
const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
  </svg>
);

const IconLink = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const IconBot = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8M16 8V4h-4" /><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M9 15h.01M15 15h.01" /><path d="M9 19h6" />
  </svg>
);

const IconStar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export function LinkPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();
  const settings = useSettingsStore(state => state.settings);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [links, setLinks] = useState<(Link & { targetEntry: Entry })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddLink, setShowAddLink] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<Entry[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<Entry | null>(null);
  const [linkDescription, setLinkDescription] = useState('');
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  // b.4: 连线建议状态
  const [connectionSuggesting, setConnectionSuggesting] = useState(false);
  const [connectionSuggestions, setConnectionSuggestions] = useState<{ sourceId: string; targetId: string; description: string }[]>([]);
  const [recentEntries, setRecentEntries] = useState<Entry[]>([]);

  // 加载连线数据
  useEffect(() => {
    const loadLinks = async () => {
      if (!entryId) return;

      try {
        const db = await getDatabase();
        const entryData = await db.getEntryById(entryId);
        setEntry(entryData);

        if (entryData) {
          const linkData = await db.getLinksByEntryId(entryId);
          const linksWithEntries = await Promise.all(
            linkData.map(async link => {
              const targetId = link.sourceId === entryId ? link.targetId : link.sourceId;
              const targetEntry = await db.getEntryById(targetId);
              return { ...link, targetEntry: targetEntry! };
            })
          );
          setLinks(linksWithEntries.filter(l => l.targetEntry));
        }
      } catch (error) {
        console.error('加载连线失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadLinks();
  }, [entryId]);

  // 搜索条目作为连线目标
  useEffect(() => {
    if (!searchKeyword.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const db = await getDatabase();
      const results = await db.searchEntries(searchKeyword.trim());
      setSearchResults(results.filter(e => e.id !== entryId).slice(0, 20));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchKeyword, entryId]);

  // AI 建议关联描述
  const handleAISuggest = useCallback(async () => {
    if (!entry || !selectedTarget) return;
    setAiSuggesting(true);
    try {
      ai.setConfig(settings.ai);
      const desc = await ai.suggestRelation(
        entry.content,
        selectedTarget.content,
        settings.ai.prompts,
      );
      setAiDescription(desc);
    } catch (e) {
      console.error('AI 关联建议失败:', e);
      alert('AI 建议失败: ' + (e as Error).message);
    } finally {
      setAiSuggesting(false);
    }
  }, [entry, selectedTarget, settings.ai]);

  // b.4: 连线建议 — 发送最近100条给 AI
  const handleConnectionSuggestion = useCallback(async () => {
    if (!settings.ai.apiKey) {
      alert('请先在设置页面配置 AI API Key');
      return;
    }
    setConnectionSuggesting(true);
    try {
      const db = await getDatabase();
      const count = settings.ai.connectionSuggestion?.recentEntryCount ?? 100;
      const allEntries = await db.getAllEntries();
      const recent = allEntries
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, count);
      setRecentEntries(recent);

      // 构建提示词
      const promptTemplate = settings.ai.connectionSuggestion?.connectionSuggestPrompt ||
        settings.ai.prompts.connectionSuggestion ||
        '请分析以下条目，找出可能有关联的条目对。\n返回格式：ID1 → ID2: 关联描述\n\n最近条目列表：\n{entries}';
      
      const entriesText = recent.map(e => `[${e.id}] ${e.content.slice(0, 100)}`).join('\n');
      const prompt = promptTemplate.replace('{entries}', entriesText);

      ai.setConfig(settings.ai);
      const result = await ai.chat({
        systemPrompt: '你是一个知识关联发现助手。',
        userMessage: prompt,
      });

      // 解析返回结果，格式：ID1 → ID2: 关联描述
      const suggestions: { sourceId: string; targetId: string; description: string }[] = [];
      const lines = result.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/\[?([^\]]+)\]?\s*[→>\-]\s*\[?([^\]:]+)\]?\s*:?\s*(.*)/);
        if (match) {
          const [, id1, id2, desc] = match;
          suggestions.push({
            sourceId: id1.trim(),
            targetId: id2.trim(),
            description: (desc || '').trim(),
          });
        }
      }
      setConnectionSuggestions(suggestions);
    } catch (e) {
      console.error('连线建议失败:', e);
      alert('连线建议失败: ' + (e as Error).message);
    } finally {
      setConnectionSuggesting(false);
    }
  }, [settings.ai]);

  // b.4: 应用连线建议
  const handleApplySuggestion = useCallback(async (sourceId: string, targetId: string, description: string) => {
    try {
      const db = await getDatabase();
      // 检查是否已存在
      const existingLinks = await db.getLinksByEntryId(sourceId);
      const exists = existingLinks.some(l => l.sourceId === targetId || l.targetId === targetId);
      if (!exists) {
        await db.createLink(sourceId, targetId, description);
        // 重新加载连线
        if (entryId) {
          const linkData = await db.getLinksByEntryId(entryId);
          const linksWithEntries = await Promise.all(
            linkData.map(async link => {
              const targetId = link.sourceId === entryId ? link.targetId : link.sourceId;
              const targetEntry = await db.getEntryById(targetId);
              return { ...link, targetEntry: targetEntry! };
            })
          );
          setLinks(linksWithEntries.filter(l => l.targetEntry));
        }
      }
    } catch (e) {
      console.error('应用连线建议失败:', e);
    }
  }, [entryId]);

  // 保存连线
  const handleSaveLink = useCallback(async () => {
    if (!entryId || !selectedTarget) return;
    setIsSavingLink(true);
    try {
      const db = await getDatabase();
      await db.createLink(
        entryId,
        selectedTarget.id,
        linkDescription.trim() || undefined,
      );
      setShowAddLink(false);
      setSelectedTarget(null);
      setSearchKeyword('');
      setLinkDescription('');
      setAiDescription('');
      // 重新加载
      const linkData = await db.getLinksByEntryId(entryId);
      const linksWithEntries = await Promise.all(
        linkData.map(async link => {
          const targetId = link.sourceId === entryId ? link.targetId : link.sourceId;
          const targetEntry = await db.getEntryById(targetId);
          return { ...link, targetEntry: targetEntry! };
        })
      );
      setLinks(linksWithEntries.filter(l => l.targetEntry));
    } catch (e) {
      alert('保存连线失败: ' + (e as Error).message);
    } finally {
      setIsSavingLink(false);
    }
  }, [entryId, selectedTarget, linkDescription]);

  // 跳转到目标条目
  const handleGoToEntry = useCallback((targetId: string) => {
    // 在当前页面显示目标条目详情
    navigate(`/links/${targetId}`);
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="link-page">
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="link-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}><IconArrowLeft /></button>
        <h1 className="page-title">连线</h1>
        <button className="add-link-btn" onClick={() => setShowAddLink(true)}><IconPlus /></button>
      </header>

      <main className="page-content">
        {/* 当前条目 */}
        {entry && (
          <div className="current-entry glass">
            <h3 className="section-title">当前条目</h3>
            <p className="entry-content">{entry.content}</p>
          </div>
        )}

        {/* 连线列表 */}
        <div className="links-container">
          <h3 className="section-title">相关条目 ({links.length})</h3>

          {links.length > 0 ? (
            links.map(link => (
              <div
                key={link.id}
                className="link-item glass"
                onClick={() => handleGoToEntry(link.targetEntry.id)}
              >
                <div className="link-content">
                  {link.targetEntry.content}
                </div>
                {link.description && (
                  <div className="link-description">
                    <span className="link-icon"><IconLink /></span>
                    <span>{link.description}</span>
                  </div>
                )}
                <div className="link-meta">
                  {link.targetEntry.isStarred && <span className="meta-icon"><IconStar /></span>}
                  <span className="meta-time">
                    {new Date(link.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-links">
              <span className="empty-icon"><IconLink /></span>
              <p className="empty-text">暂无连线</p>
              <p className="empty-hint">在随机浏览或搜索中可以为条目建立连线</p>
            </div>
          )}
        </div>

        {/* b.4: 连线建议按钮 + 建议结果 */}
        <div className="connection-suggestion-section">
          <button
            className="connection-suggest-btn glass"
            onClick={handleConnectionSuggestion}
            disabled={connectionSuggesting || !settings.ai.apiKey}
          >
            <IconBot />
            <span>{connectionSuggesting ? 'AI 分析中...' : '连线建议'}</span>
          </button>

          {connectionSuggestions.length > 0 && (
            <div className="connection-suggestions">
              <div className="suggestions-label">AI 发现的潜在关联：</div>
              {connectionSuggestions.map((s, i) => {
                const sourceEntry = recentEntries.find(e => e.id === s.sourceId);
                const targetEntry = recentEntries.find(e => e.id === s.targetId);
                if (!sourceEntry || !targetEntry) return null;
                return (
                  <div key={i} className="suggestion-item glass">
                    <div className="suggestion-entries">
                      <span className="suggestion-entry">{sourceEntry.content.slice(0, 60)}</span>
                      <span className="suggestion-arrow">→</span>
                      <span className="suggestion-entry">{targetEntry.content.slice(0, 60)}</span>
                    </div>
                    <div className="suggestion-desc">{s.description}</div>
                    <button
                      className="suggestion-apply-btn"
                      onClick={() => handleApplySuggestion(s.sourceId, s.targetId, s.description)}
                    >
                      创建连线
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <BottomNav />

      {/* 添加连线弹层 */}
      {showAddLink && (
        <div className="add-link-overlay" onClick={() => setShowAddLink(false)}>
          <div className="add-link-panel glass" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>添加连线</h3>
              <button onClick={() => setShowAddLink(false)}>×</button>
            </div>

            {!selectedTarget ? (
              <>
                <input
                  type="text"
                  className="link-search-input"
                  placeholder="搜索条目..."
                  value={searchKeyword}
                  onChange={e => setSearchKeyword(e.target.value)}
                  autoFocus
                />
                <div className="link-search-results">
                  {searchResults.map(e => (
                    <button
                      key={e.id}
                      className="link-search-item"
                      onClick={() => setSelectedTarget(e)}
                    >
                      {e.content.slice(0, 80)}{e.content.length > 80 ? '...' : ''}
                    </button>
                  ))}
                  {searchKeyword && searchResults.length === 0 && (
                    <p className="empty-search">未找到相关条目</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="link-target-preview">
                  <span className="target-label">目标：</span>
                  <span className="target-content">{selectedTarget.content.slice(0, 100)}</span>
                </div>
                <textarea
                  className="link-desc-input"
                  placeholder="连线描述（可选）"
                  value={linkDescription}
                  onChange={e => setLinkDescription(e.target.value)}
                  rows={3}
                />
                {aiDescription && (
                  <div className="ai-desc-suggestion">
                    <span className="ai-label">AI 建议：</span>
                    <p>{aiDescription}</p>
                    <button onClick={() => setLinkDescription(aiDescription)}>采用</button>
                  </div>
                )}
                <div className="link-actions">
                  <button
                    className="link-ai-btn"
                    onClick={handleAISuggest}
                    disabled={aiSuggesting || !settings.ai.apiKey}
                  >
                    <IconBot /> {aiSuggesting ? 'AI 思考中...' : 'AI 建议描述'}
                  </button>
                  <button
                    className="link-save-btn"
                    onClick={handleSaveLink}
                    disabled={isSavingLink}
                  >
                    {isSavingLink ? '保存中...' : '保存连线'}
                  </button>
                </div>
                <button
                  className="link-back-btn"
                  onClick={() => { setSelectedTarget(null); setAiDescription(''); }}
                >
                  ← 返回选择
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
