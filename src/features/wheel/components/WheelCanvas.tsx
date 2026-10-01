/**
 * 转盘轮盘（SVG 加权转盘）
 *
 * 关键实现（对齐参考文档）：
 * - viewBox 320×320，圆心 (160,160)，外半径 148，文字半径 92
 * - 每个扇区用 path 圆弧命令绘制，扇区角度与权重成正比
 * - 文字沿径向放置，角度在 90°–270° 区间时翻转 90° 避免倒字
 * - 字号按选项数分级，扇区过窄时截断加省略号
 * - 指针固定在顶部（不随转盘旋转），GO 按钮绝对定位居中覆盖
 * - 抽中算法：先按权重随机选索引，再反推该扇区中心应转到的角度
 */
import { useEffect, useRef } from 'react';
import type { WheelOption } from '@/types';

/** 莫兰迪扇形配色（10 色循环） */
export const SECTOR_COLORS = [
  '#C0643F', '#7E9B8F', '#B08B6E', '#8E7CA8', '#C9A66B',
  '#6E8BAB', '#A8737C', '#87926F', '#B5744F', '#7C8B99',
];

interface WheelCanvasProps {
  options: WheelOption[];
  /** 当前旋转角度（度） */
  rotation: number;
  /** 是否正在旋转 */
  spinning: boolean;
  /** 抽中的扇区索引（高亮） */
  highlightIndex: number | null;
  /** 点击 GO */
  onSpin: () => void;
  /** 旋转动画时长（ms） */
  duration?: number;
}

const SIZE = 320;
const CX = 160;
const CY = 160;
const R_OUTER = 148;
const R_TEXT = 92;

/** 极坐标 → 直角坐标（角度按顶部为 -90°，顺时针为正） */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 生成扇区 path（弧线） */
function sectorPath(startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(CX, CY, R_OUTER, startDeg);
  const [x2, y2] = polar(CX, CY, R_OUTER, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  // 单个选项占满整圈时无法用圆弧表示，退化为整圆
  if (endDeg - startDeg >= 359.999) {
    return `M ${CX} ${CY - R_OUTER} A ${R_OUTER} ${R_OUTER} 0 1 1 ${CX - 0.01} ${CY - R_OUTER} Z`;
  }
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

/** 按选项数选择字号 */
function fontSizeFor(count: number): number {
  if (count >= 16) return 9;
  if (count >= 12) return 10;
  if (count >= 8) return 11.5;
  return 13;
}

/** 按扇区宽度截断文字 */
function truncate(name: string, spanDeg: number, fontSize: number): string {
  const arcLen = (spanDeg / 360) * 2 * Math.PI * R_TEXT;
  const maxChars = Math.max(2, Math.floor(arcLen / (fontSize * 0.62)));
  if (name.length <= maxChars) return name;
  return name.slice(0, Math.max(1, maxChars - 1)) + '…';
}

export function WheelCanvas({
  options,
  rotation,
  spinning,
  highlightIndex,
  onSpin,
  duration = 3800,
}: WheelCanvasProps) {
  const groupRef = useRef<SVGGElement>(null);

  // 用 CSS transition 实现缓动旋转（避免逐帧重渲染）
  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    el.style.transition = spinning
      ? `transform ${duration}ms cubic-bezier(0.12, 0.75, 0.16, 1)`
      : 'none';
    el.style.transform = `rotate(${rotation}deg)`;
  }, [rotation, spinning, duration]);

  const totalWeight = options.reduce((s, o) => s + Math.max(1, o.weight), 0) || 1;
  const fontSize = fontSizeFor(options.length);

  // 预计算各扇区起止角度
  let acc = 0;
  const sectors = options.map((opt, i) => {
    const span = (Math.max(1, opt.weight) / totalWeight) * 360;
    const start = acc;
    const end = acc + span;
    acc = end;
    return { opt, i, start, end, span };
  });

  return (
    <div className="wheel-canvas-wrap">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="wheel-canvas-svg"
        width={SIZE}
        height={SIZE}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* 转盘本体（整体旋转） */}
        <g ref={groupRef} style={{ transformOrigin: `${CX}px ${CY}px` }}>
          {sectors.map(({ opt, i, start, end, span }) => {
            const isHit = highlightIndex === i;
            const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
            const [tx, ty] = polar(CX, CY, R_TEXT, (start + end) / 2);
            const mid = (start + end) / 2;
            // 角度在 90°–270° 区间（左半圈）时文字翻转，避免倒字
            const flip = mid > 90 && mid < 270;
            return (
              <g key={i}>
                <path
                  d={sectorPath(start, end)}
                  fill={color}
                  fillOpacity={isHit ? 0.55 : 1}
                  stroke={isHit ? '#2E2A26' : '#ffffff'}
                  strokeWidth={isHit ? 2.5 : 1}
                />
                <text
                  x={tx}
                  y={ty}
                  fontSize={fontSize}
                  fill="#ffffff"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                  transform={`rotate(${flip ? mid + 180 : mid}, ${tx}, ${ty})`}
                >
                  {truncate(opt.name, span, fontSize)}
                </text>
              </g>
            );
          })}
        </g>

        {/* 中心轴 */}
        <circle cx={CX} cy={CY} r={22} fill="var(--color-bg-elevated, #28292f)" stroke="#ffffff" strokeWidth={2} />

        {/* 顶部固定指针（不随转盘旋转） */}
        <polygon
          points={`${CX - 14},14 ${CX + 14},14 ${CX},52`}
          fill="var(--color-accent-primary, #f76707)"
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      </svg>

      {/* GO 按钮：绝对定位居中覆盖，不随转盘旋转 */}
      <button
        className={`wheel-go-btn ${spinning ? 'spinning' : ''}`}
        onClick={onSpin}
        disabled={spinning || options.length < 2}
        type="button"
      >
        {spinning ? '•••' : 'GO'}
      </button>

      {options.length < 2 && (
        <div className="wheel-tip">至少需要 2 个选项才能旋转</div>
      )}
    </div>
  );
}

/**
 * 按权重随机抽出索引
 */
export function pickWeightedIndex(options: WheelOption[]): number {
  const total = options.reduce((s, o) => s + Math.max(1, o.weight), 0);
  let r = Math.random() * total;
  for (let i = 0; i < options.length; i++) {
    r -= Math.max(1, options[i].weight);
    if (r <= 0) return i;
  }
  return options.length - 1;
}

/**
 * 计算目标旋转角度：
 * 先按权重选出索引，再反推该扇区中心应转到"顶部指针"位置的角度。
 * offset = ((-90 - midDeg) % 360 + 360) % 360
 */
export function computeTargetRotation(
  current: number,
  options: WheelOption[],
  pickedIndex: number,
  extraTurns = 5,
): number {
  const total = options.reduce((s, o) => s + Math.max(1, o.weight), 0) || 1;
  let acc = 0;
  for (let i = 0; i < pickedIndex; i++) acc += (Math.max(1, options[i].weight) / total) * 360;
  const span = (Math.max(1, options[pickedIndex].weight) / total) * 360;
  const midDeg = acc + span / 2;
  const offset = ((-90 - midDeg) % 360 + 360) % 360;
  // 基准角取当前角度的下一个整圈起点，保证始终顺时针追加
  const base = Math.ceil(current / 360) * 360;
  return base + extraTurns * 360 + offset;
}
