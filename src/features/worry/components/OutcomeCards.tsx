/**
 * 步 3 · 三种结局：堆叠卡片逐张翻开（3D 翻转）
 * 翻开顺序：最坏 → 最好 → 普通（与参考视频一致）
 * 手填模式（AI 失败兜底）：翻开后在卡面 textarea 自行书写
 */
import { useEffect, useState } from 'react';
import type { WorryOutcome, WorryOutcomeType } from '@/types';
import { FLIP_ORDER, OUTCOME_LABEL } from '../utils';

interface OutcomeCardsProps {
  outcomes: WorryOutcome[];
  /** 手填兜底模式：卡面内容由用户输入 */
  manualMode: boolean;
  /** 确定当前卡（手填模式下附带用户输入的文本） */
  onConfirmCard: (type: WorryOutcomeType, prob: number, text?: string) => void;
  /** 三张全部完成 → 查看结果 */
  onDone: () => void;
}

export function OutcomeCards({ outcomes, manualMode, onConfirmCard, onDone }: OutcomeCardsProps) {
  const [cardFlipped, setCardFlipped] = useState(false);
  const [currentProb, setCurrentProb] = useState(50);
  const [manualText, setManualText] = useState('');

  const confirmedTypes = new Set(outcomes.filter(o => o.confirmed).map(o => o.type));
  const doneCount = confirmedTypes.size;
  const currentType: WorryOutcomeType | null = FLIP_ORDER.find(t => !confirmedTypes.has(t)) || null;
  const current = currentType ? outcomes.find(o => o.type === currentType) : undefined;
  const allDone = currentType === null;

  // 切换到下一张卡时重置卡面状态
  useEffect(() => {
    setCardFlipped(false);
    setCurrentProb(50);
    setManualText('');
  }, [currentType]);

  // ===== 三张全部完成：并排回看 + 查看结果 =====
  if (allDone) {
    return (
      <div className="outcome-cards">
        <div className="outcome-review">
          {FLIP_ORDER.map(t => {
            const o = outcomes.find(x => x.type === t);
            return (
              <div key={t} className="outcome-review-card">
                <div className="outcome-card-label">{OUTCOME_LABEL[t]}</div>
                <p className="outcome-card-text">{o?.text}</p>
                <div className="outcome-prob-tag">{o?.rawProb ?? 0}%</div>
              </div>
            );
          })}
        </div>
        <button className="worry-btn-primary" onClick={onDone}>查看结果</button>
      </div>
    );
  }

  const probPercent = currentProb;

  return (
    <div className="outcome-cards">
      {/* 已完成缩略 */}
      <div className="outcome-done-row">
        {FLIP_ORDER.slice(0, doneCount).map(t => (
          <span key={t} className="outcome-done-chip">{OUTCOME_LABEL[t]} ✓</span>
        ))}
      </div>

      {/* 当前卡（3D 翻转） */}
      <div className={`flip-card type-${currentType} ${cardFlipped ? 'is-flipped' : ''}`} key={currentType}>
        <div className="flip-card-inner">
          {/* 背面（封面） */}
          <div className="flip-card-face flip-card-cover">
            <div className="flip-cover-deco">◇</div>
            <p className="flip-cover-title">{OUTCOME_LABEL[currentType!]}</p>
            <p className="flip-cover-hint">一张一张翻开看看</p>
            <button className="worry-btn-secondary" onClick={() => setCardFlipped(true)}>
              翻开这张牌
            </button>
          </div>

          {/* 正面（内容） */}
          <div className="flip-card-face flip-card-content">
            <div className="outcome-card-label">{OUTCOME_LABEL[currentType!]}</div>
            {manualMode ? (
              <textarea
                className="outcome-manual-input"
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder="写下你觉得可能发生的结局……"
                rows={4}
              />
            ) : (
              <p className="outcome-card-text">{current?.text}</p>
            )}
            {cardFlipped && (
              <div className="outcome-prob-block">
                <p className="outcome-prob-question">你认为发生的概率有多大？</p>
                <div className="outcome-prob-value">{currentProb}%</div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={currentProb}
                  onChange={e => setCurrentProb(Number(e.target.value))}
                  className="outcome-prob-slider"
                  style={{
                    background: `linear-gradient(to right, var(--worry-accent, #f76707) ${probPercent}%, var(--color-bg-float) ${probPercent}%)`,
                  }}
                  aria-label="发生概率"
                />
                <button
                  className="worry-btn-primary"
                  disabled={manualMode && !manualText.trim()}
                  onClick={() => onConfirmCard(currentType!, currentProb, manualMode ? manualText.trim() : undefined)}
                >
                  确定
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="outcome-counter">已翻开 {doneCount} / 3</div>
    </div>
  );
}
