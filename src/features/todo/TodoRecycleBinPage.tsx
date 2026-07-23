/**
 * 待办回收站页面
 * 列出所有已删除的待办，支持恢复/彻底删除/清空
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import { BottomNav } from '@/components/BottomNav';
import './TodoRecycleBinPage.css';

export function TodoRecycleBinPage() {
  const navigate = useNavigate();
  const [deletedTodos, setDeletedTodos] = useState<import('@/types').Todo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

  const { restoreTodo, permanentDeleteTodo, emptyRecycleBin } = useTodoStore();

  const loadDeleted = useCallback(async () => {
    setIsLoading(true);
    try {
      const { getTodoDatabase } = await import('@/services/todoDatabase');
      const db = await getTodoDatabase();
      const all = await db.getAllTodos({ includeDeleted: true });
      setDeletedTodos(all.filter(t => t.deletedAt));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeleted();
  }, [loadDeleted]);

  const handleRestore = useCallback(async (id: string) => {
    await restoreTodo(id);
    setDeletedTodos(prev => prev.filter(t => t.id !== id));
  }, [restoreTodo]);

  const handlePermanentDelete = useCallback(async (id: string) => {
    await permanentDeleteTodo(id);
    setDeletedTodos(prev => prev.filter(t => t.id !== id));
    setConfirmId(null);
  }, [permanentDeleteTodo]);

  const handleEmptyBin = useCallback(async () => {
    await emptyRecycleBin();
    setDeletedTodos([]);
    setShowEmptyConfirm(false);
  }, [emptyRecycleBin]);

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="recycle-bin-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate('/settings')}>←</button>
        <h1>回收站</h1>
        {deletedTodos.length > 0 && (
          <button className="empty-btn" onClick={() => setShowEmptyConfirm(true)}>清空</button>
        )}
      </header>

      <main className="page-content">
        {isLoading ? (
          <div className="loading-state"><div className="loading-spinner" /></div>
        ) : deletedTodos.length > 0 ? (
          <>
            <p className="recycle-hint">{deletedTodos.length} 条已删除待办</p>
            <div className="recycle-list">
              {deletedTodos.map(todo => (
                <div key={todo.id} className="recycle-item glass">
                  <div className="item-body">
                    <div className="item-title">{todo.title}</div>
                    {todo.folderDate && <div className="item-date">{todo.folderDate}</div>}
                    {todo.deletedAt && (
                      <div className="item-deleted-at">删除于 {formatDate(todo.deletedAt)}</div>
                    )}
                  </div>
                  <div className="item-actions">
                    <button className="action-restore" onClick={() => handleRestore(todo.id)}>
                      恢复
                    </button>
                    <button
                      className="action-delete"
                      onClick={() => setConfirmId(todo.id)}
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>回收站为空</p>
            <p className="empty-hint">已删除的待办会在这里显示 30 天</p>
          </div>
        )}
      </main>

      {confirmId && (
        <div className="confirm-overlay" onClick={() => setConfirmId(null)}>
          <div className="confirm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3>彻底删除</h3>
            <p>此操作无法撤销，确定要永久删除这条待办吗？</p>
            <div className="confirm-actions">
              <button onClick={() => setConfirmId(null)}>取消</button>
              <button
                className="danger"
                onClick={() => handlePermanentDelete(confirmId)}
              >
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmptyConfirm && (
        <div className="confirm-overlay" onClick={() => setShowEmptyConfirm(false)}>
          <div className="confirm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3>清空回收站</h3>
            <p>将永久删除回收站中的所有 {deletedTodos.length} 条待办，此操作无法撤销。</p>
            <div className="confirm-actions">
              <button onClick={() => setShowEmptyConfirm(false)}>取消</button>
              <button className="danger" onClick={handleEmptyBin}>清空</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
