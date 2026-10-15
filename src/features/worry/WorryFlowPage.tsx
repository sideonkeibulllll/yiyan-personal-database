/**
 * 「怕了么」6 步引导流程页
 *
 * 步骤：
 * 1 写下担心 → 2 初始打分 → 3 三种结局（AI 生成 + 逐张翻开）
 * → 4 概率校准（归一化）→ 5 反转牌（生「我仍然担心」分支）→ 6 再打分 + 总结
 *
 * 特性：
 * - 每步推进即写 localStorage 草稿（断点续接）
 * - AI 流式生成：显示「已生成字数」实时反馈 + 温柔文案轮换
 * - 模型在「开始」页选择（流程中不可改，防中途切换）
 * - AI 失败兜底：重试 / 手动填写
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorryOutcome, WorryOutcomeType, WorryRecord } from '@/types';
import { createDraft, getDraft, saveWorry, savePendingSoulUpdate } from '@/services/worryDatabase';
import { generateFlipPoints, generateOutcomes } from '@/services/worryAI';
import { ScoreSlider } from './components/ScoreSlider';
import { OutcomeCards } from './components/OutcomeCards';
import { ProbBars } from './components/ProbBars';
import { buildContinueChatDraft, clampInt, normalizeProbs } from './utils';
import './Worry.css';

type Phase = 1 | 2 | 3 | 4 | 5 | 6;

/** 步 3 生成等待文案（2.5s 轮换，最后一句停留） */
const OUTCOME_LOADING_TEXTS = [
  '正在帮你想想可能的结局…',
  '慢慢来，不着急…',
  '在认真理解你的担心…',
  '就快好了…',
];

/** 步 5 反转牌生成等待文案 */
const FLIP_LOADING_TEXTS = [
  '正在帮你换个角度…',
  '换一双眼睛看这件事…',
  '就快好了…',
];

/** 等待文案轮换间隔 */
const LOADING_TEXT_INTERVAL_MS = 2500;

/** 返回箭头 */
const BackIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

