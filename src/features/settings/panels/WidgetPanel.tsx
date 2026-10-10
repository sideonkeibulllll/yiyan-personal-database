/**
 * 设置面板 - 桌面橱窗（v2.13.0）
 *
 * 独立性声明：本面板经 services/widgetService 门面完成同步 / 重绘 / 状态查询，不直接触碰原生插件。
 * 配置项：展示候选范围（settings.widget.filter，v2.14.0）；
 * 各组件样式在独立面板 WidgetStylePanel（v2.15.0）。样式一律进 WidgetPanel.css。
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  isWidgetSupported,
  syncAll,
  getWidgetStatus,
  refreshWidgetViews,
  syncWidgetPlan,
} from '@/services/widgetService';
import { useSettingsStore } from '@/stores/settingsStore';
import { WIDGET_PLAN_COUNT } from '@/utils/widgetPlan';
import type { TodoSnapshot, WidgetPlan } from '@/utils/widgetPlan';
import { EntryFilterPanel } from '@/components/EntryFilterPanel/EntryFilterPanel';
import { countActiveFilters, isFilterActive, sanitizeEntryFilter } from '@/utils/entryFilterState';
import type { EntryFilterState } from '@/utils/entryFilterState';
import './WidgetPanel.css';

interface WidgetPanelProps {
  markDirty: (field: string) => void;
}

/** 时间格式化 YYYY-MM-DD HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function WidgetPanel({ markDirty }: WidgetPanelProps) {
  // 本面板的 filter 变更通过 updateWidgetConfig 持久化 + 自动重排
  void markDirty;
  const settings = useSettingsStore(state => state.settings);
  const updateWidgetConfig = useSettingsStore(state => state.updateWidgetConfig);
  const supported = isWidgetSupported();

  const [busy, setBusy] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [baseCount, setBaseCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [plan, setPlan] = useState<WidgetPlan | null>(null);
  const [todoSnapshot, setTodoSnapshot] = useState<TodoSnapshot | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const rescheduleTimerRef = useRef<number | null>(null);

  /** 空筛选（清除筛选时写入） */
  const EMPTY_FILTER: EntryFilterState = { tagIds: [], starred: undefined, timeRange: {} };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const refreshStatus = useCallback(async () => {
    const st = await getWidgetStatus();
    setBaseCount(st.baseCount);
    setRefreshCount(st.refreshCount);
    setTodoCount(st.todoCount);
    setPlan(st.plan);
    setTodoSnapshot(st.todoSnapshot);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (rescheduleTimerRef.current !== null) window.clearTimeout(rescheduleTimerRef.current);
  }, []);

  const handleSync = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await syncAll(true);
      showToast(res.message);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [busy, showToast, refreshStatus]);

  const handleRefreshViews = useCallback(async () => {
    if (busy) return;
    await refreshWidgetViews();
    showToast('已通知橱窗重绘');
  }, [busy, showToast]);

  /** 当橱窗的展示候选筛选（标签 / 时间 / 星标，与记忆来信同语义） */
  const currentFilter: EntryFilterState = useMemo(
    () => sanitizeEntryFilter(settings.widget.filter),
    [settings.widget.filter],
  );

  /**
   * 筛选变更：写配置 + 防抖触发 force 重排（不跳过余量）。
   * ⚠️ 与记忆来信筛选**各自独立**：这里进 settings（会云备份），记忆来信也进 settings。
   */
  const patchFilter = useCallback((next: EntryFilterState) => {
    updateWidgetConfig({ filter: next });
    if (rescheduleTimerRef.current !== null) window.clearTimeout(rescheduleTimerRef.current);
    setFilterBusy(true);
    rescheduleTimerRef.current = window.setTimeout(() => {
      rescheduleTimerRef.current = null;
      void syncWidgetPlan(true).then(res => {
        setFilterBusy(false);
        showToast(res.message);
        void refreshStatus();
      });
    }, 900);
  }, [updateWidgetConfig, showToast, refreshStatus]);

  /* ── 非安卓端降级 ── */
  if (!supported) {
    return (
      <div className="settings-panel-content">
        <h2 className="panel-title">桌面橱窗</h2>
        <div className="form-hint">
          把一张记忆卡片放到主屏幕——不打开应用，也能瞥见过去存下的东西。
        </div>
        <div className="widget-unsupported">
          当前设备不支持桌面橱窗（仅安卓手机可用）。
          <br />
          在电脑端或网页端，它会安静地待命。
        </div>
      </div>
    );
  }

  const totalWidgets = baseCount + refreshCount + todoCount;
  const planCount = plan ? plan.items.length : 0;

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">桌面橱窗</h2>
      <div className="form-hint">
        把一张记忆卡片放到主屏幕——不打开应用，也能瞥见过去存下的东西。
        每天打开应用时换成新的一批（10 条），点「换一张」可翻看；点一下直达那张卡的浏览页。
      </div>

      {/* 当前状态 */}
      <div className="form-group">
        <label className="form-label">当前状态</label>
        <div className="widget-status">
          <div className="widget-status-row">
            <span>桌面上的橱窗</span>
            <span>
              {totalWidgets > 0
                ? `${totalWidgets} 个（卡片 ${baseCount} · 换一张 ${refreshCount} · 待办 ${todoCount}）`
                : '还没有添加'}
            </span>
          </div>
          <div className="widget-status-row">
            <span>展示计划</span>
            <span>
              {plan
                ? `${planCount} 条 · 生成于 ${formatTime(plan.generatedAt)}`
                : '暂无（打开应用会自动生成）'}
            </span>
          </div>
          <div className="widget-status-row">
            <span>待办快照</span>
            <span>
              {todoSnapshot
                ? `今天 ${todoSnapshot.views.today.total} · 有期 ${todoSnapshot.views.timed.total} · 无期 ${todoSnapshot.views.untimed.total} · ${formatTime(todoSnapshot.generatedAt)}`
                : '暂无（打开应用会自动同步）'}
            </span>
          </div>
        </div>
      </div>

      {/* 操作 */}
      <div className="form-group">
        <button
          type="button"
          className="settings-link-btn"
          onClick={() => { void handleSync(); }}
          disabled={busy}
        >
          {busy ? '同步中…' : `立即同步（重排今日 ${WIDGET_PLAN_COUNT} 条计划 + 待办快照）`}
        </button>
        {totalWidgets > 0 && (
          <button
            type="button"
            className="settings-link-btn widget-btn-gap"
            onClick={() => { void handleRefreshViews(); }}
            disabled={busy}
          >
            通知橱窗立即重绘
          </button>
        )}
        <span className="form-hint">打开应用时会自动补排（余量充足时跳过，避免无谓改写）。</span>
      </div>

      {/* 添加引导 */}
      <div className="form-group">
        <label className="form-label">把它摆上桌面</label>
        <ol className="widget-guide">
          <li>长按桌面空白处，选择「卡片」（部分机型叫「小组件」）</li>
          <li>找到「记忆库」，选择「记忆卡片」「记忆卡片 · 换一张」或「待办清单」</li>
          <li>拖到桌面合适的位置即可</li>
        </ol>
        <span className="form-hint">
          卡片不刷新？到 设置 → 应用管理 → 记忆库，允许「自启动 / 后台运行」，
          并把电池策略设为「无限制」（部分手机需要）。
        </span>
      </div>

      {/* v2.14.0: 展示候选范围（标签 / 时间 / 星标，与记忆来信同一套 UI 与语义） */}
      <div className="form-group">
        <div className="widget-filter-head">
          <label className="form-label">展示候选范围</label>
          {isFilterActive(currentFilter) && (
            <span className="widget-filter-badge">
              已筛选 {countActiveFilters(currentFilter)} 项
              <button type="button" onClick={() => patchFilter({ ...EMPTY_FILTER })}>清除</button>
            </span>
          )}
        </div>
        <EntryFilterPanel
          inline
          value={currentFilter}
          onChange={patchFilter}
        />
        <span className="form-hint">
          限定哪些卡可以被选为橱窗展示；不筛选就是全部卡片都可能被选到。
          {isFilterActive(currentFilter) && (
            <>
              <br />
              <strong>注意</strong>：改完会立刻按新范围重排；若无卡符合条件，橱窗暂不换卡。
            </>
          )}
        </span>
        {filterBusy && <span className="form-hint">正在按新范围重排…</span>}
      </div>

      {/* 自动刷新设置 */}
      <div className="form-group">
        <label className="form-label">每天自动刷新次数</label>
        <input
          type="number"
          className="form-input glass notify-window-input"
          min={1}
          max={10}
          step={1}
          value={settings.widget.dailyAutoRefresh ?? 3}
          onChange={e => {
            const v = parseInt(e.target.value);
            if (!Number.isNaN(v)) updateWidgetConfig({ dailyAutoRefresh: Math.max(1, Math.min(10, v)) });
          }}
        />
        <span className="form-hint">
          1 ~ 10 次；把全天均分 N 段，到点后桌面卡片自动换到下一张（系统每 30 分钟检查一次）。手动点「换一张」仍可随时翻看。
        </span>
      </div>

      {/* 轻提示 */}
      {toast && <div className="widget-toast">{toast}</div>}
    </div>
  );
}
