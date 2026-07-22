/**
 * 标签管理页面
 * 支持合并、重命名、删除标签
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTagStore } from '@/stores/tagStore';
import { BottomNav } from '@/components/BottomNav';
import './TagManagePage.css';

export function TagManagePage() {
  const navigate = useNavigate();
  const tags = useTagStore(state => state.tags);
  const renameTag = useTagStore(state => state.renameTag);
  const removeTag = useTagStore(state => state.removeTag);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

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

  return (
    <div className="tag-manage-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">标签管理</h1>
        <div className="header-spacer" />
      </header>

      <main className="page-content">
        {/* 搜索框 */}
        <div className="search-wrapper glass">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索标签..."
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
          />
        </div>

        {/* 标签列表 */}
        <div className="tags-container">
          {filteredTags.length > 0 ? (
            filteredTags.map(tag => (
              <div key={tag.id} className="tag-row glass">
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
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <span className="empty-icon">🏷️</span>
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
