/**
 * 标签管理页面
 * 支持合并、重命名、删除标签
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTagStore } from '@/stores/tagStore';
import { BottomNav } from '@/components/BottomNav';
import './TagManagePage.css';

/* SVG Icon Components */
const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
  </svg>
);

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);

const IconTag = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </svg>
);

export function TagManagePage() {
  const navigate = useNavigate();
  const tags = useTagStore(state => state.tags);
  const renameTag = useTagStore(state => state.renameTag);
  const removeTag = useTagStore(state => state.removeTag);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  // 标签合并状态
  const [mergeMode, setMergeMode] = useState(false);
  const [sourceTagId, setSourceTagId] = useState<string | null>(null);
  const [targetTagId, setTargetTagId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // 过滤标签
  const filteredTags = tags.filter(tag =>
    tag.name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  // 开始编辑
  const handleStartEdit = useCallback((tag: { id: string; name: string }) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  }, []);

  // 确认编辑
  const handleConfirmEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;

    await renameTag(editingId, editName.trim());
    setEditingId(null);
    setEditName('');
  }, [editingId, editName, renameTag]);

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName('');
  }, []);

  // 确认删除
  const handleConfirmDelete = useCallback(async (tagId: string) => {
    await removeTag(tagId);
    setShowDeleteConfirm(null);
  }, [removeTag]);

  // 合并标签：将 sourceTag 上的所有条目引用转移到 targetTag，然后删除 sourceTag
  const handleMergeTags = useCallback(async () => {
    if (!sourceTagId || !targetTagId || sourceTagId === targetTagId) return;
    setIsMerging(true);
    try {
      const { getDatabase } = await import('@/services/database');
      const db = await getDatabase();
      // 获取源标签下所有条目
      const sourceEntries = await db.getEntriesByTagId(sourceTagId);
      for (const entry of sourceEntries) {
        const currentTagIds = (entry.tags || []).map((t: any) => t.id);
        if (!currentTagIds.includes(targetTagId)) {
          await db.addTagToEntry(entry.id, targetTagId);
        }
        await db.removeTagFromEntry(entry.id, sourceTagId);
      }
      // 删除源标签
      await removeTag(sourceTagId);
      // 重置状态
      setMergeMode(false);
      setSourceTagId(null);
      setTargetTagId(null);
    } catch (e) {
      alert('合并失败: ' + (e as Error).message);
    } finally {
      setIsMerging(false);
    }
  }, [sourceTagId, targetTagId, removeTag]);

  return (
    <div className="tag-manage-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}><IconArrowLeft /></button>
        <h1 className="page-title">标签管理</h1>
        <div className="header-spacer" />
      </header>

      <main className="page-content">
        {/* 搜索框 */}
        <div className="search-wrapper glass">
          <span className="search-icon"><IconSearch /></span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索标签..."
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
          />
        </div>

        {/* 合并模式切换 */}
        <button
          className={`merge-toggle-btn ${mergeMode ? 'active' : ''}`}
          onClick={() => {
            setMergeMode(!mergeMode);
            setSourceTagId(null);
            setTargetTagId(null);
          }}
        >
          {mergeMode ? '取消合并' : '标签合并模式'}
        </button>

        {mergeMode && (
          <div className="merge-hint glass">
            <p>选择两个标签进行合并：</p>
            <p>1. 点击源标签（将被删除）</p>
            <p>2. 点击目标标签（保留）</p>
            {sourceTagId && targetTagId && (
              <div className="merge-preview">
                <span>将 #{tags.find(t => t.id === sourceTagId)?.name} 合并到 #{tags.find(t => t.id === targetTagId)?.name}</span>
                <button
                  className="merge-confirm-btn"
                  onClick={handleMergeTags}
                  disabled={isMerging}
                >
                  {isMerging ? '合并中...' : '确认合并'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 标签列表 */}
        <div className="tags-container">
          {filteredTags.length > 0 ? (
            filteredTags.map(tag => (
              <div
                key={tag.id}
                className={`tag-row glass ${mergeMode ? 'merge-selectable' : ''} ${sourceTagId === tag.id ? 'merge-source' : ''} ${targetTagId === tag.id ? 'merge-target' : ''}`}
                onClick={() => {
                  if (!mergeMode) return;
                  if (!sourceTagId) {
                    setSourceTagId(tag.id);
                  } else if (!targetTagId && tag.id !== sourceTagId) {
                    setTargetTagId(tag.id);
                  } else if (tag.id === sourceTagId) {
                    setSourceTagId(null);
                  } else if (tag.id === targetTagId) {
                    setTargetTagId(null);
                  }
                }}
              >
                {editingId === tag.id ? (
                  <div className="edit-form">
                    <input
                      type="text"
                      className="edit-input"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      autoFocus
                    />
                    <button className="edit-confirm" onClick={handleConfirmEdit}>
                      确认
                    </button>
                    <button className="edit-cancel" onClick={handleCancelEdit}>
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="tag-info">
                      <span className="tag-name">#{tag.name}</span>
                      <span className="tag-date">
                        {new Date(tag.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    {!mergeMode && (
                      <div className="tag-actions">
                        <button
                          className="action-btn"
                          onClick={() => handleStartEdit(tag)}
                        >
                          重命名
                        </button>
                        <button
                          className="action-btn danger"
                          onClick={() => setShowDeleteConfirm(tag.id)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><IconTag /></span>
              <p className="empty-text">
                {searchKeyword ? '没有找到匹配的标签' : '还没有创建标签'}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="confirm-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="confirm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3 className="confirm-title">确认删除</h3>
            <p className="confirm-text">删除后无法恢复，确定要删除这个标签吗？</p>
            <div className="confirm-actions">
              <button
                className="confirm-cancel"
                onClick={() => setShowDeleteConfirm(null)}
              >
                取消
              </button>
              <button
                className="confirm-delete"
                onClick={() => handleConfirmDelete(showDeleteConfirm)}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
