/**
 * Chat 页左侧栏 - 历史会话列表、重命名、分叉、删除
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 *
 * v3.5.0：操作区由三个「直接执行」的图标按钮，改为单个 ⋮ 按钮 + 弹出菜单。
 * 原实现里按钮虽然 opacity:0 隐藏，但在触屏事件链（tap → hover → click）上仍会
 * 被命中——手指摸到行右侧空白就可能触发删除。现在：点 ⋮（无害）→ 菜单里再选，
 * 两步操作才算数。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconEdit, IconCopy, IconTrash, IconClose, IconExit, IconMore } from '@/components/icons';
import { formatDate } from '../chatUtils';
import type { ChatSession } from '../chatTypes';

interface ChatSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  sidebarOpen: boolean;
  isMobile: boolean;
  /** 可选模型列表（v2.5.0：由父组件按当前提供商动态生成） */
  modelOptions: Array<{ value: string; label: string }>;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onStartRename: (id: string, currentTitle: string, e: React.MouseEvent) => void;
  onRenameSubmit: (id: string) => void;
  onCancelRename: () => void;
  onForkSession: (id: string, e: React.MouseEvent) => void;
  onNewChat: () => void;
  onCloseSidebar: () => void;
}

/** 菜单估算高度（3 项 × ~36px + 内边距）：用于视口底部翻转判断 */
const MENU_EST_HEIGHT = 140;

export const ChatSidebar = memo(function ChatSidebar({
  sessions,
  currentSessionId,
  sidebarOpen,
  isMobile,
  modelOptions,
  renamingId,
  renameValue,
  onRenameValueChange,
  onSelectSession,
  onDeleteSession,
  onStartRename,
  onRenameSubmit,
  onCancelRename,
  onForkSession,
  onNewChat,
  onCloseSidebar,
}: ChatSidebarProps) {
  const navigate = useNavigate();

  // ⋮ 菜单：打开状态 + fixed 定位（Portal 到 body，避免被侧栏 overflow 裁剪）
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuOpenId(null);
    setMenuPos(null);
  }, []);

  const handleToggleMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpenId === id) {
      closeMenu();
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right - 4);
    // 默认向下展开；接近视口底部时向上翻转
    const openUp = rect.bottom + MENU_EST_HEIGHT > window.innerHeight && rect.top > MENU_EST_HEIGHT;
    const top = openUp ? rect.top - MENU_EST_HEIGHT - 4 : rect.bottom + 4;
    setMenuPos({ top: Math.max(8, top), right });
    setMenuOpenId(id);
  }, [menuOpenId, closeMenu]);

  // 点击外部 / Escape / 滚动 / 缩放 → 关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (menuRef.current?.contains(target)) return;
      if (target.closest?.('.history-item-more')) return; // 点 ⋮ 自身交给 onClick 处理
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onScrollOrResize = () => closeMenu();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [menuOpenId, closeMenu]);

  const menuSession = menuOpenId ? sessions.find(s => s.id === menuOpenId) ?? null : null;

  return (
    <aside className={`chat-sidebar glass ${sidebarOpen ? 'open' : ''}`}>
      <div className="chat-new-row">
        <button className="chat-new-btn" onClick={onNewChat}>
          <IconPlus />
          <span>新建对话</span>
        </button>
      </div>

      <div className="chat-history">
        <div className="history-label">历史对话</div>
        {sessions.length > 0 ? (
          sessions.map(session => (
            <div
              key={session.id}
              className={`history-item ${currentSessionId === session.id ? 'active' : ''}`}
              onClick={() => onSelectSession(session.id)}
            >
              {renamingId === session.id ? (
                <div className="history-rename">
                  <input
                    className="rename-input"
                    value={renameValue}
                    onChange={e => onRenameValueChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') onRenameSubmit(session.id);
                      if (e.key === 'Escape') onCancelRename();
                    }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                  <button className="rename-ok" onClick={(e) => { e.stopPropagation(); onRenameSubmit(session.id); }}>✓</button>
                </div>
              ) : (
                <>
                  <div className="history-item-content">
                    <span className="history-item-title">{session.title}</span>
                    <span className="history-item-meta">
                      {session.messages.length} 条 · {formatDate(session.updatedAt)}
                      {session.model && <span className="history-item-model"> · {modelOptions.find(m => m.value === session.model)?.label || session.model}</span>}
                    </span>
                  </div>
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className={`history-item-more ${menuOpenId === session.id ? 'open' : ''}`}
                      title="更多操作"
                      aria-label="更多操作"
                      onClick={(e) => handleToggleMenu(session.id, e)}
                    >
                      <IconMore size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <div className="history-empty">
            <p>暂无历史对话</p>
            <p className="history-empty-hint">点击「新建对话」开始</p>
          </div>
        )}
      </div>

      {isMobile && (
        <button className="sidebar-close" onClick={onCloseSidebar}>
          <IconClose />
        </button>
      )}

      {/* 退出按钮 */}
      <div className="sidebar-footer">
        <button className="sidebar-exit-btn" onClick={() => navigate('/')}>
          <IconExit />
          <span>退出</span>
        </button>
      </div>

      {/* ⋮ 弹出菜单（Portal → body，fixed 定位） */}
      {menuSession && menuPos && createPortal(
        <div
          ref={menuRef}
          className="history-more-menu"
          style={{ top: menuPos.top, right: menuPos.right }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={e => { closeMenu(); onStartRename(menuSession.id, menuSession.title, e); }}
          >
            <IconEdit />
            <span>重命名</span>
          </button>
          <button
            type="button"
            onClick={e => { closeMenu(); onForkSession(menuSession.id, e); }}
          >
            <IconCopy />
            <span>分叉对话</span>
          </button>
          <button
            type="button"
            className="danger"
            onClick={e => { closeMenu(); onDeleteSession(menuSession.id, e); }}
          >
            <IconTrash size={14} />
            <span>删除</span>
          </button>
        </div>,
        document.body,
      )}
    </aside>
  );
});
