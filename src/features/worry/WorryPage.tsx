/**
 * 「怕了么」主页面（v5）
 *
 * 结构：44px 返回条 → 一张脸（38px 未处理条数 + 一行小字 + 发丝进度）→ 清单 → 底部拇指区
 * - 「清单 / 趋势」是一枚分段小开关，不再占一整条 Tab
 * - 每条担忧：左侧 22px 圆点是「这次真的轻了没有」的记号，右侧内容 + 时间
 * - 模型 / 深度思考 / soul 记忆收进右上 ⋯ 的抽屉，首屏不再是一张表单
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
import { applySoulChanges } from '@/services/soulFacts';
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
  /** 右上 ⋯：把模型 / 深度思考 / soul 收进抽屉 */
  const [showSettings, setShowSettings] = useState(false);
  // 模型选择（在「开始」页设置；流程中不可改）
  const [modelValue, setModelValue] = useState(() => getWorryModelValue());
  const modelOptions = useMemo(() => buildWorryModelOptions(aiConfig), [aiConfig]);
  // v3.3.0: 深度思考配置 + 启用 soul 记忆（均在「开始」页设置）
  const [thinking, setThinking] = useState<WorryThinkingConfig>(() => getWorryThinking());
  const [soulEnabled, setSoulEnabled] = useState(() => getWorrySoulEnabled());
  // v3.3.0: 待确认的 Soul 变更建议（AI 挂到本页，确认后才写入；v3.4.0 结构化变更组）
  const [pendingSoul, setPendingSoul] = useState<WorryPendingSoul | null>(null);

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

  /** 待确认 Soul 变更：同意 → 应用到事实库并清除待确认 */
  const handleAcceptSoul = useCallback(() => {
    if (!pendingSoul) return;
    applySoulChanges(pendingSoul.changes, 'ai');
    clearPendingSoulUpdate();
    setPendingSoul(null);
  }, [pendingSoul]);

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

  /** 还压在清单里的：一次进行中的调和 + 已经聊过的 */
  const pendingCount = records.length + (hasDraft ? 1 : 0);

  return (
    <div className="worry-page">
      {/* 44px 返回条 */}
      <header className="worry-bar">
        <button className="worry-bar-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="worry-bar-title">怕了么</span>
        <button
          className="worry-bar-btn"
          onClick={() => setShowSettings(true)}
          aria-label="调和设置"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* 设置抽屉 */}
      {showSettings && (
        <>
          <div className="worry-sheet-mask" onClick={() => setShowSettings(false)} />
          <div className="worry-sheet">
            <span className="worry-sheet-grip" />
            <div className="worry-sheet-head">
              <span className="worry-sheet-title">这一次怎么聊</span>
              <button className="worry-sheet-done" onClick={() => setShowSettings(false)}>好了</button>
            </div>
            <div className="worry-sheet-body">
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
                <span className="worry-model-row-label">引用 soul 记忆</span>
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
            </div>
          </div>
        </>
      )}

      <main className="worry-main">
        {/* 一张脸：38px 未处理条数 + 一行小字 + 发丝进度 */}
        <section className="worry-face">
          <div className="worry-face-top">
            <span className="worry-face-num">{pendingCount}</span>
            <span className="worry-face-meta">件还在心里</span>
          </div>
          <p className="worry-face-sub">
            {records.length > 0
              ? `聊过 ${records.length} 次${lastRecord ? ` · 最近 ${lastRecord.scoreBefore} → ${lastRecord.scoreAfter ?? '—'}` : ''}`
              : '还没聊过。担心的时候，来这儿把它摊开看看。'}
          </p>
          <span className="worry-face-line">
            <i style={{ width: `${Math.min(100, Math.round((avgDrop / 10) * 100))}%` }} />
          </span>
        </section>

        {/* 清单 / 趋势 分段开关 */}
        <div className="worry-seg" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'use'}
            className={`worry-seg-btn ${tab === 'use' ? 'on' : ''}`}
            onClick={() => setTab('use')}
          >
            清单
          </button>
          <button
            role="tab"
            aria-selected={tab === 'review'}
            className={`worry-seg-btn ${tab === 'review' ? 'on' : ''}`}
            onClick={() => setTab('review')}
          >
            趋势
          </button>
        </div>

        {/* ===== 清单 ===== */}
        {tab === 'use' && (
          <div className="worry-use-section">
            {/* v3.3.0: AI 提议的 Soul 档案更新（挂在这里等待确认；确认后才写入） */}
            {pendingSoul && (
              <div className="worry-soul-pending-card">
                <div className="worry-soul-pending-head">AI 想更新你的事实档案</div>
                {pendingSoul.reason && (
                  <p className="worry-soul-pending-reason">理由：{pendingSoul.reason}</p>
                )}
                <div className="worry-soul-pending-changes">
                  {pendingSoul.changes.add.map((c, i) => (
                    <div key={`add-${i}`} className="worry-soul-pending-line add">＋ {c.content}</div>
                  ))}
                  {pendingSoul.changes.update.map((c, i) => (
                    <div key={`upd-${i}`} className="worry-soul-pending-line">～ {c.content}</div>
                  ))}
                  {pendingSoul.changes.retire.map((c, i) => (
                    <div key={`ret-${i}`} className="worry-soul-pending-line retire">
                      － {c.matchText || c.factId || '（未知条目）'}
                    </div>
                  ))}
                </div>
                <div className="worry-two-buttons">
                  <button className="worry-btn-ghost" onClick={handleDeclineSoul}>
                    保持不变
                  </button>
                  <button className="worry-btn-primary worry-btn-inline" onClick={handleAcceptSoul}>
                    同意更新
                  </button>
                </div>
              </div>
            )}

            <div className="worry-list">
              {hasDraft && (
                <button
                  className="worry-row is-live s-item"
                  onClick={() => navigate('/worries/flow')}
                >
                  <span className="worry-row-mark is-live" aria-hidden>
                    <i />
                  </span>
                  <span className="worry-row-body">
                    <span className="worry-row-text">
                      {draft.content.trim() || '还没写下担心的那件事'}
                    </span>
                    <span className="worry-row-meta">进行到第 {draft.step} 步 · 点一下接着聊</span>
                  </span>
                </button>
              )}

              {records.map(r => {
                const eased = r.scoreAfter !== null && r.scoreAfter < r.scoreBefore;
                return (
                  <button
                    key={r.id}
                    className="worry-row s-item"
                    onClick={() => setDetail(r)}
                  >
                    <span className={`worry-row-mark ${eased ? 'is-done' : ''}`} aria-hidden>
                      {eased && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="worry-row-body">
                      <span className="worry-row-text">{r.content}</span>
                      <span className="worry-row-meta">
                        {formatListDate(r.updatedAt)} · {r.scoreBefore} → {r.scoreAfter ?? '—'}
                      </span>
                    </span>
                  </button>
                );
              })}

              {!hasDraft && records.length === 0 && (
                <div className="s-empty">
                  <b>心里是空的</b>
                  <span>真有事压着的时候，再来也不迟。</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 趋势 ===== */}
        {tab === 'review' && (
          <div className="worry-review-section">
            {records.length === 0 ? (
              <div className="s-empty">
                <b>还没有一条线</b>
                <span>完成第一次调和后，这里会长出一条趋势。</span>
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
                    <button key={r.id} className="worry-row s-item" onClick={() => setDetail(r)}>
                      <span className="worry-row-mark is-score" aria-hidden>
                        {r.scoreAfter ?? '—'}
                      </span>
                      <span className="worry-row-body">
                        <span className="worry-row-text">{r.content}</span>
                        <span className="worry-row-meta">
                          {formatListDate(r.updatedAt)} · {r.scoreBefore} → {r.scoreAfter ?? '—'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* 底部拇指区：一处主按钮，一处文字按钮 */}
      <div className="worry-dock">
        {confirmNew ? (
          <div className="worry-confirm-row">
            <span className="worry-confirm-text">放弃上一次，重新开始？</span>
            <button className="worry-btn-danger" onClick={() => void startFresh()}>确认</button>
            <button className="worry-btn-ghost worry-btn-inline" onClick={() => setConfirmNew(false)}>取消</button>
          </div>
        ) : (
          <>
            {hasDraft ? (
              <button
                className="worry-btn-primary worry-btn-big"
                onClick={() => navigate('/worries/flow')}
              >
                继续上次的调和
              </button>
            ) : (
              <button
                className="worry-btn-primary worry-btn-big"
                onClick={() => void startFresh()}
              >
                开始一次调和
              </button>
            )}
            {hasDraft && (
              <button className="worry-dock-text" onClick={() => setConfirmNew(true)}>
                重新开始一次
              </button>
            )}
          </>
        )}
      </div>

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
