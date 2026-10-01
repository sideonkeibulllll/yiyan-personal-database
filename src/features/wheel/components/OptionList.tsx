/**
 * 选项列表：名称行内编辑 / 权重加减 / 删除
 * 旋转期间整体禁用（由父组件传 disabled 控制）
 */
import { useState } from 'react';
import type { WheelOption } from '@/types';
import { SECTOR_COLORS } from './WheelCanvas';

interface OptionListProps {
  options: WheelOption[];
  disabled: boolean;
  onChange: (options: WheelOption[]) => void;
}

const MAX_OPTIONS = 20;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 99;

export function OptionList({ options, disabled, onChange }: OptionListProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState(1);
  const [error, setError] = useState('');

  /** 添加选项（自动去重） */
  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    if (name.length > 12) {
      setError('选项名最长 12 字');
      return;
    }
    if (options.length >= MAX_OPTIONS) {
      setError(`最多 ${MAX_OPTIONS} 个选项`);
      return;
    }
    if (options.some(o => o.name === name)) {
      setError('该选项已存在');
      return;
    }
    onChange([...options, { name, weight: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newWeight)) }]);
    setNewName('');
    setNewWeight(1);
    setError('');
  };

  const handleDelete = (i: number) => {
    onChange(options.filter((_, idx) => idx !== i));
  };

  const handleWeight = (i: number, delta: number) => {
    const next = options.slice();
    next[i] = {
      ...next[i],
      weight: Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, next[i].weight + delta)),
    };
    onChange(next);
  };

  const commitEdit = () => {
    if (editingIndex === null) return;
    const name = editingText.trim();
    if (!name) { setEditingIndex(null); return; }
    if (name.length > 12) { setError('选项名最长 12 字'); return; }
    if (options.some((o, idx) => o.name === name && idx !== editingIndex)) {
      setError('该选项已存在');
      return;
    }
    const next = options.slice();
    next[editingIndex] = { ...next[editingIndex], name };
    onChange(next);
    setEditingIndex(null);
    setError('');
  };

  const totalWeight = options.reduce((s, o) => s + Math.max(1, o.weight), 0) || 1;

  return (
    <div className="wheel-option-list">
      <div className="wheel-section-title">
        选项管理
        <span className="wheel-section-sub">{options.length}/{MAX_OPTIONS}</span>
      </div>

      <div className="wheel-options">
        {options.map((opt, i) => {
          const pct = ((Math.max(1, opt.weight) / totalWeight) * 100).toFixed(1);
          return (
            <div key={i} className="wheel-option-row">
              <span
                className="wheel-option-dot"
                style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
              />
              {editingIndex === i ? (
                <input
                  className="wheel-option-name-input"
                  value={editingText}
                  autoFocus
                  maxLength={12}
                  onChange={e => setEditingText(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') setEditingIndex(null);
                  }}
                />
              ) : (
                <button
                  className="wheel-option-name"
                  disabled={disabled}
                  onClick={() => { setEditingIndex(i); setEditingText(opt.name); }}
                  title="点击改名"
                >
                  {opt.name}
                  <span className="wheel-option-pct">{pct}%</span>
                </button>
              )}

              <div className="wheel-weight-ctrl">
                <button
                  className="wheel-weight-btn"
                  disabled={disabled || opt.weight <= MIN_WEIGHT}
                  onClick={() => handleWeight(i, -1)}
                >−</button>
                <span className="wheel-weight-val">{opt.weight}</span>
                <button
                  className="wheel-weight-btn"
                  disabled={disabled || opt.weight >= MAX_WEIGHT}
                  onClick={() => handleWeight(i, 1)}
                >+</button>
              </div>

              <button
                className="wheel-option-del"
                disabled={disabled}
                onClick={() => handleDelete(i)}
                title="删除"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
        {options.length === 0 && <div className="wheel-empty-hint">还没有选项，先添加一个吧</div>}
      </div>

      {/* 添加行 */}
      <div className="wheel-add-row">
        <input
          className="wheel-add-input"
          value={newName}
          maxLength={12}
          placeholder="添加选项（回车确认）"
          disabled={disabled}
          onChange={e => { setNewName(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        />
        <div className="wheel-weight-ctrl compact">
          <button className="wheel-weight-btn" disabled={disabled || newWeight <= MIN_WEIGHT} onClick={() => setNewWeight(w => Math.max(MIN_WEIGHT, w - 1))}>−</button>
          <span className="wheel-weight-val">{newWeight}</span>
          <button className="wheel-weight-btn" disabled={disabled || newWeight >= MAX_WEIGHT} onClick={() => setNewWeight(w => Math.min(MAX_WEIGHT, w + 1))}>+</button>
        </div>
        <button className="wheel-add-btn" disabled={disabled || !newName.trim()} onClick={handleAdd}>添加</button>
      </div>

      {error && <div className="wheel-error">{error}</div>}
    </div>
  );
}
