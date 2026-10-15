/**
 * 趋势曲线（手写 SVG，项目无图表库）
 * 两条平滑曲线：开始时（暖橙） / 现在（柔青），柔青线下方带渐变填充
 */
import type { WorryRecord } from '@/types';

const W = 600;
const H = 230;
const PAD = { top: 24, right: 20, bottom: 34, left: 34 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

/** Catmull-Rom → 三次贝塞尔 平滑折线 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

interface TrendChartProps {
  /** 已完成的记录（按时间正序） */
  records: WorryRecord[];
}

export function TrendChart({ records }: TrendChartProps) {
  const n = records.length;
  const xAt = (i: number) =>
    n === 1 ? PAD.left + INNER_W / 2 : PAD.left + (i / (n - 1)) * INNER_W;
  const yAt = (score: number) => PAD.top + (1 - (score - 1) / 9) * INNER_H;

  const beforePts = records.map((r, i) => ({ x: xAt(i), y: yAt(r.scoreBefore) }));
  const afterPts = records.map((r, i) => ({ x: xAt(i), y: yAt(r.scoreAfter ?? r.scoreBefore) }));

  const beforePath = smoothPath(beforePts);
  const afterPath = smoothPath(afterPts);
  const areaPath =
    n >= 2
      ? `${afterPath} L ${afterPts[n - 1].x.toFixed(1)} ${(PAD.top + INNER_H).toFixed(1)} L ${afterPts[0].x.toFixed(1)} ${(PAD.top + INNER_H).toFixed(1)} Z`
      : '';

  const fmt = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="担心程度变化趋势">
        <defs>
          <linearGradient id="worryAfterFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--worry-teal)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--worry-teal)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 水平网格（1 / 5 / 10） */}
        {[1, 5, 10].map(v => (
          <g key={v}>
            <line
              x1={PAD.left}
              y1={yAt(v)}
              x2={W - PAD.right}
              y2={yAt(v)}
              className="trend-grid"
            />
            <text x={PAD.left - 8} y={yAt(v)} className="trend-axis" textAnchor="end" dominantBaseline="central">
              {v}
            </text>
          </g>
        ))}

        {/* 柔青线下方渐变填充 */}
        {areaPath && <path d={areaPath} fill="url(#worryAfterFill)" />}

        {/* 双曲线 */}
        <path d={beforePath} className="trend-line before" fill="none" />
        <path d={afterPath} className="trend-line after" fill="none" />

        {/* 数据点 */}
        {beforePts.map((p, i) => (
          <circle key={`b${i}`} cx={p.x} cy={p.y} r={3} className="trend-dot before" />
        ))}
        {afterPts.map((p, i) => (
          <circle key={`a${i}`} cx={p.x} cy={p.y} r={3} className="trend-dot after" />
        ))}

        {/* 首尾日期标签 */}
        {n >= 1 && (
          <text x={xAt(0)} y={H - 10} className="trend-axis" textAnchor="middle">
            {fmt(records[0].updatedAt)}
          </text>
        )}
        {n >= 2 && (
          <text x={xAt(n - 1)} y={H - 10} className="trend-axis" textAnchor="middle">
            {fmt(records[n - 1].updatedAt)}
          </text>
        )}
      </svg>

      <div className="trend-legend">
        <span className="trend-legend-item"><i className="trend-legend-dot before" />开始时</span>
        <span className="trend-legend-item"><i className="trend-legend-dot after" />现在</span>
      </div>
    </div>
  );
}
