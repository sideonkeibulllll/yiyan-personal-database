/**
 * 「怕了么」主页面
 *
 * Tab「开始」：介绍 + 开始/继续一次调和
 * Tab「回顾」：趋势曲线 + 统计 + 历史列表 + 详情弹层
 *
 * 数据：localStorage（worryDatabase），不进任何备份
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorryRecord, WorryPendingSoul } from '@/types';
import {
  createDraft, deleteWorry, getCompletedWorries, getDraft,
  getPendingSoulUpdate, clearPendingSoulUpdate,
} from '@/services/worryDatabase';
import {
  buildWorryModelOptions, getWorryModelValue, setWorryModelValue,
  getWorryThinking, setWorryThinking, getWorrySoulEnabled, setWorrySoulEnabled,
} from '@/services/worryAI';
import type { WorryThinkingConfig, WorryThinkingEffort } from '@/services/worryAI';
import { useSettingsStore } from '@/stores/settingsStore';
import { BottomNav } from '@/components/BottomNav';
import { TrendChart } from './components/TrendChart';
import { RecordDetail } from './components/RecordDetail';
import { ModelPicker } from './components/ModelPicker';
import './Worry.css';

type Tab = 'use' | 'review';

/** 判断草稿是否「有内容」：空草稿（刚进流程没写字的）不算继续 */
function isMeaningfulDraft(d: WorryRecord | null): d is WorryRecord {
  if (!d) return false;
  return d.content.trim().length > 0 || d.step >= 2;
}

