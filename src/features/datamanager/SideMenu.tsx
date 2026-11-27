/**
 * 浏览方式：从底部升起的双列动作抽屉（不是侧边栏）
 */
import type { ManagerMode } from './types';
import './SideMenu.css';

interface SideMenuProps {
  open: boolean;
  currentMode: ManagerMode;
  onModeChange: (mode: ManagerMode) => void;
  onClose: () => void;
  onExit: () => void;
}

/** Tag icon */
const TagIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l6.58-6.58a1 1 0 0 0 0-1.41L12 2z" /><path d="M7 7h.01" />
  </svg>
);

/** Folder icon */
const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/** Hard drive icon */
const HardDriveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><path d="M6 16h.01M10 16h.01" />
  </svg>
);

/** X (close) icon */
const XIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Log out icon */
const LogOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

const menuItems: { mode: ManagerMode; icon: React.ReactNode; label: string; desc: string }[] = [
  { mode: 'tags', icon: <TagIcon />, label: '标签', desc: '按标签浏览条目' },
  { mode: 'groups', icon: <FolderIcon />, label: '组', desc: '按组浏览条目' },
  { mode: 'data', icon: <HardDriveIcon />, label: '数据', desc: '浏览所有条目' },
];

export function SideMenu({ open, currentMode, onModeChange, onClose, onExit }: SideMenuProps) {
  return (
    <>
      {open && <div className="dm-sheet-scrim" onClick={onClose} />}
      <aside className={`dm-sheet ${open ? 'open' : ''}`}>
        <span className="dm-sheet-grip" aria-hidden="true" />
        <div className="dm-sheet-head">
          <h3>浏览方式</h3>
          <span className="dm-sheet-sub">
            当前 · {menuItems.find(item => item.mode === currentMode)?.label}
          </span>
          <button className="dm-sheet-close" onClick={onClose} title="关闭"><XIcon /></button>
        </div>
        <nav className="dm-sheet-grid">
          {menuItems.map(item => (
            <button
              key={item.mode}
              className={`dm-sheet-cell ${currentMode === item.mode ? 'on' : ''}`}
              onClick={() => {
                onModeChange(item.mode);
                onClose();
              }}
            >
              <span className="dm-sheet-ico">{item.icon}</span>
              <span className="dm-sheet-label">{item.label}</span>
              <span className="dm-sheet-desc">{item.desc}</span>
              {currentMode === item.mode && <span className="dm-sheet-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <button className="dm-sheet-exit" onClick={() => { onExit(); onClose(); }}>
          <LogOutIcon />
          <span>退出数据管理</span>
        </button>
      </aside>
    </>
  );
}
