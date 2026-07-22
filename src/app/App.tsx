/**
 * 应用入口组件
 */
import { useEffect, useState } from 'react';
import { AppRouter } from './router';
import { Loading } from '@/components/Loading';
import { getDatabase } from '@/services/database';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadEntries = useEntryStore(state => state.loadEntries);
  const loadTags = useTagStore(state => state.loadTags);

  useEffect(() => {
    // 初始化数据库并加载数据
    const init = async () => {
      try {
        await getDatabase();
        await Promise.all([loadEntries(), loadTags()]);
        setIsReady(true);
      } catch (err) {
        console.error('初始化失败:', err);
        setError((err as Error).message);
        // 即使出错也显示界面，避免白屏
        setIsReady(true);
      }
    };

    init();
  }, [loadEntries, loadTags]);

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
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 16, color: '#f87171', marginBottom: 8 }}>数据库初始化失败</div>
        <div style={{ fontSize: 13, color: '#6b6b80' }}>{error}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 24,
            padding: '10px 24px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #6366f1, #818cf8)',
            color: 'white',
            border: 'none',
            fontSize: 14,
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