export function WorryFlowPage() {
  const navigate = useNavigate();

  const [record, setRecord] = useState<WorryRecord | null>(null);
  const [phase, setPhase] = useState<Phase>(1);
  const [booting, setBooting] = useState(true);

  // 步 1 输入
  const [contentInput, setContentInput] = useState('');
  // 步 2 / 6 分数
  const [scoreBefore, setScoreBefore] = useState(1);
  const [scoreAfter, setScoreAfter] = useState(1);
  // 步 3 生成状态
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  // 步 5 反转牌
  const [flipGenerating, setFlipGenerating] = useState(false);
  const [flipError, setFlipError] = useState<string | null>(null);
  const [flipRevealed, setFlipRevealed] = useState(false);
  // v3.3.0: 本次反转牌生成是否附带 Soul 更新建议（已挂到主页待确认）
  const [soulCaptured, setSoulCaptured] = useState(false);
  // 步 6 总结子态
  const [showSummary, setShowSummary] = useState(false);
  // 生成反馈：已生成字数（100ms 节流）+ 等待文案轮换
  const [genCharCount, setGenCharCount] = useState(0);
  const [flipCharCount, setFlipCharCount] = useState(0);
  const [loadingTextIdx, setLoadingTextIdx] = useState(0);
  const [flipLoadingTextIdx, setFlipLoadingTextIdx] = useState(0);
  const progressLastRef = useRef(0);

  const initRef = useRef(false);

  // ===== 初始化：加载草稿（无则新建）=====
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void (async () => {
      try {
        let d = await getDraft();
        if (!d) {
          d = await createDraft();
        }
        setRecord(d);
        setContentInput(d.content);
        setScoreBefore(d.scoreBefore >= 1 ? d.scoreBefore : 1);
        setScoreAfter(d.scoreAfter ?? 1);
        const p = clampInt(d.step, 1, 6) as Phase;
        setPhase(p);
        // 手填模式恢复：存在「未确认且文本为空」的卡
        if (d.outcomes.some(o => !o.confirmed && o.text.trim() === '')) {
          setManualMode(true);
        }
        // 已打过结束分 → 直接展示总结
        if (p === 6 && d.scoreAfter !== null) {
          setShowSummary(true);
        }
      } catch (e) {
        console.error('[WorryFlow] 初始化失败:', e);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  /** 更新并保存记录（可同时推进步骤） */
  const updateRecord = useCallback(async (patch: Partial<WorryRecord>, nextPhase?: Phase) => {
    if (!record) return;
    const next: WorryRecord = {
      ...record,
      ...patch,
      ...(nextPhase ? { step: nextPhase } : {}),
    };
    setRecord(next);
    if (nextPhase) setPhase(nextPhase);
    await saveWorry(next);
  }, [record]);

  /** 流式进度：已生成字数（100ms 节流，防高频重渲染） */
  const handleGenProgress = useCallback((chars: number) => {
    const now = Date.now();
    if (now - progressLastRef.current >= 100) {
      progressLastRef.current = now;
      setGenCharCount(chars);
    }
  }, []);

  const handleFlipProgress = useCallback((chars: number) => {
    const now = Date.now();
    if (now - progressLastRef.current >= 100) {
      progressLastRef.current = now;
      setFlipCharCount(chars);
    }
  }, []);

  // 等待文案轮换（生成中每 2.5s 换一句，最后一句停留）
  useEffect(() => {
    if (!generating) {
      setLoadingTextIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setLoadingTextIdx(i => Math.min(i + 1, OUTCOME_LOADING_TEXTS.length - 1));
    }, LOADING_TEXT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (!flipGenerating) {
      setFlipLoadingTextIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setFlipLoadingTextIdx(i => Math.min(i + 1, FLIP_LOADING_TEXTS.length - 1));
    }, LOADING_TEXT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flipGenerating]);

  // ===== 步 3：AI 生成三种结局 =====
  const runGenerate = useCallback(async () => {
    if (!record) return;
    setGenerating(true);
    setGenError(null);
    setGenCharCount(0);
    progressLastRef.current = 0;
    try {
      const r = await generateOutcomes(record.content, handleGenProgress);
      const outcomes: WorryOutcome[] = [
        { type: 'worst', text: r.worst, rawProb: 50, confirmed: false },
        { type: 'best', text: r.best, rawProb: 50, confirmed: false },
        { type: 'normal', text: r.normal, rawProb: 50, confirmed: false },
      ];
      await updateRecord({ outcomes });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }, [record, updateRecord, handleGenProgress]);

  // 进入步 3 且尚未生成时自动触发生成
  useEffect(() => {
    if (booting || phase !== 3 || !record) return;
    if (record.outcomes.length > 0) return;
    if (generating || genError || manualMode) return;
    void runGenerate();
  }, [booting, phase, record, generating, genError, manualMode, runGenerate]);

  /** 手动填写兜底 */
  const startManual = useCallback(() => {
    setManualMode(true);
    setGenError(null);
    void updateRecord({
      outcomes: [
        { type: 'worst', text: '', rawProb: 50, confirmed: false },
        { type: 'best', text: '', rawProb: 50, confirmed: false },
        { type: 'normal', text: '', rawProb: 50, confirmed: false },
      ],
    });
  }, [updateRecord]);

  /** 确定某张卡 */
  const handleConfirmCard = useCallback((type: WorryOutcomeType, prob: number, text?: string) => {
    if (!record) return;
    const outcomes = record.outcomes.map(o =>
      o.type === type
        ? { ...o, rawProb: prob, confirmed: true, ...(text !== undefined ? { text } : {}) }
        : o,
    );
    void updateRecord({ outcomes });
  }, [record, updateRecord]);

  // ===== 步 4：归一化 =====
  useEffect(() => {
    if (booting || phase !== 4 || !record) return;
    if (record.normalizedProbs) return;
    const raw = {
      worst: record.outcomes.find(o => o.type === 'worst')?.rawProb ?? 0,
      normal: record.outcomes.find(o => o.type === 'normal')?.rawProb ?? 0,
      best: record.outcomes.find(o => o.type === 'best')?.rawProb ?? 0,
    };
    void updateRecord({ normalizedProbs: normalizeProbs(raw) });
  }, [booting, phase, record, updateRecord]);

  // ===== 步 5：反转牌生成 =====
  const runFlipGenerate = useCallback(async () => {
    if (!record) return;
    setFlipGenerating(true);
    setFlipError(null);
    setFlipCharCount(0);
    progressLastRef.current = 0;
    try {
      const worstText = record.outcomes.find(o => o.type === 'worst')?.text || record.content;
      const result = await generateFlipPoints(record.content, worstText, handleFlipProgress);
      await updateRecord({ flipPoints: result.points });
      setFlipRevealed(true);
      // v3.3.0: AI 附带 Soul 更新建议 → 挂到「怕了么」主页等待确认（新建议覆盖旧的）
      if (result.soulUpdate) {
        savePendingSoulUpdate(result.soulUpdate);
        setSoulCaptured(true);
      }
    } catch (e) {
      setFlipError(e instanceof Error ? e.message : '生成失败，请重试');
    } finally {
      setFlipGenerating(false);
    }
  }, [record, updateRecord, handleFlipProgress]);

  const handleFlipTap = useCallback(() => {
    if (!record) return;
    if (record.flipPoints.length > 0) {
      setFlipRevealed(true);
      return;
    }
    void runFlipGenerate();
  }, [record, runFlipGenerate]);

  // ===== 步 6：新建对话继续聊（v3.3.0）=====
  // 完成本次调和 → 跳聊天页新建对话 → 把上下文预填进输入框（不发送）
  const handleContinueToChat = useCallback(() => {
    if (!record) return;
    const finalScore = record.scoreAfter ?? scoreAfter;
    (window as any).__yiyan_pending_chat_draft__ = {
      text: buildContinueChatDraft(record, finalScore),
      source: 'worry',
    };
    void (async () => {
      await updateRecord({ status: 'completed', scoreAfter: finalScore, step: 7 });
      navigate('/chat');
    })();
  }, [record, scoreAfter, updateRecord, navigate]);

  // ===== 渲染 =====
  if (booting || !record) {
    return (
      <div className="worry-page worry-flow-page">
        <div className="worry-boot-loading">正在准备…</div>
      </div>
    );
  }

  const rawProbs = {
    worst: record.outcomes.find(o => o.type === 'worst')?.rawProb ?? 0,
    normal: record.outcomes.find(o => o.type === 'normal')?.rawProb ?? 0,
    best: record.outcomes.find(o => o.type === 'best')?.rawProb ?? 0,
  };
  const rawSum = rawProbs.worst + rawProbs.normal + rawProbs.best;
  const normalized = record.normalizedProbs;

  return (
    <div className="worry-page worry-flow-page">
      {/* 顶部栏 */}
      <header className="worry-flow-header">
        <button className="worry-icon-btn" onClick={() => navigate('/worries')} aria-label="返回">
          {BackIcon}
        </button>
        <div className="worry-flow-title">怕了么</div>
      </header>

      {/* 6 段进度条 */}
      <div className="worry-progress" aria-hidden>
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className={`worry-progress-seg ${i <= phase ? 'filled' : ''}`} />
        ))}
      </div>

      <main className="worry-flow-body" key={showSummary ? 'summary' : phase}>
        {/* ===== 步 1 · 写下担心 ===== */}
        {phase === 1 && (
          <div className="worry-step">
            <h1 className="worry-question">此刻，你最担心的是什么？</h1>
            <textarea
              className="worry-input"
              value={contentInput}
              onChange={e => setContentInput(e.target.value)}
              placeholder="不用写完整。比如：我担心被裁，之后再 也找不到工作。"
              rows={4}
              autoFocus
            />
            <button
              className="worry-btn-primary"
              disabled={!contentInput.trim()}
              onClick={() => void updateRecord({ content: contentInput.trim() }, 2)}
            >
              下一步
            </button>
          </div>
        )}

        {/* ===== 步 2 · 初始打分 ===== */}
        {phase === 2 && (
          <div className="worry-step">
            <div className="worry-echo">
              <span className="worry-echo-label">你的担心</span>
              <span className="worry-echo-text">{record.content}</span>
            </div>
            <h1 className="worry-question">现在，这件事让你有多担心？</h1>
            <ScoreSlider value={scoreBefore} onChange={setScoreBefore} />
            <div className="worry-scale-hints">
              <span>1 = 几乎不担心</span>
              <span>10 = 满脑子都是它，做不了别的事</span>
            </div>
            <button
              className="worry-btn-primary"
              onClick={() => void updateRecord({ scoreBefore }, 3)}
            >
              下一步
            </button>
          </div>
        )}

        {/* ===== 步 3 · 三种结局 ===== */}
        {phase === 3 && (
          <div className="worry-step">
            <h1 className="worry-question">如果这件事往下走，会有三种结局</h1>
            <p className="worry-sub">一张一张翻开看看。</p>

            {generating && (
              <div className="worry-loading">
                <div className="worry-loading-dots"><span /><span /><span /></div>
                <p>{OUTCOME_LOADING_TEXTS[loadingTextIdx]}</p>
                {genCharCount > 0 && (
                  <p className="worry-loading-chars">已生成字数 {genCharCount}</p>
                )}
              </div>
            )}

            {!generating && genError && (
              <div className="worry-error">
                <p className="worry-error-text">{genError}</p>
                <div className="worry-error-actions">
                  <button className="worry-btn-secondary" onClick={() => void runGenerate()}>重试</button>
                  <button className="worry-btn-ghost" onClick={startManual}>手动填写</button>
                </div>
              </div>
            )}

            {!generating && !genError && record.outcomes.length > 0 && (
              <OutcomeCards
                outcomes={record.outcomes}
                manualMode={manualMode}
                onConfirmCard={handleConfirmCard}
                onDone={() => void updateRecord({}, 4)}
              />
            )}
          </div>
        )}

        {/* ===== 步 4 · 概率校准 ===== */}
        {phase === 4 && (
          <div className="worry-step">
            <h1 className="worry-question">你给出的概率</h1>
            <ProbBars probs={rawProbs} />

            {rawSum !== 100 && (
              <>
                <p className="worry-sum-line">
                  总和 {rawSum}%
                </p>
                <p className="worry-insight">
                  但这三种结果，最后只会发生一种。它们加起来只能是 100%。
                </p>
                {normalized && (
                  <>
                    <p className="worry-sub">按你自己的判断，换算回 100%</p>
                    <ProbBars probs={normalized} />
                  </>
                )}
              </>
            )}

            {normalized && (
              <p className="worry-conclusion">
                你最怕的那个结局，按你自己的判断，大约是 <strong>{normalized.worst}%</strong>。
              </p>
            )}

            <div className="worry-two-buttons">
              <button className="worry-btn-secondary" onClick={() => void updateRecord({}, 5)}>
                我仍然担心会发生最坏的结果
              </button>
              <button className="worry-btn-primary" onClick={() => void updateRecord({ skippedFlip: true }, 6)}>
                下一步
              </button>
            </div>
          </div>
        )}

        {/* ===== 步 5 · 反转牌 ===== */}
        {phase === 5 && (
          <div className="worry-step">
            <h1 className="worry-question">仍然担心最坏的结果？</h1>
            <p className="worry-sub">
              是的，最坏的结果是有可能发生的。按你自己的判断，它有约 {normalized?.worst ?? 0}% 的可能。你的担心不是多余的。
            </p>
            <p className="worry-sub">但你可以把这张牌反转过来。</p>

            <div className={`flip-card worry-flip-reveal ${flipRevealed ? 'is-flipped' : ''}`}>
              <div className="flip-card-inner">
                {/* 正面：最坏结果 + 反转按钮 */}
                <div className="flip-card-face flip-card-cover">
                  <div className="outcome-card-label">最坏结果</div>
                  <p className="outcome-card-text">
                    {record.outcomes.find(o => o.type === 'worst')?.text}
                  </p>
                  {flipGenerating ? (
                    <div className="worry-loading">
                      <div className="worry-loading-dots"><span /><span /><span /></div>
                      <p>{FLIP_LOADING_TEXTS[flipLoadingTextIdx]}</p>
                      {flipCharCount > 0 && (
                        <p className="worry-loading-chars">已生成字数 {flipCharCount}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      {flipError && <p className="worry-error-text">{flipError}</p>}
                      <button className="worry-btn-secondary" onClick={handleFlipTap}>
                        {flipError ? '重试' : '反转这张牌'}
                      </button>
                      {flipError && (
                        <button className="worry-btn-ghost" onClick={() => void updateRecord({}, 6)}>
                          跳过这步
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* 背面：收获点 */}
                <div className="flip-card-face flip-card-content">
                  <div className="outcome-card-label">最坏结果 · 反转</div>
                  <p className="worry-flip-title">即使发生，我也会获得</p>
                  <div className="worry-flip-points">
                    {record.flipPoints.map((p, i) => (
                      <div key={i} className="worry-flip-point">
                        <span className="worry-flip-index">{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <div className="worry-flip-point-title">{p.title}</div>
                          <div className="worry-flip-point-desc">{p.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="worry-two-buttons">
                    <button className="worry-btn-secondary" onClick={() => setFlipRevealed(false)}>
                      翻回正面
                    </button>
                    <button className="worry-btn-primary" onClick={() => void updateRecord({}, 6)}>
                      继续
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {soulCaptured && (
              <p className="worry-flow-soul-hint">
                AI 有一条人格档案的更新建议，已挂到「怕了么」主页，回去可以确认。
              </p>
            )}
          </div>
        )}

        {/* ===== 步 6 · 再打分 + 总结 ===== */}
        {phase === 6 && !showSummary && (
          <div className="worry-step">
            <div className="worry-echo">
              <span className="worry-echo-label">你的担心</span>
              <span className="worry-echo-text">{record.content}</span>
            </div>
            <h1 className="worry-question">现在，你还有多担心？</h1>
            <ScoreSlider value={scoreAfter} onChange={setScoreAfter} />
            <button
              className="worry-btn-primary"
              onClick={() => {
                setShowSummary(true);
                void updateRecord({ scoreAfter });
              }}
            >
              下一步
            </button>
            <button
              className="worry-btn-secondary worry-btn-continue-chat"
              onClick={handleContinueToChat}
            >
              新建对话继续聊
            </button>
          </div>
        )}

        {phase === 6 && showSummary && (
          <div className="worry-step">
            <h1 className="worry-question">这一次</h1>
            <div className="worry-summary">
              <div className="worry-echo">
                <span className="worry-echo-label">你的担心</span>
                <span className="worry-echo-text">{record.content}</span>
              </div>
              <div className="worry-compare">
                <div className="worry-compare-row">
                  <span className="worry-compare-label">开始时</span>
                  <div className="worry-compare-track">
                    <div className="worry-compare-fill before" style={{ width: `${(record.scoreBefore / 10) * 100}%` }} />
                  </div>
                  <span className="worry-compare-value">{record.scoreBefore}</span>
                </div>
                <div className="worry-compare-row">
                  <span className="worry-compare-label">现在</span>
                  <div className="worry-compare-track">
                    <div className="worry-compare-fill after" style={{ width: `${((record.scoreAfter ?? scoreAfter) / 10) * 100}%` }} />
                  </div>
                  <span className="worry-compare-value">{record.scoreAfter ?? scoreAfter}</span>
                </div>
              </div>
            </div>
            <button
              className="worry-btn-primary"
              onClick={() => {
                void (async () => {
                  await updateRecord({ status: 'completed', scoreAfter: record.scoreAfter ?? scoreAfter, step: 7 });
                  navigate('/worries');
                })();
              }}
            >
              完成
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
