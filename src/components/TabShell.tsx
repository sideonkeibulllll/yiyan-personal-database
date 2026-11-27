/**
 * 主页面外壳 —— 四个 Tab 横向排开，切换是"滑过去"，不是"重新加载"
 *
 * 为什么不用路由硬切：
 * - 硬切会卸载页面：滚动位置丢、列表重新请求、动效从零开始
 * - 滑过去之后，页面还在内存里，回来还是刚才那一屏
 *
 * 结构：
 *   .tab-shell         固定铺满，不滚动
 *     .tab-pane × 4    各自全屏、各自滚动、各自持有自己页面
 *     BottomNav        在轨道外，所以滑动时它不动
 *
 * 注意：pane 有 transform，页面里的 position:fixed 会相对 pane 定位——
 * 这正是我们要的：底栏动作条、筛选按钮跟着自己的页面走，不会串台。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import './TabShell.css';

const HomePage = lazy(() => import('@/features/input/HomePage').then(m => ({ default: m.HomePage })));
const RandomPage = lazy(() => import('@/features/random/RandomPage').then(m => ({ default: m.RandomPage })));
const TodoPage = lazy(() => import('@/features/todo/TodoPage').then(m => ({ default: m.TodoPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));

const TABS = [
  { path: '/', Comp: HomePage },
  { path: '/random', Comp: RandomPage },
  { path: '/todo', Comp: TodoPage },
  { path: '/settings', Comp: SettingsPage },
];

/** 落在这些元素上的横向手势，交还给它们自己处理 */
const SWIPE_IGNORE = '.date-selector, .cards-stack, .settings-nav, textarea, input, [data-no-swipe]';

export function TabShell() {
  const location = useLocation();
  const navigate = useNavigate();

  const found = TABS.findIndex(t => t.path === location.pathname);
  const index = found < 0 ? 0 : found;

  // 访问过的 pane 一直留着，没访问过的先不挂载（首屏只加载录入页）
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([index]));
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef(0);

  useEffect(() => {
    setMounted(prev => (prev.has(index) ? prev : new Set(prev).add(index)));
  }, [index]);

  const go = useCallback((i: number) => {
    if (i < 0 || i >= TABS.length) return;
    navigate(TABS[i].path, { replace: true });
  }, [navigate]);

  const onNavigate = useCallback((path: string) => {
    const i = TABS.findIndex(t => t.path === path);
    if (i >= 0) {
      go(i);
      return;
    }
    // Chat 等全屏页仍然走路由（它会从右侧滑入）
    navigate(path);
  }, [go, navigate]);

  /* ---------------- 手势 ---------------- */

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest(SWIPE_IGNORE)) return;
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = startRef.current;
    if (!start) return;

    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;

    if (!dragging) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // 竖着划的是滚动，不是切页
      if (Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        return;
      }
    }

    setDragging(true);

    // 到头了还给一点位移，告诉手指"到头了"，但不真切
    const atStart = index === 0 && dx > 0;
    const atEnd = index === TABS.length - 1 && dx < 0;
    const next = atStart || atEnd ? dx * 0.26 : dx;

    dragRef.current = next;
    setDragX(next);
  };

  const onTouchEnd = () => {
    const w = window.innerWidth;
    const moved = dragRef.current;

    if (Math.abs(moved) > w * 0.2) {
      go(moved < 0 ? index + 1 : index - 1);
    }

    dragRef.current = 0;
    setDragX(0);
    setDragging(false);
    startRef.current = null;
  };

  return (
    <div
      className="tab-shell"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {TABS.map((tab, i) => {
        const active = i === index;
        return (
          <div
            key={tab.path}
            className={`tab-pane${active ? ' is-active' : ''}`}
            aria-hidden={!active}
            style={{
              transform: `translate3d(calc(${(i - index) * 100}% + ${dragX}px), 0, 0)`,
              transition: dragging ? 'none' : undefined,
            }}
          >
            {mounted.has(i) && (
              <Suspense fallback={null}>
                <tab.Comp />
              </Suspense>
            )}
          </div>
        );
      })}

      <BottomNav activePath={location.pathname} onNavigate={onNavigate} />
    </div>
  );
}
