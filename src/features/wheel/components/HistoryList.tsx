/**
 * 记录列表：最近抽中的结果（文字 + 时间 + 色点）
 */
import type { WheelHistoryItem } from '@/types';
import { SECTOR_COLORS } from './WheelCanvas';

interface HistoryListProps {
  history: WheelHistoryItem[];
  onClear: () => void;
}

/** M月D日 HH:mm */
function fmt(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function HistoryList({ history, onClear }: HistoryListProps) {
  return (
    <div className="wheel-history">
      <div className="wheel-section-title">
        最近记录
        {history.length > 0 && (
          <button className="wheel-history-clear" onClick={onClear}>清空</button>
        )}
      </div>
      {history.length === 0 ? (
        <div className="wheel-empty-hint">还没有抽过，转一次试试</div>
      ) : (
        <div className="wheel-history-list">
          {history.map((item, i) => (
            <div key={`${item.time}_${i}`} className="wheel-history-item">
              <span
                className="wheel-history-dot"
                style={{ background: SECTOR_COLORS[(item.index || 0) % SECTOR_COLORS.length] }}
              />
              <span className="wheel-history-text">{item.text}</span>
              <span className="wheel-history-time">{fmt(item.time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
