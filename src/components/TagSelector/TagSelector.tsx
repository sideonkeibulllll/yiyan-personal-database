/**
 * 标签选择栏组件
 * 复用组件，支持搜索和多选，支持AI辅助生成
 */
import { useState, useCallback, useEffect } from 'react';
import { useTagStore } from '@/stores/tagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ai } from '@/services/ai';
import { getDatabase } from '@/services/database';
import type { Tag } from '@/types';
import './TagSelector.css';

interface TagSelectorProps {
  selectedTagIds: string[];
  onSelectionChange: (tagIds: string[]) => void;
  onClose?: () => void;
  showAISuggestion?: boolean;
  onAISuggest?: () => void;
  /** 当前条目内容（用于AI标签建议） */
  entryContent?: string;
  /** 当前条目ID（用于AI标签建议） */
  entryId?: string;
}

/** Search icon */
const SearchSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
  </svg>
);

/** X (close) icon */
const XCloseSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Plus icon */
const PlusSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Bot icon */
const BotSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8M16 8V4h-4" /><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M9 15h.01M15 15h.01" /><path d="M9 19h6" />
  </svg>
);

export function TagSelector({
  selectedTagIds,
  onSelectionChange,
  onClose,
  showAISuggestion = false,
  onAISuggest,
  entryContent,
  entryId,
}: TagSelectorProps) {
  const tags = useTagStore(state => state.tags);
  const addTag = useTagStore(state => state.addTag);
  const settings = useSettingsStore(state => state.settings);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  // AI 标签建议状态
  const [aiState, setAiState] = useState<'idle' | 'confirm' | 'loading' | 'done'>('idle');
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);

  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const toggleTag = useCallback((tagId: string) => {
    const newSelection = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    onSelectionChange(newSelection);
  }, [selectedTagIds, onSelectionChange]);

  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;
    const tag = await addTag(newTagName.trim());
    toggleTag(tag.id);
    setNewTagName('');
    setIsCreating(false);
  }, [newTagName, addTag, toggleTag]);

  const updateSelection = useCallback((tagNames: string[]) => {
    const tagIds = tagNames
      .map(name => tags.find(t => t.name === name)?.id)
      .filter((id): id is string => id !== undefined);
    onSelectionChange(tagIds);
  }, [tags, onSelectionChange]);

  /**
   * 获取最近使用的标签名列表
   * 根据标签的创建时间降序，取前 N 个（N 由设置项配置）
   */
  const getRecentTagNames = useCallback(async (): Promise<string[]> => {
    try {
      const db = await getDatabase();
      const allTags = await db.getAllTags();
      const count = settings.ai.smartTag?.recentTagCount ?? 50;
      // 按创建时间降序取前 N 个
      const sorted = [...allTags].sort((a, b) => b.createdAt - a.createdAt);
      return sorted.slice(0, count).map(t => t.name);
    } catch {
      return [];
    }
  }, [settings.ai.smartTag?.recentTagCount]);

  /**
   * 点击"标签建议"按钮：进入确认状态
   */
  const handleAISuggestClick = useCallback(() => {
    setAiState('confirm');
  }, []);

  /**
   * 确认执行 AI 标签建议
   */
  const handleAISuggestConfirm = useCallback(async () => {
    if (!entryContent) {
      setAiState('idle');
      return;
    }
    setAiState('loading');
    try {
      ai.setConfig(settings.ai);
      const recentTags = await getRecentTagNames();
      const customPrompt = settings.ai.smartTag?.tagSuggestPrompt;
      const suggested = await ai.suggestTagsWithRecent(entryContent, recentTags, customPrompt);
      // b.1: 标签建议改为 1-6 个
      const maxTags = settings.ai.smartTag?.maxTags ?? 6;
      const minTags = settings.ai.smartTag?.minTags ?? 1;
      const filtered = suggested.filter(tag => tag.length > 0 && tag.length <= 12).slice(0, maxTags);
      setAiSuggestedTags(filtered.length >= minTags ? filtered : filtered);
      setAiState('done');
    } catch (err) {
      console.error('AI 标签建议失败:', err);
      alert('AI 标签建议失败: ' + (err as Error).message);
      setAiState('idle');
    }
  }, [entryContent, settings.ai, getRecentTagNames]);

  /**
   * 应用推荐的标签（点某个推荐标签→切换选中状态）
   */
  const handleToggleSuggestedTag = useCallback(async (tagName: string) => {
    // 查找已有标签
    let tag = tags.find(t => t.name === tagName);
    // 不存在则创建
    if (!tag) {
      tag = await addTag(tagName);
    }
    // 切换选中状态
    const newSelection = selectedTagIds.includes(tag.id)
      ? selectedTagIds.filter(id => id !== tag.id)
      : [...selectedTagIds, tag.id];
    onSelectionChange(newSelection);
  }, [tags, addTag, selectedTagIds, onSelectionChange]);

  /**
   * 一键应用所有推荐标签
   */
  const handleApplyAllSuggested = useCallback(async () => {
    const newIds: string[] = [...selectedTagIds];
    for (const tagName of aiSuggestedTags) {
      let tag = tags.find(t => t.name === tagName);
      if (!tag) {
        tag = await addTag(tagName);
      }
      if (!newIds.includes(tag.id)) {
        newIds.push(tag.id);
      }
    }
    onSelectionChange(newIds);
    setAiState('idle');
    setAiSuggestedTags([]);
  }, [aiSuggestedTags, tags, addTag, selectedTagIds, onSelectionChange]);

  return (
    <div className="tag-selector">
      <div className="selector-header">
        <h3 className="selector-title">选择标签</h3>
        {onClose && (
          <button className="selector-close" onClick={onClose}><XCloseSvg /></button>
        )}
      </div>
      <div className="selector-search glass">
        <span className="search-icon"><SearchSvg /></span>
        <input
          type="text"
          className="search-input"
          placeholder="搜索标签..."
          value={searchKeyword}
          onChange={e => setSearchKeyword(e.target.value)}
        />
      </div>
      {showAISuggestion && onAISuggest ? (
        <button className="ai-suggest-btn glass" onClick={onAISuggest}>
          <span className="btn-icon"><BotSvg /></span>
          <span>AI 辅助建议</span>
        </button>
      ) : entryContent ? (
        <div className="ai-tag-suggest-section">
          {aiState === 'idle' && (
            <button className="ai-suggest-btn glass" onClick={handleAISuggestClick}>
              <span className="btn-icon"><BotSvg /></span>
              <span>标签建议</span>
            </button>
          )}
          {aiState === 'confirm' && (
            <div className="ai-suggest-confirm">
              <span className="ai-confirm-text">将发送内容到 AI 获取标签建议</span>
              <div className="ai-confirm-actions">
                <button className="ai-confirm-btn cancel" onClick={() => setAiState('idle')}>取消</button>
                <button className="ai-confirm-btn ok" onClick={handleAISuggestConfirm}>确认</button>
              </div>
            </div>
          )}
          {aiState === 'loading' && (
            <div className="ai-suggest-loading">
              <span className="loading-dots"><span className="dot" /><span className="dot" /><span className="dot" /></span>
              <span>AI 思考中…</span>
            </div>
          )}
          {aiState === 'done' && aiSuggestedTags.length > 0 && (
            <div className="ai-suggest-results">
              <div className="ai-suggest-label">推荐标签（点击切换选中）：</div>
              <div className="ai-suggest-tags">
                {aiSuggestedTags.map(name => {
                  // 查找当前是否已选中
                  const tag = tags.find(t => t.name === name);
                  const isSelected = tag ? selectedTagIds.includes(tag.id) : false;
                  return (
                    <button
                      key={name}
                      className={`ai-suggest-tag ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleToggleSuggestedTag(name)}
                    >
                      #{name}
                    </button>
                  );
                })}
              </div>
              <div className="ai-suggest-actions">
                <button className="ai-suggest-action apply-all" onClick={handleApplyAllSuggested}>全部应用</button>
                <button className="ai-suggest-action dismiss" onClick={() => { setAiState('idle'); setAiSuggestedTags([]); }}>关闭</button>
              </div>
            </div>
          )}
          {aiState === 'done' && aiSuggestedTags.length === 0 && (
            <div className="ai-suggest-empty">
              <span>未获取到推荐标签</span>
              <button onClick={() => setAiState('idle')}>关闭</button>
            </div>
          )}
        </div>
      ) : null}
      <div className="tag-list">
        {filteredTags.length > 0 ? (
          filteredTags.map(tag => (
            <button
              key={tag.id}
              className={`tag-item ${selectedTagIds.includes(tag.id) ? 'selected' : ''}`}
              onClick={() => toggleTag(tag.id)}
            >
              <span className="tag-name">#{tag.name}</span>
              {selectedTagIds.includes(tag.id) && (
                <span className="tag-check">&#10003;</span>
              )}
            </button>
          ))
        ) : (
          <div className="no-tags">
            <p>没有找到标签</p>
          </div>
        )}
      </div>
      <div className="create-tag">
        {isCreating ? (
          <div className="create-form glass">
            <input
              type="text"
              className="create-input"
              placeholder="输入标签名称..."
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              autoFocus
            />
            <button
              className="create-confirm"
              onClick={handleCreateTag}
              disabled={!newTagName.trim()}
            >
              确认
            </button>
            <button
              className="create-cancel"
              onClick={() => {
                setIsCreating(false);
                setNewTagName('');
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <button className="create-trigger glass" onClick={() => setIsCreating(true)}>
            <span className="btn-icon"><PlusSvg /></span>
            <span>新建标签</span>
          </button>
        )}
      </div>
    </div>
  );
}

export type { TagSelectorProps };