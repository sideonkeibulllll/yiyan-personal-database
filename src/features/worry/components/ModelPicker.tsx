/**
 * 模型选择器（与 Chat 页同款交互）：
 * 按钮显示当前选择 → 点击展开下拉（按提供商分组，含「全局默认」与「智能 GLM 免费池」）
 * 选择后立即生效（下一次 AI 生成即用新模型）
 */
import { useState } from 'react';
import type { WorryModelOption } from '@/services/worryAI';

interface ModelPickerProps {
  options: WorryModelOption[];
  currentValue: string;
  onSelect: (value: string) => void;
}

export function ModelPicker({ options, currentValue, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const currentLabel = options.find(o => o.value === currentValue)?.label || '全局默认';

  return (
    <div className="worry-model-picker">
      <button
        className={`worry-model-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-label="切换模型"
      >
        <span className="worry-model-label">{currentLabel}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="worry-model-mask" onClick={() => setOpen(false)} />
          <div className="worry-model-dropdown">
            {options.map((opt, i) => {
              const showGroup = !!opt.group && opt.group !== options[i - 1]?.group;
              return (
                <div key={opt.value || 'default'}>
                  {showGroup && <div className="worry-model-group">{opt.group}</div>}
                  <div
                    className={`worry-model-option ${currentValue === opt.value ? 'active' : ''}`}
                    onClick={() => {
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                    {currentValue === opt.value && <span className="worry-model-check">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
