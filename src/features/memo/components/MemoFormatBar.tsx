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
      {FORMAT_ACTIONS.map(action => {
        /**
         * 图片按钮要唤起系统文件选择器，必须保留浏览器的「用户激活」状态，
         * 所以它不能 preventDefault（否则 input.click() 会被 WebView 拒绝）。
         * 其余按钮照旧 preventDefault，避免编辑器失焦、键盘闪烁。
         */
        const needsUserActivation = action.kind === 'image';
        return (
          <button
            key={action.label}
            className="memo-format-btn"
            onPointerDown={e => {
              // 快照选区 → 再阻止焦点转移
              onBeforeInsert();
              if (!needsUserActivation) e.preventDefault();
            }}
            onMouseDown={e => {
              if (!needsUserActivation) e.preventDefault();
            }}
            onClick={() => onInsert(action)}
            type="button"
            title={action.label}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
