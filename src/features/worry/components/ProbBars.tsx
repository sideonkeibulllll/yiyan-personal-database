/**
 * 概率条组（步 4 · 概率校准）
 * 展示最坏 / 普通 / 最好三条概率横条 + 100% 刻度线
 */
import type { WorryNormalizedProbs } from '@/types';
import { OUTCOME_LABEL, PROB_ORDER } from '../utils';

interface ProbBarsProps {
  probs: WorryNormalizedProbs;
  /** 是否显示 100% 刻度线 */
  showScale?: boolean;
}

export function ProbBars({ probs, showScale = true }: ProbBarsProps) {
  return (
    <div className="prob-bars">
      {PROB_ORDER.map(type => {
        const value = probs[type];
        return (
          <div key={type} className={`prob-bar-row prob-bar-${type}`}>
            <div className="prob-bar-head">
              <span className="prob-bar-label">{OUTCOME_LABEL[type]}</span>
              <span className="prob-bar-value">{value}%</span>
            </div>
            <div className="prob-bar-track">
              <div className="prob-bar-fill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
              {showScale && <div className="prob-bar-scale" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
