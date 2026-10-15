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
import type { WorryRecord } from '@/types';
import { createDraft, deleteWorry, getCompletedWorries, getDraft } from '@/services/worryDatabase';
import { buildWorryModelOptions, getWorryModelValue, setWorryModelValue } from '@/services/worryAI';
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

  const reload = useCallback(async () => {
    const [d, all] = await Promise.all([getDraft(), getCompletedWorries()]);
    setDraft(d);
    setRecords(all);
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
