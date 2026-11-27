/**
 * 数据编辑页面（UI v5）
 *
 * 结构决策：这是详情页那张纸的「可写版本」。
 *  - 顶部 44px：左「取消」、右「⋯」（属性 / 删除）
 *  - 正文就是纸面本身：无边框、auto-grow 的 textarea，边距与详情页一致
 *  - 所有字段（标签 / 分组 / 星标 / 来源 / 补充 / 图片）收进底部「属性」抽屉
 *  - 底部只有一条：左「字数」、右「保存」（唯一主色，且有改动才亮）
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { useTagStore } from '@/stores/tagStore';
import { useEntryStore } from '@/stores/entryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ai } from '@/services/ai';
import { TagSelector } from '@/components/TagSelector/TagSelector';
import { GroupSelector } from '@/components/GroupSelector/GroupSelector';
import { pickImages, saveImageForEntry, deleteAttachmentFiles, readThumbAsSrc } from '@/services/attachmentService';
import { ImageViewer } from '@/components/ImageViewer/ImageViewer';
import { hasAIAccess } from '@/utils/aiAccess';
import type { Entry, Tag, Group, Attachment } from '@/types';
import './EntryEditPage.css';

/* SVG Icon Components */
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

const IconDots = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle cx="13" cy="8" r="1.35" />
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
  // ⋯ 菜单 / 属性抽屉
  const [menuOpen, setMenuOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);

  // b.8: 智能标签和智能组状态
  const settings = useSettingsStore(state => state.settings);
  const [isSmartTagLoading, setIsSmartTagLoading] = useState(false);
  const [isSmartGroupLoading, setIsSmartGroupLoading] = useState(false);
  const addTag = useTagStore(state => state.addTag);

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
  const deleteEntry = useEntryStore(state => state.deleteEntry);

  // 纸面正文自动长高
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // 删除整条数据
  const handleDelete = useCallback(async () => {
    if (!id || id === 'new' || !entry) return;
    if (!confirm('确定删除这条数据吗？删除后不可恢复。')) return;
    try {
      // 先删除附件文件
      for (const att of attachments) {
        try { await deleteAttachmentFiles(att); } catch { /* ignore */ }
      }
      await deleteEntry(id);
      navigate(-1);
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败: ' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, [id, entry, attachments, deleteEntry, navigate]);

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

  // b.8: 智能标签 — AI 推荐标签
  const handleSmartTagSuggest = useCallback(async () => {
    if (!content.trim()) {
      alert('请先输入内容');
      return;
    }
    if (!hasAIAccess(settings.ai)) {
      alert('请先在设置中配置 AI API Key');
      return;
    }
    setIsSmartTagLoading(true);
    try {
      ai.setConfig(settings.ai);
      // 获取最近标签
      const db = await getDatabase();
      const allTags = await db.getAllTags();
      const count = settings.ai.smartTag?.recentTagCount ?? 50;
      const recentTagNames = allTags
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, count)
        .map(t => t.name);
      const customPrompt = settings.ai.smartTag?.tagSuggestPrompt;
      const suggested = await ai.suggestTagsWithRecent(content, recentTagNames, customPrompt);
      // b.8: 只从已有标签中选取，不创建新标签
      for (const tagName of suggested) {
        const tag = allTags.find(t => t.name === tagName);
        // 只选中已有标签，不创建
        if (tag && !selectedTagIds.includes(tag.id)) {
          setSelectedTagIds(prev => [...prev, tag.id]);
        }
      }
      if (suggested.length === 0) {
        alert('没有找到匹配的已有标签');
      }
    } catch (err) {
      console.error('智能标签失败:', err);
      alert('智能标签失败: ' + (err as Error).message);
    } finally {
      setIsSmartTagLoading(false);
    }
  }, [content, settings.ai, selectedTagIds, addTag]);

  // b.8: 智能组 — AI 推荐组
  const handleSmartGroupSuggest = useCallback(async () => {
    if (!content.trim()) {
      alert('请先输入内容');
      return;
    }
    if (!hasAIAccess(settings.ai)) {
      alert('请先在设置中配置 AI API Key');
      return;
    }
    setIsSmartGroupLoading(true);
    try {
      ai.setConfig(settings.ai);
      const existingGroupNames = allGroups.map(g => g.name);
      const suggestedGroups = await ai.suggestGroups(content, existingGroupNames);
      // b.8: 只从已有组中选取，不创建新组
      let matched = false;
      for (const groupName of suggestedGroups) {
        const existing = allGroups.find(g => g.name === groupName);
        if (existing) {
          setGroupId(existing.id);
          matched = true;
          break;
        }
      }
      if (!matched) {
        alert('没有找到匹配的已有分组');
      }
    } catch (err) {
      console.error('智能组失败:', err);
      alert('智能组失败: ' + (err as Error).message);
    } finally {
      setIsSmartGroupLoading(false);
    }
  }, [content, settings.ai, allGroups, groupId]);

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

  // 正文自动长高
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [content, loading]);

  // 是否有未保存改动
  const initialTagKey = useMemo(
    () => entryTags.map(t => t.id).sort().join(','),
    [entryTags],
  );
  const dirty = useMemo(() => {
    if (id === 'new' || !entry) {
      return Boolean(
        content.trim() || source.trim() || supplement.trim() ||
        selectedTagIds.length > 0 || groupId || isStarred,
      );
    }
    return (
      content !== entry.content ||
      source !== (entry.source || '') ||
      supplement !== (entry.supplement || '') ||
      groupId !== entry.groupId ||
      isStarred !== entry.isStarred ||
      [...selectedTagIds].sort().join(',') !== initialTagKey
    );
  }, [id, entry, content, source, supplement, groupId, isStarred, selectedTagIds, initialTagKey]);

  // 取消：有改动先问一句
  const handleCancel = useCallback(() => {
    if (dirty && !confirm('有未保存的修改，确定放弃吗？')) return;
    navigate(-1);
  }, [dirty, navigate]);

  // 属性摘要：一眼看到这张纸上还有什么
  const propsSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedTagIds.length > 0) parts.push(`${selectedTagIds.length} 个标签`);
    if (groupId) parts.push(getGroupName());
    if (isStarred) parts.push('已星标');
    if (id && id !== 'new' && attachments.length > 0) parts.push(`${attachments.length} 张图片`);
    if (source.trim()) parts.push('有来源');
    if (supplement.trim()) parts.push('有补充');
    return parts.join(' · ');
  }, [selectedTagIds.length, groupId, isStarred, id, attachments.length, source, supplement, getGroupName]);

  if (loading) {
    return (
      <div className="entry-edit-page">
        <header className="entry-edit-bar">
          <button className="entry-edit-cancel" onClick={() => navigate(-1)}>取消</button>
          <span className="entry-edit-bar-center" />
          <span className="entry-edit-bar-spacer" />
        </header>
        <div className="entry-edit-loading">正在铺开这张纸…</div>
      </div>
    );
  }

  // 新建模式或条目不存在时都显示表单（新建模式下 entry 为 null）
  if (!entry && id !== 'new') {
    return (
      <div className="entry-edit-page">
        <header className="entry-edit-bar">
          <button className="entry-edit-cancel" onClick={() => navigate(-1)}>取消</button>
          <span className="entry-edit-bar-center" />
          <span className="entry-edit-bar-spacer" />
        </header>
        <div className="entry-edit-loading">这条记忆不在了</div>
      </div>
    );
  }

  return (
    <div className="entry-edit-page">
      {/* 顶部 44px：取消 / 模式 / ⋯ */}
      <header className="entry-edit-bar">
        <button className="entry-edit-cancel" onClick={handleCancel}>取消</button>
        <span className="entry-edit-bar-center">{id === 'new' ? '新记忆' : '编辑'}</span>
        <button
          className={`entry-edit-more${menuOpen ? ' on' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-label="更多操作"
          aria-expanded={menuOpen}
        >
          <IconDots />
        </button>

        {menuOpen && (
          <>
            <div className="entry-edit-scrim" onClick={() => setMenuOpen(false)} />
            <div className="entry-edit-menu" role="menu" onClick={e => e.stopPropagation()}>
              <button role="menuitem" onClick={() => { setMenuOpen(false); setPropsOpen(true); }}>属性</button>
              {id && id !== 'new' && (
                <button role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); void handleDelete(); }}>
                  删除
                </button>
              )}
            </div>
          </>
        )}
      </header>

      {/* 纸面：与详情页同一套边距与字号 */}
      <div className="entry-edit-body">
        <div className="entry-edit-paper">
          <textarea
            ref={contentRef}
            className="entry-edit-content"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="写点什么…"
            rows={1}
            autoFocus
          />

          <button className="entry-edit-props" onClick={() => setPropsOpen(true)}>
            <span className={`entry-edit-props-text${propsSummary ? '' : ' is-empty'}`}>
              {propsSummary || '标签 · 分组 · 来源 · 图片'}
            </span>
            <span className="entry-edit-props-arrow"><IconChevronRight /></span>
          </button>
        </div>
      </div>

      {/* 底部：字数 + 保存（唯一主色） */}
      <footer className="entry-edit-dock">
        <span className="entry-edit-count">{content.trim().length} 字</span>
        <button
          className="entry-edit-save"
          onClick={handleSave}
          disabled={saving || !content.trim() || !dirty}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </footer>

      {/* 属性抽屉：原来屏幕上的所有字段，一件都没少 */}
      {propsOpen && (
        <>
          <div className="entry-edit-sheet-scrim" onClick={() => setPropsOpen(false)} />
          <div className="entry-edit-sheet" role="dialog" aria-label="属性">
            <span className="entry-edit-sheet-grip" aria-hidden="true" />
            <div className="entry-edit-sheet-head">
              <span>属性</span>
              <button onClick={() => setPropsOpen(false)}>完成</button>
            </div>

            <div className="entry-edit-sheet-body">
              {/* 标签 */}
              <div className="entry-edit-field">
                <div className="entry-edit-label">
                  <span>标签</span>
                  <button
                    className="smart-suggest-btn"
                    onClick={handleSmartTagSuggest}
                    disabled={isSmartTagLoading}
                    title="AI 智能标签"
                  >
                    {isSmartTagLoading ? 'AI…' : '智能标签'}
                  </button>
                </div>
                <div className="entry-edit-tags">
                  {selectedTagIds.map(tagId => (
                    <span key={tagId} className="entry-edit-tag-chip">
                      <span className="entry-edit-tag-name">#{getTagName(tagId)}</span>
                      <button
                        className="entry-edit-tag-remove"
                        onClick={() => handleRemoveTag(tagId)}
                        aria-label="移除标签"
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
                <div className="entry-edit-label">
                  <span>所属组</span>
                  <button
                    className="smart-suggest-btn"
                    onClick={handleSmartGroupSuggest}
                    disabled={isSmartGroupLoading}
                    title="AI 智能组"
                  >
                    {isSmartGroupLoading ? 'AI…' : '智能组'}
                  </button>
                </div>
                <button
                  className="entry-edit-group-display"
                  onClick={() => setShowGroupSelector(true)}
                >
                  <span className="entry-edit-group-icon">{groupId ? <IconFolder /> : <IconFileText />}</span>
                  <span className="entry-edit-group-name">{getGroupName()}</span>
                  <span className="entry-edit-group-arrow"><IconChevronRight /></span>
                </button>
              </div>

              {/* 星标 */}
              <div className="entry-edit-field">
                <div className="entry-edit-label"><span>收藏</span></div>
                <button
                  className={`entry-edit-star-toggle ${isStarred ? 'active' : ''}`}
                  onClick={() => setIsStarred(!isStarred)}
                >
                  <span className="entry-edit-star-icon">{isStarred ? <IconStar /> : <IconStarOutline />}</span>
                  <span className="entry-edit-star-text">
                    {isStarred ? '已收藏' : '未收藏'}
                  </span>
                </button>
              </div>

              {/* 来源 */}
              <div className="entry-edit-field">
                <div className="entry-edit-label"><span>来源</span></div>
                <input
                  type="text"
                  className="entry-edit-input"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="从哪里记下的？"
                />
              </div>

              {/* 补充信息 */}
              <div className="entry-edit-field">
                <div className="entry-edit-label"><span>补充</span></div>
                <textarea
                  className="entry-edit-textarea"
                  value={supplement}
                  onChange={e => setSupplement(e.target.value)}
                  placeholder="再补一句…"
                  rows={3}
                />
              </div>

              {/* 图片附件（仅编辑已有条目时显示，新建模式等保存后再加） */}
              {id && id !== 'new' && (
                <div className="entry-edit-field">
                  <div className="entry-edit-label">
                    <span>图片附件</span>
                    {attachments.length > 0 && (
                      <span className="entry-edit-att-count">{attachments.length}</span>
                    )}
                  </div>
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
                      <span>{isPickingImage ? '选图中…' : '添加'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

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
