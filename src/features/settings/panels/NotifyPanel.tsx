/**
 * 设置面板 - 记忆来信（主动触达，v2.12.0）
 *
 * 独立性声明：
 *  - 本面板是 services/notifyService 门面在 UI 层的唯一消费方；
 *  - 配置写入统一经 settingsStore.updateNotifyConfig（禁止直写 settings）；
 *  - 权限 / 排程 / 试发等动作全部经 notifyService 导出函数完成，不直接触碰插件。
 *
 * 未来扩展（AI 写信人格、时间胶囊等）：新配置字段加进 NotifySettings（types），
 * 本面板与 notifyService 同步消费；样式一律进 NotifyPanel.css。
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  isNotifySupported,
  getNotifyPermission,
  requestNotifyPermission,
  applySettings,
  testFireOnce,
  cancelAll,
  getExactAlarmSetting,
  openExactAlarmSetting,
} from '@/services/notifyService';
import type { NotifyPermission } from '@/services/notifyService';
import './NotifyPanel.css';

interface NotifyPanelProps {
  markDirty: (field: string) => void;
}

export function NotifyPanel({ markDirty }: NotifyPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateNotifyConfig = useSettingsStore(state => state.updateNotifyConfig);
  const cfg = settings.notify;
  const supported = isNotifySupported();

  const [permission, setPermission] = useState<NotifyPermission>('prompt');
  const [exactAlarm, setExactAlarm] = useState<'granted' | 'denied' | 'unsupported'>('unsupported');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<number | null>(null);
  const rescheduleTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  /** 刷新权限状态显示 */
  const refreshPerm = useCallback(async () => {
    if (!supported) return;
    const p = await getNotifyPermission();
    setPermission(p);
    const ea = await getExactAlarmSetting();
    setExactAlarm(ea);
  }, [supported]);

  useEffect(() => {
    void refreshPerm();
  }, [refreshPerm]);

  // 卸载时清理计时器
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (rescheduleTimerRef.current !== null) window.clearTimeout(rescheduleTimerRef.current);
  }, []);

  /** 配置变更后的自动重排（防抖：避免数字输入连击触发多次） */
  const scheduleAutoReschedule = useCallback(() => {
    if (rescheduleTimerRef.current !== null) window.clearTimeout(rescheduleTimerRef.current);
    rescheduleTimerRef.current = window.setTimeout(() => {
      rescheduleTimerRef.current = null;
      const cur = useSettingsStore.getState().settings.notify;
      if (!cur.enabled) return;
      void applySettings().then(res => {
        if (res.ok) showToast('已按新设置重新排程');
      });
    }, 900);
  }, [showToast]);

  /** 总开关 */
  const handleToggle = useCallback(async () => {
    if (busy) return;
    if (cfg.enabled) {
      // 关闭：清空排程
      updateNotifyConfig({ enabled: false });
      await cancelAll();
      showToast('已关闭，排程已清空');
      return;
    }
    // 开启：置开启 → 走权限 + 重排；失败则还原
    setBusy(true);
    try {
      updateNotifyConfig({ enabled: true });
      const res = await applySettings();
      await refreshPerm();
      showToast(res.message);
      if (!res.ok) updateNotifyConfig({ enabled: false });
    } finally {
      setBusy(false);
    }
  }, [busy, cfg.enabled, updateNotifyConfig, refreshPerm, showToast]);

  /** 参数修改：写配置 + （已开启时）自动重排 */
  const patchConfig = useCallback((
    patch: Partial<typeof cfg>,
    field: string,
  ) => {
    updateNotifyConfig(patch);
    markDirty(field);
    if (cfg.enabled) scheduleAutoReschedule();
  }, [cfg.enabled, updateNotifyConfig, markDirty, scheduleAutoReschedule]);

  /** 立即试一发 */
  const handleTestFire = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await testFireOnce();
      showToast(res.message);
      await refreshPerm();
    } finally {
      setBusy(false);
    }
  }, [busy, refreshPerm, showToast]);

  /** 权限按钮 */
  const handleRequestPerm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const granted = await requestNotifyPermission();
      await refreshPerm();
      showToast(granted ? '已获得通知权限' : '未获得权限，请在系统设置中允许');
    } finally {
      setBusy(false);
    }
  }, [busy, refreshPerm, showToast]);

  /** 精确闹钟引导（可选） */
  const handleOpenExact = useCallback(async () => {
    await openExactAlarmSetting();
    await refreshPerm();
  }, [refreshPerm]);

  const permissionText =
    permission === 'granted' ? '已授权'
      : permission === 'denied' ? '被拒绝（请到系统设置开启）'
        : permission === 'prompt' ? '未授权'
          : '不支持';

  /* ── 非安卓端降级 ── */
  if (!supported) {
    return (
      <div className="settings-panel-content">
        <h2 className="panel-title">记忆来信</h2>
        <div className="form-hint">
          让沉睡的记忆自己来敲门——在设定时间段内挑一个说不准的时刻，把一张卡送进通知栏。
        </div>
        <div className="notify-unsupported">
          当前设备不支持记忆来信（仅安卓手机可用）。
          <br />
          在电脑端或网页端，它会安静地待命。
        </div>
      </div>
    );
  }

  const windowValid = cfg.windowEnd > cfg.windowStart;

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">记忆来信</h2>
      <div className="form-hint">
        让沉睡的记忆自己来敲门——在你设定的时间段里，挑一个说不准的时刻把一张卡送进通知栏。
        点开通知会直接进入这张卡的浏览页。
      </div>

      {/* 总开关 */}
      <div className="form-group">
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={cfg.enabled}
            disabled={busy}
            onChange={() => { void handleToggle(); }}
          />
          <span>启用记忆来信</span>
        </label>
        <span className="form-hint">
          默认关闭；开启时才会请求系统通知权限。关闭后，已排的通知会全部清空。
        </span>
      </div>

      {cfg.enabled && (
        <>
          {/* 时间窗口 */}
          <div className="form-group">
            <label className="form-label">投递时间窗口</label>
            <div className="notify-window-row">
              <input
                type="number"
                className="form-input glass notify-window-input"
                min={0}
                max={23}
                step={1}
                value={cfg.windowStart}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!Number.isNaN(v)) patchConfig({ windowStart: Math.max(0, Math.min(23, v)) }, 'notify.windowStart');
                }}
              />
              <span className="notify-window-sep">点 ~</span>
              <input
                type="number"
                className="form-input glass notify-window-input"
                min={1}
                max={24}
                step={1}
                value={cfg.windowEnd}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!Number.isNaN(v)) patchConfig({ windowEnd: Math.max(1, Math.min(24, v)) }, 'notify.windowEnd');
                }}
              />
              <span className="notify-window-sep">点之间</span>
            </div>
            <span className="form-hint">
              每天在这个时间段里随机挑时刻（例如 10 点 ~ 22 点）；今天窗口已过就等明天。
            </span>
            {!windowValid && (
              <span className="notify-warn">结束时间需要晚于开始时间</span>
            )}
          </div>

          {/* 每天条数 */}
          <div className="form-group">
            <label className="form-label">每天投递条数</label>
            <input
              type="number"
              className="form-input glass notify-window-input"
              min={1}
              max={3}
              step={1}
              value={cfg.dailyCount}
              onChange={e => {
                const v = parseInt(e.target.value);
                if (!Number.isNaN(v)) patchConfig({ dailyCount: Math.max(1, Math.min(3, v)) }, 'notify.dailyCount');
              }}
            />
            <span className="form-hint">1 ~ 3 条；同一天出的卡不会重复，最近通知过的卡也会优先避开。</span>
          </div>

          {/* 试一发 */}
          <div className="form-group">
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => { void handleTestFire(); }}
              disabled={busy}
            >
              {busy ? '处理中…' : '立即试一发（3 秒后到）'}
            </button>
            <span className="form-hint">预览效果：随机挑一张卡，3 秒后放进通知栏，点它可直接跳到那张卡。</span>
          </div>

          {/* 权限状态 */}
          <div className="form-group">
            <label className="form-label">权限状态</label>
            <div className="notify-perm-row">
              <span className="notify-perm-text">通知权限：{permissionText}</span>
              {permission !== 'granted' && (
                <button type="button" className="settings-link-btn" onClick={() => { void handleRequestPerm(); }} disabled={busy}>
                  去授权
                </button>
              )}
            </div>
            {exactAlarm === 'denied' && (
              <div className="notify-perm-row">
                <span className="notify-perm-text">精确提醒：未开启（不精确也能用，时间可能差几分钟）</span>
                <button type="button" className="settings-link-btn" onClick={() => { void handleOpenExact(); }}>
                  去开启
                </button>
              </div>
            )}
            <span className="form-hint">
              如果通知不按时到达：请在系统设置里允许「记忆库」自启动 / 后台运行（部分手机需要）。
            </span>
          </div>
        </>
      )}

      {/* 轻提示 */}
      {toast && <div className="notify-toast">{toast}</div>}
    </div>
  );
}
