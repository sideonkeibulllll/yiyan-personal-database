/**
 * 应用入口组件
 */
import { useEffect, useState } from 'react';
import { AppRouter } from './router';
import { Loading } from '@/components/Loading';
import { getDatabase } from '@/services/database';
import { getTodoDatabase } from '@/services/todoDatabase';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';

/** Triangle alert icon */
const TriangleAlertSvg = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" />
  </svg>
);

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadEntries = useEntryStore(state => state.loadEntries);
  const loadTags = useTagStore(state => state.loadTags);
  const loadSettings = useSettingsStore(state => state.loadSettings);
  const loadAllTodos = useTodoStore(state => state.loadAllTodos);

  useEffect(() => {
    const init = async () => {
      try {
        await getDatabase();
        await getTodoDatabase();
        await Promise.all([loadEntries(), loadTags(), loadSettings(), loadAllTodos()]);

        // 过期自动归档：将过期满 1 个月的待办移入回收站
        try {
          const db = await getTodoDatabase();
          const retentionDays = useSettingsStore.getState().settings.todo?.recycleBinRetentionDays ?? 30;
          if (retentionDays > 0) {
            const allTodos = await db.getAllTodos();
            const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
            for (const todo of allTodos) {
              if (!todo.deletedAt && todo.endTime && todo.endTime < threshold && todo.status === 'pending') {
                await db.deleteTodo(todo.id);
              }
            }
          }
        } catch (e) {
          console.warn('过期归档检查失败:', e);
        }

        setIsReady(true);
      } catch (err) {
        console.error('初始化失败:', err);
        setError((err as Error).message);
        setIsReady(true);
      }
    };

    init();
  }, [loadEntries, loadTags, loadSettings, loadAllTodos]);

  if (!isReady) {
    return <Loading />;
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: '20px',
        textAlign: 'center',
        background: '#060201',
      }}>
        <div style={{ marginBottom: 16, color: 'var(--color-error, #ef4444)' }}><TriangleAlertSvg /></div>
        <div style={{ fontSize: 16, color: '#ef4444', marginBottom: 8, fontFamily: 'var(--font-serif, Fraunces, serif)' }}>数据库初始化失败</div>
        <div style={{ fontSize: 13, color: '#706556' }}>{error}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 24,
            padding: '10px 24px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #806a4d, #cbb99f)',
            color: '#060201',
            border: 'none',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  return <AppRouter />;
}