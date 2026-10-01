/**
 * 快捷字符栏：插入常用 Markdown 符号
 * 横向可滚动，点击后在「编辑器当前光标处」插入对应片段。
 *
 * 关键点：按钮的 mousedown 必须 preventDefault（防止手机键盘收起/闪烁），
 * 但这会让编辑器先失焦、CM6 把 selection 归零。
 * 所以在 mousedown 的第一时间先调用 onBeforeInsert() 把真实选区快照下来，
 * 之后的插入就以快照为准，避免片段被插到文档开头。
 */
import { FORMAT_ACTIONS, type FormatAction } from '../memoMarkdown';

interface MemoFormatBarProps {
  onInsert: (action: FormatAction) => void;
  /** 在焦点被夺走之前快照编辑器选区 */
  onBeforeInsert: () => void;
}

export function MemoFormatBar({ onInsert, onBeforeInsert }: MemoFormatBarProps) {
  return (
    <div className="memo-format-bar">
      {FORMAT_ACTIONS.map(action => (
        <button
          key={action.label}
          className="memo-format-btn"
          onPointerDown={e => {
            // 快照选区 → 再阻止焦点转移
            onBeforeInsert();
            e.preventDefault();
          }}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onInsert(action)}
          type="button"
          title={action.label}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
