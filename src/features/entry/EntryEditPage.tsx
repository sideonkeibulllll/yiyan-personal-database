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
import { pickImages, saveImageForEntry, deleteAttachmentFiles, readThumbAsSrc } from '@/services/attachmentService';
import { ImageViewer } from '@/components/ImageViewer/ImageViewer';
import type { Entry, Tag, Group, Attachment } from '@/types';
import './EntryEditPage.css';

/* SVG Icon Components */
const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
  </svg>
);

const IconFolder = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

const IconFileText = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
  </svg>
);

const IconStar = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconStarOutline = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IconChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const IconImage = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

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

  // 图片附件
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [thumbSrcs, setThumbSrcs] = useState<Record<string, string>>({});
  const [isPickingImage, setIsPickingImage] = useState(false);
  // 缩略图点击浏览大图（null=未打开；数字=起始索引）
  const [viewerStart, setViewerStart] = useState<number | null>(null);

  // 标签和组信息（用于显示）
  const [entryTags, setEntryTags] = useState<Tag[]>([]);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const loadTags = useTagStore(state => state.loadTags);
  const updateEntry = useEntryStore(state => state.updateEntry);
  const loadEntries = useEntryStore(state => state.loadEntries);

  // 加载数据
  useEffect(() => {
    const loadData = async () => {
      if (!id || id === 'new') {
        // 新建模式：空表单
        setLoading(false);
        try {
          const db = await getDatabase();
          const tags_all = await db.getAllTags();
          const groups = await db.getAllGroups();
          setAllTags(tags_all);
          setAllGroups(groups);
        } catch (err) {
          console.error('加载标签/组失败:', err);
        }
        return;
      }
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

        // 加载图片附件
        const atts = e.attachments || [];
        setAttachments(atts);
        // 异步加载缩略图
        const srcMap: Record<string, string> = {};
        await Promise.all(atts.map(async (att) => {
          srcMap[att.id] = await readThumbAsSrc(att.thumbPath);
        }));
        setThumbSrcs(srcMap);

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
    if (!content.trim()) return;
    setSaving(true);
    try {
      const db = await getDatabase();

      if (id === 'new' || !id) {
        // 新建模式
        const newEntry = await db.createEntry({
          content: content.trim(),
          source: source.trim() || undefined,
          supplement: supplement.trim() || undefined,
          groupId,
          isStarred,
          copyCount: 0,
          lastUsedAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any);

        // 保存标签关联
        for (const tagId of selectedTagIds) {
          await db.addTagToEntry(newEntry.id, tagId);
        }

        await loadEntries();
        navigate(-1);
        return;
      }

      if (!entry) return;

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
  }, [entry, id, content, source, supplement, groupId, isStarred, selectedTagIds, entryTags, updateEntry, navigate, loadEntries]);

  // 标签删除
  const handleRemoveTag = useCallback((tagId: string) => {
    setSelectedTagIds(prev => prev.filter(id => id !== tagId));
  }, []);

  // 添加图片附件（仅编辑已有条目时可用，新建模式等保存后再加）
  const handleAddImage = useCallback(async () => {
    if (!id || id === 'new') return;
    setIsPickingImage(true);
    try {
      const imgs = await pickImages(9);
      if (imgs.length === 0) return;
      const db = await getDatabase();
      const newAtts: Attachment[] = [];
      for (let i = 0; i < imgs.length; i++) {
        const base = attachments.length + newAtts.length + i;
        const attData = await saveImageForEntry(id, imgs[i]);
        attData.sortOrder = base;
        const saved = await db.addAttachment(attData);
        newAtts.push(saved);
        // 加载缩略图
        const src = await readThumbAsSrc(saved.thumbPath);
        setThumbSrcs(prev => ({ ...prev, [saved.id]: src }));
      }
      setAttachments(prev => [...prev, ...newAtts]);
    } catch (err) {
      console.error('添加图片失败:', err);
    } finally {
      setIsPickingImage(false);
    }
  }, [id, attachments.length]);

  // 删除单张图片
  const handleDeleteImage = useCallback(async (att: Attachment) => {
    try {
      const db = await getDatabase();
      await deleteAttachmentFiles(att);
      await db.deleteAttachment(att.id);
      setAttachments(prev => prev.filter(a => a.id !== att.id));
      setThumbSrcs(prev => {
        const next = { ...prev };
        delete next[att.id];
        return next;
      });
    } catch (err) {
      console.error('删除图片失败:', err);
    }
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

  // 新建模式或条目不存在时都显示表单（新建模式下 entry 为 null）
  if (!entry && id !== 'new') {
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
          <IconArrowLeft />
        </button>
        <h1 className="entry-edit-title">{id === 'new' ? '新建条目' : '编辑条目'}</h1>
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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
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
            <span className="entry-edit-group-icon">{groupId ? <IconFolder /> : <IconFileText />}</span>
            <span className="entry-edit-group-name">{getGroupName()}</span>
            <span className="entry-edit-group-arrow"><IconChevronRight /></span>
          </button>
        </div>

        {/* 星标 */}
        <div className="entry-edit-field">
          <label className="entry-edit-label">星标</label>
          <button
            className={`entry-edit-star-toggle ${isStarred ? 'active' : ''}`}
            onClick={() => setIsStarred(!isStarred)}
          >
            <span className="entry-edit-star-icon">{isStarred ? <IconStar /> : <IconStarOutline />}</span>
            <span className="entry-edit-star-text">
              {isStarred ? '已星标' : '未星标'}
            </span>
          </button>
        </div>

        {/* 图片附件（仅编辑已有条目时显示，新建模式等保存后再加） */}
        {id && id !== 'new' && (
          <div className="entry-edit-field">
            <label className="entry-edit-label">
              图片附件
              {attachments.length > 0 && (
                <span className="entry-edit-att-count">（{attachments.length}）</span>
              )}
            </label>
            <div className="entry-edit-attachments">
              {attachments.map((att, idx) => (
                <div key={att.id} className="entry-edit-att-item">
                  <img
                    src={thumbSrcs[att.id] || ''}
                    alt="附件"
                    className="entry-edit-att-thumb"
                    onClick={() => setViewerStart(idx)}
                    title="点击查看大图"
                  />
                  <button
                    className="entry-edit-att-delete"
                    onClick={() => handleDeleteImage(att)}
                    title="删除"
                  >
                    <IconTrash />
                  </button>
                </div>
              ))}
              <button
                className="entry-edit-att-add"
                onClick={handleAddImage}
                disabled={isPickingImage}
                title="添加图片"
              >
                <IconImage />
                <span>{isPickingImage ? '选图中...' : '添加'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部保存按钮 */}
      <footer className="entry-edit-footer">
        <button
          className="entry-edit-save"
          onClick={handleSave}
          disabled={saving || !content.trim()}
        >
          {saving ? '保存中...' : (id === 'new' ? '提交' : '保存')}
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
