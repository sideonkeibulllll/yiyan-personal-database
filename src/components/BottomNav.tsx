/**
 * 底部导航栏
 */
import { useLocation, useNavigate } from 'react-router-dom';
import './BottomNav.css';

const navItems = [
  { path: '/', icon: '📝', label: '录入' },
  { path: '/random', icon: '🎴', label: '随机' },
  { path: '/search', icon: '🔍', label: '搜索' },
  { path: '/settings', icon: '⚙️', label: '设置' },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav glass">
      {navItems.map(item => (
        <button
          key={item.path}
          className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
          onClick={() => navigate(item.path)}
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
