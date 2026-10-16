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
import { matchesAutoWeekdays } from '@/utils/todoWeekdays';

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
 * 桌面橱窗（v2.13.0）：数据就绪后延迟同步展示计划。
 * - 生成 14 天计划写入原生（余量充足时自动跳过，避免无谓改写）
 * - 与记忆来信续排同样延后 15 秒，避开启动高峰
 */
function scheduleWidgetSync(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const { syncAll } = await import('@/services/widgetService');
        await syncAll();
      } catch (e) {
        console.warn('桌面橱窗同步失败:', e);
      }
    })();
  }, 15_000);
}

/**
 * 待办变动即时同步（v2.13.2）：订阅 todoStore，App 内完成 / 新增 / 编辑待办后
 * 防抖 2.5s 自动推送到桌面组件；切后台立即 flush。
 * 仅安卓原生端生效（内部判断），幂等注册。
 */
function initTodoAutoSyncSafe(): void {
  void (async () => {
    try {
      const { initTodoAutoSync } = await import('@/services/widgetService');
      initTodoAutoSync();
    } catch (e) {
      console.warn('待办自动同步初始化失败:', e);
    }
  })();
}

/**
 * 转盘小组件同步（v2.14.0）：
 * - 启动时下发盘序（MRU + 其余按 updatedAt）
 * - 消费原生「转动」结果 → 补写 history + MRU
 */
function scheduleWheelWidgetSync(): void {
  void (async () => {
    try {
      const { syncWheelWidgets, consumePendingSpinResult } = await import('@/services/wheelWidgetService');
      await consumePendingSpinResult();
      await syncWheelWidgets();
    } catch (e) {
      console.warn('转盘小组件同步失败:', e);
    }
  })();
}

/** 本地「今天」的日期键（YYYY-MM-DD，本地时区） */
function todayKeyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 「每日维护」最近一次执行的日期键（跨天才重新跑；模块级，双实例防重） */
let dailyMaintenanceDay = '';
let dailyMaintenanceRunning = false;

/** 模板「自动应用」当日记录：{ templateId: 'YYYY-MM-DD' }（运行时状态，不进备份/云同步） */
const TPL_AUTO_APPLIED_KEY = 'yiyan_tpl_auto_applied_v1';

/**
 * 每日维护（v3.5.0）：启动 / 回到前台时触发，每天只执行一次。
 * ① 「今日处理」过天自动完成：勾了「今日处理」且未完成的待办，到了第二天
 *    自动标记为已完成（就不用手动划掉）。
 *    判定基准 updatedAt —— 两端 updateTodo 都会强制刷新它，
 *    等价于「最后一次勾选/编辑发生在昨天或更早」；当天再编辑/重新激活、
 *    手动取消勾选都会自然改变判定结果（详情见需求备注）。
 * ② 模板「自动应用」：今天是模板勾选的星期（周1~7 多选）→ 自动把该模板
 *    落到今天；每个模板每天仅生成一次（localStorage 记录去重）。
 */
async function runDailyMaintenance(): Promise<void> {
  const today = todayKeyLocal();
  if (dailyMaintenanceDay === today || dailyMaintenanceRunning) return;
  dailyMaintenanceRunning = true;
  try {
    const db = await getTodoDatabase();
    let todoChanged = false;

    // ① 「今日处理」过天自动完成
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const threshold = todayStart.getTime();
    const all = await db.getAllTodos();
    let completed = 0;
    for (const t of all) {
      if (t.isToday && t.status === 'pending' && !t.deletedAt && t.updatedAt < threshold) {
        try {
          await db.updateTodo(t.id, { status: 'done', completedAt: Date.now() });
          completed++;
        } catch (e) {
          console.warn('[每日维护] 自动完成失败:', t.id, e);
        }
      }
    }
    if (completed > 0) {
      todoChanged = true;
      console.info(`[每日维护] 「今日处理」过天自动完成 ${completed} 条`);
    }

    // ② 模板「自动应用」（今天命中的模板 → 生成到今天的待办）
    try {
      const templates = await db.getAllTemplates();
      let applied: Record<string, string> = {};
      try {
        applied = JSON.parse(localStorage.getItem(TPL_AUTO_APPLIED_KEY) || '{}') || {};
      } catch {
        applied = {};
      }
      let generated = 0;
      let appliedChanged = false;
      for (const tpl of templates) {
        if (!matchesAutoWeekdays(tpl.autoWeekdays)) continue;
        if (applied[tpl.id] === today) continue;
        try {
          await db.importTemplateToDate(tpl.id, today);
          applied[tpl.id] = today;
          appliedChanged = true;
          generated++;
        } catch (e) {
          console.warn('[每日维护] 模板自动应用失败:', tpl.id, e);
        }
      }
      if (appliedChanged) {
        // 顺手清掉非今天的旧记录（防无限增长）
        for (const key of Object.keys(applied)) {
          if (applied[key] !== today) delete applied[key];
        }
        try {
          localStorage.setItem(TPL_AUTO_APPLIED_KEY, JSON.stringify(applied));
        } catch { /* 忽略（记录失败仅会导致下次重复生成，无碍） */ }
      }
      if (generated > 0) {
        todoChanged = true;
        console.info(`[每日维护] 模板自动应用：生成 ${generated} 个模板的今日待办`);
      }
    } catch (e) {
      console.warn('[每日维护] 模板自动应用检查失败:', e);
    }

    if (todoChanged) {
      useTodoStore.getState().refreshAllTodos().catch(() => {});
    }
    dailyMaintenanceDay = today;
  } catch (e) {
    console.warn('[每日维护] 执行失败（下次触发时重试）:', e);
  } finally {
    dailyMaintenanceRunning = false;
  }
}

