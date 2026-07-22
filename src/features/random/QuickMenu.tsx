/**
 * 快捷菜单组件
 * 长按卡片呼出
 */
import type { Entry } from '@/types';
import './QuickMenu.css';

interface QuickMenuProps {
  entry: Entry;
  onClose: () => void;
  onToggleStar: () => void;
}

export function QuickMenu({ entry, onClose, onToggleStar }: QuickMenuProps) {
  const menuItems = [
    { icon: '🏷️', label: '编辑标签', action: () => {} },
    { icon: entry.isStarred ? '⭐' : '☆', label: entry.isStarred ? '取消星标' : '星标', action: onToggleStar },
    { icon: '📋', label: '详情', action: () => {} },
    { icon: '📎', label: '添加到组', action: () => {} },
    { icon: '🔗', label: '查看连线', action: () => {} },
  ];

  return (
    <div className="quick-menu-overlay" onClick={onClose}>
      <div className="quick-menu glass" onClick={e => e.stopPropagation()}>
        <div className="menu-header">
          <span className="menu-title">快捷操作</span>
          <button className="menu-close" onClick={onClose}>✕</button>
        </div>

        <div className="menu-items">
          {menuItems.map((item, index) => (
            <button
              key={index}
              className="menu-item"
              onClick={() => {
                item.action();
                onClose();
              }}
            >
              <span className="item-icon">{item.icon}</span>
              <span className="item-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
