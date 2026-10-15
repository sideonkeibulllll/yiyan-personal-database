/**
 * 大号治愈系打分滑块（1–10）
 * 用于「初始打分」与「再打分」两个步骤
 */
interface ScoreSliderProps {
  value: number;
  onChange: (v: number) => void;
}

export function ScoreSlider({ value, onChange }: ScoreSliderProps) {
  // 已填充比例（1 → 0%，10 → 100%）
  const percent = ((value - 1) / 9) * 100;

  return (
    <div className="score-slider">
      <div className="score-slider-value">{value}</div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="score-slider-input"
        style={{
          background: `linear-gradient(to right, var(--worry-accent, #f76707) ${percent}%, var(--color-bg-float) ${percent}%)`,
        }}
        aria-label="担心程度 1 到 10"
      />
      <div className="score-slider-scale">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}