/**
 * 后台维护任务：过期归档
 * 不阻塞界面显示，启动关键路径之外执行
 */
async function runBackgroundTasks(): Promise<void> {
  // v3.5.0: 每日维护（「今日处理」过天自动完成）
  await runDailyMaintenance();

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
            // v2.13.0: 同步「桌面橱窗」展示计划
            scheduleWidgetSync();
            // v2.13.2: 待办变动即刻同步（订阅 todoStore，防抖推送）
            initTodoAutoSyncSafe();
            // v2.14.0: 转盘小组件盘序同步 + 消费原生转动结果
            scheduleWheelWidgetSync();
            // v3.5.0: 后台维护任务挪到数据加载完成后执行，避免「每日维护」的
            // refreshAllTodos 与 loadAllTodos 竞态（旧数据覆盖自动完成结果）
            if (!backgroundTasksStarted) {
              backgroundTasksStarted = true;
              void runBackgroundTasks();
            }
          });
      } catch (err) {
        console.error('初始化失败:', err);
        setError((err as Error).message);
        setIsReady(true);
      }
    };

    init();
  }, [loadEntriesProgressive, loadTags, loadSettings, loadAllTodos]);

  // v3.5.0: 回到前台时跑「每日维护」——移动端 App 常驻后台，隔天回前台也能触发
  //（跨天判定幂等：当天已执行过则直接跳过）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runDailyMaintenance();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

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

  // v2.13.0: 桌面橱窗——深链（com.yiyan.memorydb://entry/<id>）直达卡片浏览页。
  // 冷启动用 getLaunchUrl 兜底（appUrlOpen 只覆盖热启动）。
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      const { App: CapApp } = await import('@capacitor/app');
      const handleDeepLink = (url: string | null | undefined) => {
        if (!url) return;
        // 记忆卡片：com.yiyan.memorydb://entry/<id> → 卡片浏览页
        const entryMatch = url.match(/\/\/entry\/([^/?#]+)/i);
        if (entryMatch && entryMatch[1]) {
          window.location.hash = `#/entry/${encodeURIComponent(entryMatch[1])}`;
          return;
        }
        // 待办橱窗：com.yiyan.memorydb://todo → 待办页
        if (/\/\/todo\b/i.test(url)) {
          window.location.hash = '#/todo';
          return;
        }
        // 转盘组件：com.yiyan.memorydb://wheel/<id> → 对应转盘页
        const wheelMatch = url.match(/\/\/wheel\/([^/?#]+)/i);
        if (wheelMatch && wheelMatch[1]) {
          window.location.hash = `#/wheel/${encodeURIComponent(wheelMatch[1])}`;
          return;
        }
        // 转盘组件（无 id）：打开首页转盘入口
        if (/\/\/wheel\b/i.test(url)) {
          window.location.hash = '#/wheel';
        }
      };
      try {
        const launch = await CapApp.getLaunchUrl();
        if (!cancelled) handleDeepLink(launch?.url);
      } catch { /* 忽略（web 等平台无此能力） */ }
      try {
        const h = await CapApp.addListener('appUrlOpen', ev => handleDeepLink(ev.url));
        if (cancelled) void h.remove();
        else dispose = () => { void h.remove(); };
      } catch { /* 忽略 */ }
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
