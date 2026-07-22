/**
 * 标签选择栏组件
 * 复用组件，支持搜索和多选，支持AI辅助生成
 */
import { useState, useCallback } from 'react';
import { useTagStore } from '@/stores/tagStore';
import type { Tag } from '@/types';
import './TagSelector.css';

interface TagSelectorProps {
  selectedTagIds: string[];
  onSelectionChange: (tagIds: string[]) => void;
  onClose?: () => void;
  showAISuggestion?: boolean;
  onAISuggest?: () => void;
}

export function TagSelector({
  selectedTagIds,
  onSelectionChange,
  onClose,
  showAISuggestion = false,
  onAISuggest,
}: TagSelectorProps) {
  const tags = useTagStore(state => state.tags);
  const addTag = useTagStore(state => state.addTag);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // 过滤标签
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // 切换标签选中状态
  const toggleTag = useCallback((tagId: string) => {
    const newSelection = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    onSelectionChange(newSelection);
  }, [selectedTagIds, onSelectionChange]);

  // 创建新标签
  const handleCreateTag = useCallback(async () => {
    if (!newTagName.trim()) return;

    const tag = await addTag(newTagName.trim());
    toggleTag(tag.id);
    setNewTagName('');
    setIsCreating(false);
  }, [newTagName, addTag, toggleTag]);

  // 批量更新选中状态（用于AI建议）
  const updateSelection = useCallback((tagNames: string[]) => {
    const tagIds = tagNames
      .map(name => tags.find(t => t.name === name)?.id)
      .filter((id): id is string => id !== undefined);
    onSelectionChange(tagIds);
  }, [tags, onSelectionChange]);

  return (
    <div className="tag-selector">
      {/* 头部 */}
      <div className="selector-header">
        <h3 className="selector-title">选择标签</h3>
        {onClose && (
          <button className="selector-close" onClick={onClose}>✕</button>
        )}
      </div>

      {/* 搜索框 */}
      <div className="selector-search glass">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="search-input"
          placeholder="搜索标签..."
          value={searchKeyword}
          onChange={e => setSearchKeyword(e.target.value)}
        />
      </div>

      {/* AI 辅助按钮 */}
      {showAISuggestion && onAISuggest && (
        <button className="ai-suggest-btn glass" onClick={onAISuggest}>
          <span className="btn-icon">🤖</span>
          <span>AI 辅助建议</span>
        </button>
      )}

      {/* 标签列表 */}
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
                <span className="tag-check">✓</span>
              )}
            </button>
          ))
        ) : (
          <div className="no-tags">
            <p>没有找到标签</p>
          </div>
        )}
      </div>

      {/* 创建新标签 */}
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
            <span className="btn-icon">+</span>
            <span>新建标签</span>
          </button>
        )}
      </div>
    </div>
  );
}

export type { TagSelectorProps };