/** 列表里的日期：今天显示时间 / 昨天 / 更早显示日期 */
function formatListDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) {
    return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (ts >= startOfToday - 86400000) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function WorryPage() {
  const navigate = useNavigate();
  const aiConfig = useSettingsStore(s => s.settings.ai);
  const [tab, setTab] = useState<Tab>('use');
  const [draft, setDraft] = useState<WorryRecord | null>(null);
  const [records, setRecords] = useState<WorryRecord[]>([]);
  const [detail, setDetail] = useState<WorryRecord | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  // 模型选择（在「开始」页设置；流程中不可改）
  const [modelValue, setModelValue] = useState(() => getWorryModelValue());
  const modelOptions = useMemo(() => buildWorryModelOptions(aiConfig), [aiConfig]);
  // v3.3.0: 深度思考配置 + 启用 soul 记忆（均在「开始」页设置）
  const [thinking, setThinking] = useState<WorryThinkingConfig>(() => getWorryThinking());
  const [soulEnabled, setSoulEnabled] = useState(() => getWorrySoulEnabled());
  // v3.3.0: 待确认的 Soul 更新建议（AI 挂到本页，确认后才写入）
  const [pendingSoul, setPendingSoul] = useState<WorryPendingSoul | null>(null);
  const updateAIConfig = useSettingsStore(s => s.updateAIConfig);

  const reload = useCallback(async () => {
    const [d, all] = await Promise.all([getDraft(), getCompletedWorries()]);
    setDraft(d);
    setRecords(all);
    setPendingSoul(getPendingSoulUpdate());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 开始新的调和（有旧草稿时先丢弃） */
  const startFresh = useCallback(async () => {
    if (draft) await deleteWorry(draft.id);
    await createDraft();
    setConfirmNew(false);
    navigate('/worries/flow');
  }, [draft, navigate]);

  // ===== v3.3.0：深度思考 / soul 记忆 / 待确认卡 =====

  /** 切换深度思考开关（即改即存，下一次生成生效） */
  const handleToggleThinking = useCallback(() => {
    const next = { ...thinking, enabled: !thinking.enabled };
    setThinking(next);
    setWorryThinking(next);
  }, [thinking]);

  /** 切换思考强度（High / MAX） */
  const handleSetEffort = useCallback((effort: WorryThinkingEffort) => {
    const next = { ...thinking, effort };
    setThinking(next);
    setWorryThinking(next);
  }, [thinking]);

  /** 切换「启用 soul 记忆」 */
  const handleToggleSoul = useCallback(() => {
    const next = !soulEnabled;
    setSoulEnabled(next);
    setWorrySoulEnabled(next);
  }, [soulEnabled]);

  /** 待确认 Soul 更新：同意 → 写入人格档案并清除待确认 */
  const handleAcceptSoul = useCallback(() => {
    if (!pendingSoul) return;
    updateAIConfig({ soul: pendingSoul.content });
    clearPendingSoulUpdate();
    setPendingSoul(null);
  }, [pendingSoul, updateAIConfig]);

  /** 待确认 Soul 更新：保持不变 → 直接清除（不写入，永不更新） */
  const handleDeclineSoul = useCallback(() => {
    clearPendingSoulUpdate();
    setPendingSoul(null);
  }, []);

  const hasDraft = isMeaningfulDraft(draft);
  // 趋势曲线用时间正序、最近 20 次
  const chartRecords = [...records].slice(0, 20).reverse();
  const lastRecord = records[0] || null;
  const avgDrop = records.length > 0
    ? records.reduce((acc, r) => acc + (r.scoreBefore - (r.scoreAfter ?? r.scoreBefore)), 0) / records.length
    : 0;

  return (
    <div className="worry-page">
      <header className="worry-header">
        <h1 className="worry-title">怕了么</h1>
        <p className="worry-slogan">把担心交出来，和它聊两句</p>
      </header>

      {/* 顶部 Tab */}
      <div className="worry-tabs">
        <button className={`worry-tab ${tab === 'use' ? 'active' : ''}`} onClick={() => setTab('use')}>
          开始
        </button>
        <button className={`worry-tab ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}>
          回顾
        </button>
      </div>

      <main className="worry-main">
        {/* ===== 开始 ===== */}
        {tab === 'use' && (
          <div className="worry-use-section">
            {/* v3.3.0: AI 提议的 Soul 档案更新（挂在这里等待确认；确认后才写入） */}
            {pendingSoul && (
              <div className="worry-soul-pending-card">
                <div className="worry-soul-pending-head">AI 想更新你的人格档案</div>
                {pendingSoul.reason && (
                  <p className="worry-soul-pending-reason">理由：{pendingSoul.reason}</p>
                )}
                <details className="worry-soul-pending-details">
                  <summary>查看更新后的全文</summary>
                  <pre className="worry-soul-pending-text">{pendingSoul.content}</pre>
                </details>
                <div className="worry-two-buttons">
                  <button className="worry-btn-secondary" onClick={handleDeclineSoul}>
                    保持不变
                  </button>
                  <button className="worry-btn-primary" onClick={handleAcceptSoul}>
                    同意更新
                  </button>
                </div>
              </div>
            )}

            <div className="worry-intro-card">
              <p className="worry-intro-line">担心的时候，脑子里的画面往往比现实可怕。</p>
              <p className="worry-intro-line">用两个小步骤，帮自己看个清楚——大约只要两分钟。</p>
            </div>

            {/* 模型选择（在此设置好，流程中不可改） */}
            <div className="worry-model-row">
              <span className="worry-model-row-label">使用模型</span>
              <ModelPicker
                options={modelOptions}
                currentValue={modelValue}
                onSelect={v => {
                  setModelValue(v);
                  setWorryModelValue(v);
                }}
              />
            </div>

            {/* v3.3.0: 深度思考开关 + 思考强度（生成时生效，流程中不可改） */}
            <div className="worry-model-row">
              <span className="worry-model-row-label">深度思考</span>
              <button
                type="button"
                role="switch"
                aria-checked={thinking.enabled}
                className={`worry-switch ${thinking.enabled ? 'on' : ''}`}
                onClick={handleToggleThinking}
                title="深度思考模式（更慢但更细致）"
              >
                <span className="worry-switch-knob" />
              </button>
            </div>
            {thinking.enabled && (
              <div className="worry-model-row">
                <span className="worry-model-row-label">思考强度</span>
                <div className="worry-effort-seg">
                  {(['high', 'max'] as const).map(e => (
                    <button
                      key={e}
                      type="button"
                      className={`worry-effort-btn ${thinking.effort === e ? 'active' : ''}`}
                      onClick={() => handleSetEffort(e)}
                    >
                      {e === 'max' ? 'MAX' : 'High'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* v3.3.0: 启用 soul 记忆（注入人格档案；反转牌时 AI 可提议更新） */}
            <div className="worry-model-row">
              <span className="worry-model-row-label">启用 soul 记忆</span>
              <button
                type="button"
                role="switch"
                aria-checked={soulEnabled}
                className={`worry-switch ${soulEnabled ? 'on' : ''}`}
                onClick={handleToggleSoul}
                title="生成时参考你的人格档案"
              >
                <span className="worry-switch-knob" />
              </button>
            </div>
            {soulEnabled && (
              <p className="worry-soul-toggle-hint">
                生成时会参考你的人格档案（在「设置 → AI 配置」里编辑）；反转牌时 AI 可提议更新档案，建议会先挂到本页等你确认。
              </p>
            )}

            {hasDraft ? (
              <>
                <button className="worry-btn-primary worry-btn-big" onClick={() => navigate('/worries/flow')}>
                  继续上次的调和
                </button>
                <p className="worry-draft-hint">
                  {draft.content ? `「${draft.content.slice(0, 20)}${draft.content.length > 20 ? '…' : ''}」` : ''}
                  进行到第 {draft.step} 步
                </p>
                {confirmNew ? (
                  <div className="worry-confirm-row">
                    <span className="worry-confirm-text">放弃上一次，重新开始？</span>
                    <button className="worry-btn-danger" onClick={() => void startFresh()}>确认</button>
                    <button className="worry-btn-ghost" onClick={() => setConfirmNew(false)}>取消</button>
                  </div>
                ) : (
                  <button className="worry-btn-ghost" onClick={() => setConfirmNew(true)}>
                    重新开始
                  </button>
                )}
              </>
            ) : (
              <button className="worry-btn-primary worry-btn-big" onClick={() => void startFresh()}>
                开始一次调和
              </button>
            )}

            {records.length > 0 && (
              <p className="worry-use-stats">
                已完成 {records.length} 次
                {lastRecord && ` · 最近一次 ${lastRecord.scoreBefore} → ${lastRecord.scoreAfter ?? '—'}`}
              </p>
            )}
          </div>
        )}

        {/* ===== 回顾 ===== */}
        {tab === 'review' && (
          <div className="worry-review-section">
            {records.length === 0 ? (
              <div className="worry-empty">
                <p>完成第一次调和后，</p>
                <p>这里会长出一条温柔的趋势。</p>
              </div>
            ) : (
              <>
                <div className="worry-chart-card">
                  <TrendChart records={chartRecords} />
                  {records.length >= 2 && (
                    <p className="worry-chart-stats">
                      共 {records.length} 次 · 平均下降 {avgDrop.toFixed(1)} 分
                    </p>
                  )}
                </div>

                <div className="worry-list">
                  {records.map(r => (
                    <button key={r.id} className="worry-list-item" onClick={() => setDetail(r)}>
                      <div className="worry-list-top">
                        <span className="worry-list-date">{formatListDate(r.updatedAt)}</span>
                        <span className="worry-list-score">
                          <i className="before">{r.scoreBefore}</i>
                          <span className="worry-list-arrow">→</span>
                          <i className="after">{r.scoreAfter ?? '—'}</i>
                        </span>
                      </div>
                      <p className="worry-list-content">{r.content}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <BottomNav />

      {/* 详情弹层 */}
      <RecordDetail
        record={detail}
        onClose={() => setDetail(null)}
        onDelete={id => {
          void (async () => {
            await deleteWorry(id);
            setDetail(null);
            await reload();
          })();
        }}
      />
    </div>
  );
}
