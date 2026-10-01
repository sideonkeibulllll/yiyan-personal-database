/**
 * 标题大纲：列出所有 # 标题，点击跳转到对应行
 * 同时显示「当前聚焦标题」高亮，便于确认自动定位位置
 */
import type { MemoHeading } from '../memoMarkdown';

interface MemoOutlineProps {
  headings: MemoHeading[];
  activeText: string | null;
  onJump: (heading: MemoHeading) => void;
}

export function MemoOutline({ headings, activeText, onJump }: MemoOutlineProps) {
  return (
    <div className="memo-outline">
      <div className="memo-outline-title">标题大纲</div>
      {headings.length === 0 ? (
        <div className="memo-outline-empty">还没有标题，用 # 写一个吧</div>
      ) : (
        <div className="memo-outline-list">
          {headings.map((h, i) => (
            <button
              key={`${h.line}_${i}`}
              className={`memo-outline-item level-${h.level} ${activeText === h.text ? 'active' : ''}`}
              onClick={() => onJump(h)}
              title={`第 ${h.line + 1} 行`}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
