/**
 * 「移除已选中选项」勾选框
 *
 * 位于「场景预设」与「选项管理」之间。
 * 勾选后：转盘停下、结果卡片显示的同一时刻，把抽中的选项从列表里移除
 * （"抽一个少一个"）。移除到只剩 1 个时停止，GO 自动禁用。
 * 开关状态每个转盘独立记忆。
 */

interface RemoveAfterSpinToggleProps {
  checked: boolean;
  /** 旋转中禁用 */
  disabled?: boolean;
  /** 当前选项数量，用于显示提示 */
  optionCount: number;
  onChange: (checked: boolean) => void;
}

export function RemoveAfterSpinToggle({
  checked,
  disabled,
  optionCount,
  onChange,
}: RemoveAfterSpinToggleProps) {
  const exhausted = optionCount <= 1;

  return (
    <div className={`wheel-remove-toggle ${disabled ? 'disabled' : ''}`}>
      <label className="wheel-remove-label">
        <input
          type="checkbox"
          className="wheel-remove-checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="wheel-remove-box" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        </span>
        <span className="wheel-remove-text">移除已选中选项</span>
      </label>
      {checked && (
        <span className={`wheel-remove-hint ${exhausted ? 'warn' : ''}`}>
          {exhausted
            ? '已剩 1 个，无法继续抽取'
            : `抽中后从列表中移除（剩 ${optionCount} 个）`}
        </span>
      )}
    </div>
  );
}
