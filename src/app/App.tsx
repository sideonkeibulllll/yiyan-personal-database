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
 * 启动后延迟执行：自动备份 + 待办日期缓存校验
 * v2.6.0：
 * - 延后到应用进入后 60 秒才尝试，避开启动高峰（启动时用户正在操作，I/O 抢资源）
 * - 备份本身是「数据块先写、清单最后写」的原子流程：中途失败不会留下半成品清单，
 *   下次启动 shouldAutoBackup() 仍为 true 会重试；失败时补一次孤儿块 GC 防堆积
 */
function scheduleAutoBackup(): void {
  const DELAY_MS = 60_000;
  setTimeout(() => {
    void (async () => {
      try {
        const { shouldAutoBackup, createBackup } = await import('@/services/backupService');
        if (await shouldAutoBackup()) {
          await createBackup('auto');
        }
      } catch (e) {
        console.warn('自动备份失败:', e);
        // 失败时回收可能残留的孤儿块（数据块已写但清单未提交）
        try {
          const { gcOrphanChunks } = await import('@/services/backupService');
          await gcOrphanChunks();
        } catch { /* 忽略 */ }
      }
      // 每日首次进入时校验待办日期缓存
      try {
        const { getTodoDatabase } = await import('@/services/todoDatabase');
        const db = await getTodoDatabase();
        const dates = await db.getPendingFolderDates();
        localStorage.setItem('yiyan_todo_pending_dates_v1', JSON.stringify(dates));
      } catch (e) {
        console.warn('待办日期缓存校验失败:', e);
      }
    })();
  }, DELAY_MS);
}

/**
 * 记忆来信（v2.12.0）：数据就绪后延迟补缺续排。
 * - 在 entries 全量加载完成后调用（保证选卡池完整）
 * - 再延迟 15 秒执行，避开启动高峰（与 60 秒后的自动备份错开）
 */
function scheduleNotifyRefresh(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { ensureScheduled } = await import('@/services/notifyService');
        await ensureScheduled();
      } catch (e) {
        console.warn('记忆来信续排失败:', e);
      }
    })();
  }, 15_000);
}

/**
 * 后台维护任务：过期归档
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

  // 自动备份：延后 60 秒，避开启动高峰
  scheduleAutoBackup();
}

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadEntriesProgressive = useEntryStore(state => state.loadEntriesProgressive);
  const loadTags = useTagStore(state => state.loadTags);
  const loadSettings = useSettingsStore(state => state.loadSettings);
  const loadAllTodos = useTodoStore(state => state.loadAllTodos);

  useEffect(() => {
    const init = async () => {
      try {
        // ===== 启动性能优化（v2.4.3）=====
        // 关键认知：用户看到的「转圈」时长 = 到这里 setIsReady(true) 的等待。
        // 因此关键路径只保留「真正渲染界面所必需」的最小集合：
        //   ① 两个数据库连接（并行）
        //   ② settings —— 决定主题/配置，缺了界面会闪
        //   ③ tags     —— 首页 TagSelector 直接渲染
        // entries / todos 这类大数据量内容一律推迟到 setIsReady 之后。
        await Promise.all([getDatabase(), getTodoDatabase()]);
        await Promise.all([loadSettings(), loadTags()]);

        // 界面就绪 —— 立即放行
        setIsReady(true);

        // 重量数据与维护任务全部移出关键路径
        // v2.4.3：entries 走「渐进式加载」——先拿最近 50 条让页面立刻有内容，
        //         剩余全量在后台静默补齐；todos 全量并行。
        Promise.all([loadEntriesProgressive(50), loadAllTodos()])
          .catch(e => console.warn('后台数据加载失败:', e))
          .then(() => {
            // v2.12.0: 数据就绪后，延迟补缺续排「记忆来信」
            scheduleNotifyRefresh();
          });

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
  }, [loadEntriesProgressive, loadTags, loadSettings, loadAllTodos]);

  // v2.12.0: 记忆来信——点击通知直达卡片浏览页。
  // 冷启动可靠：框架在 onCreate 即把启动意图递给插件，事件保留至监听注册后重放。
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      const { subscribeTap } = await import('@/services/notifyService');
      const off = await subscribeTap((entryId) => {
        // hash 路由直接赋值即可导航（App 未就绪时，router 挂载后会按当前 hash 渲染）
        window.location.hash = `#/entry/${entryId}`;
      });
      if (cancelled) off();
      else dispose = off;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

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
