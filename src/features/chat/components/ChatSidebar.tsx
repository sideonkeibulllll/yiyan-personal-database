/**
 * Chat 页左侧栏 - 历史会话列表、重命名、分叉、删除
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 */
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconEdit, IconCopy, IconTrash, IconClose, IconExit } from '@/components/icons';
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

export function ChatSidebar({
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
                    <span className="history-item-action" title="重命名" onClick={(e) => onStartRename(session.id, session.title, e)}>
                      <IconEdit />
                    </span>
                    <span className="history-item-action" title="分叉对话" onClick={(e) => onForkSession(session.id, e)}>
                      <IconCopy />
                    </span>
                    <span className="history-item-action history-item-delete" title="删除" onClick={(e) => onDeleteSession(session.id, e)}>
                      <IconTrash size={14} />
                    </span>
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
    </aside>
  );
}