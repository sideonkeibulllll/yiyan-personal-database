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

/** 后台任务防重入（React StrictMode 下 useEffect 会执行两次） */
let backgroundTasksStarted = false;

/**
 * 后台维护任务：过期归档 + 每日自动备份
 * 不阻塞界面显示，启动关键路径之外执行
 */
async function runBackgroundTasks(): Promise<void> {
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

  // 每天首次打开时自动备份（索引式，内容去重，增量很快）
  // 性能优化（v2.4.2）：backupService 静态引入了 jszip（约 100KB），
  // 改为此处按需动态 import，避免把 jszip 打进首屏主包。
  try {
    const { shouldAutoBackup, createBackup } = await import('@/services/backupService');
    if (await shouldAutoBackup()) {
      await createBackup('auto');
    }
  } catch (e) {
    console.warn('自动备份失败:', e);
  }
}

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
        // 两个数据库并行初始化
        await Promise.all([getDatabase(), getTodoDatabase()]);

        // ===== 启动性能优化（v2.4.2）=====
        // 原实现：await Promise.all([4 个 store 全量加载]) 之后才撤 Loading，
        // 数据量一大就要空等「条目全表 + 待办全表 + 标签关联」。
        // 现在拆成两段：
        //   ① 轻量关键数据（settings / tags）→ 决定「能否渲染界面」
        //   ② 重量业务数据（entries / todos）→ 后台填充，首屏骨架立即显示
        await Promise.all([loadSettings(), loadTags()]);

        // 界面就绪 —— 立即放行到首页骨架
        setIsReady(true);

        // 重量数据与维护任务全部移出关键路径
        Promise.all([loadEntries(), loadAllTodos()]).catch(e =>
          console.warn('后台数据加载失败:', e)
        );

        if (!backgroundTasksStarted) {
          backgroundTasksStarted = true;
          runBackgroundTasks();
        }
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
        background: '#131416',
      }}>
        <div style={{ marginBottom: 16, color: 'var(--color-error, #fa5252)' }}><TriangleAlertSvg /></div>
        <div style={{ fontSize: 16, color: '#fa5252', marginBottom: 8 }}>数据库初始化失败</div>
        <div style={{ fontSize: 13, color: '#868e96' }}>{error}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 24,
            padding: '10px 24px',
            borderRadius: 8,
            background: '#f76707',
            color: '#ffffff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
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
