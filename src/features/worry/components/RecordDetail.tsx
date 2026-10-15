/**
 * 记录详情弹层（底部滑出）：
 * 完整回放一次调和（担心内容 / 分数对比 / 三张结局卡 / 归一化 / 反转牌收获）
 * 底部「删除」两段式确认
 */
import { useEffect, useState } from 'react';
import type { WorryRecord } from '@/types';
import { FLIP_ORDER, OUTCOME_LABEL, PROB_ORDER } from '../utils';

interface RecordDetailProps {
  record: WorryRecord | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function formatFull(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd} ${hh}:${mi}`;
}

export function RecordDetail({ record, onClose, onDelete }: RecordDetailProps) {
  const [confirming, setConfirming] = useState(false);

  // 打开新记录时复位确认状态
  useEffect(() => {
    setConfirming(false);
  }, [record?.id]);

  if (!record) return null;

  const normalized = record.normalizedProbs;

  return (
    <div className="worry-detail-overlay" onClick={onClose}>
      <div className="worry-detail-panel" onClick={e => e.stopPropagation()}>
        <div className="worry-detail-handle" />
        <div className="worry-detail-head">
          <span className="worry-detail-date">{formatFull(record.updatedAt)}</span>
        </div>

        <div className="worry-detail-scroll">
          <div className="worry-echo">
            <span className="worry-echo-label">你的担心</span>
            <span className="worry-echo-text">{record.content}</span>
          </div>

          {/* 分数对比 */}
          <div className="worry-detail-scores">
            <div className="worry-detail-score">
              <span className="worry-detail-score-num before">{record.scoreBefore}</span>
              <span className="worry-detail-score-label">开始时</span>
            </div>
            <span className="worry-detail-arrow">→</span>
            <div className="worry-detail-score">
              <span className="worry-detail-score-num after">{record.scoreAfter ?? '—'}</span>
              <span className="worry-detail-score-label">现在</span>
            </div>
          </div>

          {/* 三张结局卡 */}
          <div className="worry-detail-section-title">三种结局</div>
          {FLIP_ORDER.map(t => {
            const o = record.outcomes.find(x => x.type === t);
            if (!o) return null;
            return (
              <div key={t} className="worry-detail-card">
                <div className="worry-detail-card-head">
                  <span className="outcome-card-label">{OUTCOME_LABEL[t]}</span>
                  <span className="outcome-prob-tag">{o.rawProb}%</span>
                </div>
                <p className="worry-detail-card-text">{o.text}</p>
              </div>
            );
          })}

          {/* 归一化概率 */}
          {normalized && (
            <div className="worry-detail-norm">
              <span>换算回 100%：</span>
              {PROB_ORDER.map(t => (
                <span key={t} className="worry-detail-norm-item">
                  {OUTCOME_LABEL[t]} {normalized[t]}%
                </span>
              ))}
            </div>
          )}

          {/* 反转牌收获 */}
          {record.flipPoints.length > 0 && (
            <>
              <div className="worry-detail-section-title">即使发生，我也会获得</div>
              {record.flipPoints.map((p, i) => (
                <div key={i} className="worry-flip-point">
                  <span className="worry-flip-index">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="worry-flip-point-title">{p.title}</div>
                    <div className="worry-flip-point-desc">{p.desc}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="worry-detail-actions">
          <button
            className={`worry-btn-danger ${confirming ? 'confirming' : ''}`}
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              onDelete(record.id);
            }}
          >
            {confirming ? '再点一次确认删除' : '删除这次记录'}
          </button>
        </div>
      </div>
    </div>
  );
}
