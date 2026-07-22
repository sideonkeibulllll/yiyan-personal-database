/**
 * 数据编辑页面
 * 编辑条目的所有信息：内容、来源、补充、标签、组、星标
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { useTagStore } from '@/stores/tagStore';
import { useEntryStore } from '@/stores/entryStore';
import { TagSelector } from '@/components/TagSelector/TagSelector';
import { GroupSelector } from '@/components/GroupSelector/GroupSelector';
import type { Entry, Tag, Group } from '@/types';
import './EntryEditPage.css';

export function EntryEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 表单字段
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [supplement, setSupplement] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const [isStarred, setIsStarred] = useState(false);

  // 弹出层
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [showGroupSelector, setShowGroupSelector] = useState(false);

  // 标签和组信息（用于显示）
  const [entryTags, setEntryTags] = useState<Tag[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const loadTags = useTagStore(state => state.loadTags);
  const updateEntry = useEntryStore(state => state.updateEntry);

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      if (!id) return;
      try {
        const db = await getDatabase();
        const e = await db.getEntryById(id);
        if (!e) {
          navigate(-1);
          return;
        }
        setEntry(e);
        setContent(e.content);
        setSource(e.source || '');
        setSupplement(e.supplement || '');
        setGroupId(e.groupId);
        setIsStarred(e.isStarred);

        // 加载条目的标签
        const tags = await db.getTagsByEntryId(id);
        setEntryTags(tags);
        setSelectedTagIds(tags.map(t => t.id));

        // 加载所有标签和组
        const tags_all = await db.getAllTags();
        const groups = await db.getAllGroups();
        setAllTags(tags_all);
        setAllGroups(groups);
        await loadTags();
      } catch (err) {
        console.error('加载条目失败:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存
  const handleSave = useCallback(async () => {
    if (!entry || !id) return;
    setSaving(true);
    try {
      const db = await getDatabase();

      // 更新基本字段
      await updateEntry(id, {
        content: content.trim(),
        source: source.trim() || undefined,
        supplement: supplement.trim() || undefined,
        groupId,
        isStarred,
      });

      // 更新标签：先获取当前标签，计算差异
      const currentTagIds = new Set(entryTags.map(t => t.id));
      const newTagIds = new Set(selectedTagIds);

      // 添加新标签
      for (const tagId of selectedTagIds) {
        if (!currentTagIds.has(tagId)) {
          await db.addTagToEntry(id, tagId);
        }
      }

      // 移除旧标签
      for (const tagId of currentTagIds) {
        if (!newTagIds.has(tagId)) {
          await db.removeTagFromEntry(id, tagId);
        }
      }

      navigate(-1);
    } catch (err) {
      console.error('保存失败:', err);
      setSaving(false);
    }
  }, [entry, id, content, source, supplement, groupId, isStarred, selectedTagIds, entryTags, updateEntry, navigate]);

  // 标签删除
  const handleRemoveTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev => prev.filter(id => id !== tagId));
  }, []);

  // 获取标签名
  const getTagName = useCallback((tagId: string) => {
    const tag = allTags.find(t => t.id === tagId);
    return tag?.name || '未知';
  }, [allTags]);

  // 获取组名
  const getGroupName = useCallback(() => {
    if (!groupId) return '未分组';
    const group = allGroups.find(g => g.id === groupId);
    return group?.name || '未分组';
  }, [groupId, allGroups]);

  if (loading) {
    return (
      <div className="entry-edit-page">
        <div className="entry-edit-loading">加载中...</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="entry-edit-page">
        <div className="entry-edit-loading">条目不存在</div>
      </div>
    );
  }

  return (
    <div className="entry-edit-page">
      {/* 顶部栏 */}
      <header className="entry-edit-header">
        <button className="entry-edit-back" onClick={() => navigate(-1)}>
          ←
        </button>
        <h1 className="entry-edit-title">编辑条目</h1>
        <div className="entry-edit-header-spacer" />
      </header>

      {/* 表单 */}
      <div className="entry-edit-form">
        {/* 内容 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">内容</label>
          <textarea
            className="entry-edit-textarea glass"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="输入内容..."
            rows={4}
            autoFocus
          />
        </div>

        {/* 来源 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">来源</label>
          <input
            type="text"
            className="entry-edit-input glass"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="输入来源..."
          />
        </div>

        {/* 补充信息 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">补充信息</label>
          <textarea
            className="entry-edit-textarea glass"
            value={supplement}
            onChange={e => setSupplement(e.target.value)}
            placeholder="输入补充信息..."
            rows={3}
          />
        </div>

        {/* 标签 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">标签</label>
          <div className="entry-edit-tags">
            {selectedTagIds.map(tagId => (
              <span key={tagId} className="entry-edit-tag-chip">
                <span className="entry-edit-tag-name">#{getTagName(tagId)}</span>
                <button
                  className="entry-edit-tag-remove"
                  onClick={() => handleRemoveTag(tagId)}
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              className="entry-edit-tag-add"
              onClick={() => setShowTagSelector(true)}
            >
              + 添加标签
            </button>
          </div>
        </div>

        {/* 组 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">所属组</label>
          <button
            className="entry-edit-group-display glass"
            onClick={() => setShowGroupSelector(true)}
          >
            <span className="entry-edit-group-icon">{groupId ? '📁' : '📝'}</span>
            <span className="entry-edit-group-name">{getGroupName()}</span>
            <span className="entry-edit-group-arrow">›</span>
          </button>
        </div>

        {/* 星标 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">星标</label>
          <button
            className={`entry-edit-star-toggle ${isStarred ? 'active' : ''}`}
            onClick={() => setIsStarred(!isStarred)}
          >
            <span className="entry-edit-star-icon">{isStarred ? '⭐' : '☆'}</span>
            <span className="entry-edit-star-text">
              {isStarred ? '已星标' : '未星标'}
            </span>
          </button>
        </div>
      </div>

      {/* 底部保存按钮 */}
      <footer className="entry-edit-footer">
        <button
          className="entry-edit-save"
          onClick={handleSave}
          disabled={saving || !content.trim()}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </footer>

      {/* 标签选择器弹层 */}
      {showTagSelector && (
        <div className="entry-edit-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="entry-edit-selector-panel" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={selectedTagIds}
              onSelectionChange={setSelectedTagIds}
              onClose={() => setShowTagSelector(false)}
            />
          </div>
        </div>
      )}

      {/* 组选择器弹层 */}
      {showGroupSelector && (
        <div className="entry-edit-overlay" onClick={() => setShowGroupSelector(false)}>
          <div className="entry-edit-selector-panel" onClick={e => e.stopPropagation()}>
            <GroupSelector
              selectedGroupId={groupId}
              onSelect={setGroupId}
              onClose={() => setShowGroupSelector(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
