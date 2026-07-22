/**
 * 侧边栏菜单
 */
import type { ManagerMode } from './types';
import './SideMenu.css';

interface SideMenuProps {
  open: boolean;
  currentMode: ManagerMode;
  onModeChange: (mode: ManagerMode) => void;
  onClose: () => void;
}

const menuItems: { mode: ManagerMode; icon: string; label: string; desc: string }[] = [
  { mode: 'tags', icon: '🏷️', label: '标签模式', desc: '按标签浏览条目' },
  { mode: 'groups', icon: '📁', label: '组模式', desc: '按组浏览条目' },
  { mode: 'data', icon: '💾', label: '数据模式', desc: '浏览所有条目' },
];

export function SideMenu({ open, currentMode, onModeChange, onClose }: SideMenuProps) {
  return (
    <>
      {open && <div className="dm-overlay" onClick={onClose} />}
      <aside className={`dm-side-menu ${open ? 'open' : ''}`}>
        <div className="dm-side-menu-header">
          <span className="dm-side-menu-title">数据管理器</span>
          <button className="dm-side-menu-close" onClick={onClose}>✕</button>
        </div>
        <nav className="dm-side-menu-nav">
          {menuItems.map(item => (
            <button
              key={item.mode}
              className={`dm-side-menu-item ${currentMode === item.mode ? 'active' : ''}`}
              onClick={() => {
                onModeChange(item.mode);
                onClose();
              }}
            >
              <span className="dm-side-menu-icon">{item.icon}</span>
              <div className="dm-side-menu-info">
                <span className="dm-side-menu-label">{item.label}</span>
                <span className="dm-side-menu-desc">{item.desc}</span>
              </div>
              {currentMode === item.mode && <span className="dm-side-menu-dot" />}
            </button>
          ))}
        </nav>
        <div className="dm-side-menu-footer">
          <span className="dm-side-menu-version">v1.0</span>
        </div>
      </aside>
    </>
  );
}
