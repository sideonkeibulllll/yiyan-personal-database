/**
 * 待办回收站页面
 * 列出所有已删除的待办，支持恢复/彻底删除/清空
 *
 * 结构决策：每一条都是"能被救回来的一行"——
 * 左边是它是什么、什么时候删的，右边只有两个动作：恢复 / 彻底删除。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTodoStore } from '@/stores/todoStore';
import './TodoRecycleBinPage.css';

/** 删除时间 → "删除于 x 天前" */
function deletedAgoText(ts?: number): string {
  if (!ts) return '已删除';
  const days = Math.floor((Date.now() - ts) / 86400000);
  return days <= 0 ? '删除于今天' : `删除于 ${days} 天前`;
}

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
      {/* ══ 顶部返回条 ══ */}
      <header className="rb-bar">
        <button type="button" className="rb-bar-icon" onClick={() => navigate('/settings')} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4 6 9l5 5" />
          </svg>
        </button>
        <span className="rb-bar-title">回收站</span>
        {deletedTodos.length > 0 ? (
          <button type="button" className="rb-bar-clear" onClick={() => setShowEmptyConfirm(true)}>清空</button>
        ) : (
          <span className="rb-bar-space" aria-hidden="true" />
        )}
      </header>

      <p className="rb-note">回收站里的待办 30 天后自动清除</p>

      <main className="rb-body">
        {isLoading ? (
          <div className="rb-loading">正在翻回收站…</div>
        ) : deletedTodos.length > 0 ? (
          <div className="rb-list">
            {deletedTodos.map(todo => (
              <div
                key={todo.id}
                className="rb-item"
                title={`${todo.folderDate ? todo.folderDate + ' · ' : ''}${todo.deletedAt ? formatDate(todo.deletedAt) : ''}`}
              >
                <div className="rb-item-main">
                  <span className="rb-item-title">{todo.title}</span>
                  <span className="rb-item-meta">{deletedAgoText(todo.deletedAt)}</span>
                </div>
                <div className="rb-item-actions">
                  <button type="button" className="rb-restore" onClick={() => handleRestore(todo.id)}>
                    恢复
                  </button>
                  <button
                    type="button"
                    className="rb-purge"
                    onClick={() => setConfirmId(todo.id)}
                    aria-label="彻底删除"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.6 1.6 0 0 0 1.6 1.5h5.9a1.6 1.6 0 0 0 1.6-1.5L17.5 7M10 10.6v6.8M14 10.6v6.8" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rb-empty">
            <b>回收站是空的</b>
            <span>删掉的待办会在这里留 30 天，<br />想找回来随时可以。</span>
            <button type="button" className="rb-empty-cta" onClick={() => navigate('/todo')}>
              回到待办
            </button>
          </div>
        )}
      </main>

      {confirmId && (
        <div className="rb-confirm-overlay" onClick={() => setConfirmId(null)}>
          <div className="rb-confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3>彻底删除</h3>
            <p>此操作无法撤销，确定要永久删除这条待办吗？</p>
            <div className="rb-confirm-actions">
              <button type="button" onClick={() => setConfirmId(null)}>取消</button>
              <button
                type="button"
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
        <div className="rb-confirm-overlay" onClick={() => setShowEmptyConfirm(false)}>
          <div className="rb-confirm-dialog" onClick={e => e.stopPropagation()}>
            <h3>清空回收站</h3>
            <p>将永久删除回收站中的所有 {deletedTodos.length} 条待办，此操作无法撤销。</p>
            <div className="rb-confirm-actions">
              <button type="button" onClick={() => setShowEmptyConfirm(false)}>取消</button>
              <button type="button" className="danger" onClick={handleEmptyBin}>清空</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
