/**
 * 快捷菜单组件
 * 长按卡片呼出，固定在屏幕底部居中（bottom sheet 风格）
 * 包含：详情面板、组选择器
 */
import { useState, useEffect, useCallback } from 'react';
import type { Entry, Group } from '@/types';
import { getDatabase } from '@/services/database';
import { useEntryStore } from '@/stores/entryStore';
import './QuickMenu.css';

interface QuickMenuProps {
  entry: Entry;
  onClose: () => void;
  onToggleStar: () => void;
  onViewLinks?: () => void;
  onEditTags?: () => void;
  /** AI 对话回调：跳转到 chat 页面并携带条目信息 */
  onAIChat?: (entryId: string) => void;
}

type PanelMode = 'menu' | 'detail' | 'group' | 'ai-chat';

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const TagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
    <path d="M7 7h.01"/>
  </svg>
);

const StarFilledIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const StarOutlineIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const ClipboardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
  </svg>
);

const PaperclipIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
  </svg>
);

const LinkIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

const MessageCircleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  </svg>
);

const ClockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6"/>
  </svg>
);

const FileTextIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" x2="8" y1="13" y2="13"/>
    <line x1="16" x2="8" y1="17" y2="17"/>
    <line x1="10" x2="8" y1="9" y2="9"/>
  </svg>
);

const FolderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
  </svg>
);

export function QuickMenu({
  entry,
  onClose,
  onToggleStar,
  onViewLinks,
  onEditTags,
  onAIChat,
}: QuickMenuProps) {
  const [panel, setPanel] = useState<PanelMode>('menu');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(entry.groupId);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const updateEntry = useEntryStore(state => state.updateEntry);

  // 加载组列表
  const loadGroups = useCallback(async () => {
    setIsLoadingGroups(true);
    try {
      const db = await getDatabase();
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);
    } catch (error) {
      console.error('加载组列表失败:', error);
    } finally {
      setIsLoadingGroups(false);
    }
  }, []);

  // 打开组选择器时加载组
  useEffect(() => {
    if (panel === 'group') {
      loadGroups();
    }
  }, [panel, loadGroups]);

  // 保存到组
  const handleSaveGroup = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateEntry(entry.id, { groupId: selectedGroupId });
      setPanel('menu');
    } catch (error) {
      console.error('保存组失败:', error);
    } finally {
      setIsSaving(false);
    }
  }, [entry.id, selectedGroupId, updateEntry]);

  // === 全局“预备”内存：跨页面传递的临时条目 ID 列表 ===
  // 使用 window 上的全局变量（不持久化）
  const PREPARED_KEY = '__yiyan_prepared_entry_ids__';

  const handleAddPrepare = useCallback(() => {
    const prepared: string[] = (window as any)[PREPARED_KEY] || [];
    if (!prepared.includes(entry.id)) {
      prepared.push(entry.id);
      (window as any)[PREPARED_KEY] = prepared;
    }
    onClose();
  }, [entry.id, onClose]);

  const handleStartChat = useCallback(() => {
    if (onAIChat) {
      onAIChat(entry.id);
    }
    onClose();
  }, [entry.id, onAIChat, onClose]);

  // 格式化日期
  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  };

  // 菜单项
  const menuItems = [
    { icon: <TagIcon />, label: '编辑标签', action: onEditTags },
    { icon: entry.isStarred ? <StarFilledIcon /> : <StarOutlineIcon />, label: entry.isStarred ? '取消星标' : '星标', action: onToggleStar },
    { icon: <ClipboardIcon />, label: '详情', action: () => setPanel('detail') },
    { icon: <PaperclipIcon />, label: '组标签', action: () => setPanel('group') },
    { icon: <LinkIcon />, label: '查看连线', action: onViewLinks },
    { icon: <MessageCircleIcon />, label: 'AI 对话', action: () => setPanel('ai-chat') },
  ];

  return (
    <div className="quick-menu-overlay" onClick={onClose}>
      <div className="quick-menu glass" onClick={e => e.stopPropagation()}>

        {/* === 主菜单面板 === */}
        {panel === 'menu' && (
          <>
            <div className="menu-header">
              <span className="menu-title">快捷操作</span>
              <button className="menu-close" onClick={onClose}><CloseIcon /></button>
            </div>

            <div className="menu-items">
              {menuItems.map((item, index) => (
                <button
                  key={index}
                  className="menu-item"
                  onClick={() => {
                    if (item.action) {
                      item.action();
                      if (index !== 2 && index !== 3 && index !== 5) {
                        // 详情、组标签、AI 对话不关闭菜单（切换面板）
                        onClose();
                      }
                    }
                  }}
                >
                  <span className="item-icon">{item.icon}</span>
                  <span className="item-label">{item.label}</span>
                </button>
              ))}

              {/* 分隔线 + 加入时间 */}
              <div className="menu-divider" />
              <div className="menu-info-item">
                <span className="item-icon"><ClockIcon /></span>
                <span className="item-label">加入时间：{formatDate(entry.createdAt)}</span>
              </div>
            </div>
          </>
        )}

        {/* === 详情面板 === */}
        {panel === 'detail' && (
          <div className="detail-panel">
            <div className="menu-header">
              <button className="menu-back" onClick={() => setPanel('menu')}><ChevronLeftIcon /></button>
              <span className="menu-title">详情</span>
              <button className="menu-close" onClick={onClose}><CloseIcon /></button>
            </div>

            <div className="detail-content">
              {/* 完整内容 */}
              <div className="detail-section">
                <div className="detail-section-label">内容</div>
                <div className="detail-section-body">{entry.content}</div>
              </div>

              {/* 来源 */}
              {entry.source && (
                <div className="detail-section">
                  <div className="detail-section-label">来源</div>
                  <div className="detail-section-body detail-source">{entry.source}</div>
                </div>
              )}

              {/* 补充信息 */}
              {entry.supplement && (
                <div className="detail-section">
                  <div className="detail-section-label">补充信息</div>
                  <div className="detail-section-body detail-supplement">{entry.supplement}</div>
                </div>
              )}

              {/* 标签 */}
              {entry.tags && entry.tags.length > 0 && (
                <div className="detail-section">
                  <div className="detail-section-label">标签</div>
                  <div className="detail-tags">
                    {entry.tags.map(tag => (
                      <span key={tag.id} className="detail-tag">#{tag.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 星标状态 */}
              <div className="detail-section detail-row">
                <span className="detail-section-label">星标</span>
                <span className="detail-value">{entry.isStarred ? <><StarFilledIcon /> 已星标</> : <><StarOutlineIcon /> 未星标</>}</span>
              </div>

              {/* 使用次数 */}
              <div className="detail-section detail-row">
                <span className="detail-section-label">使用次数</span>
                <span className="detail-value">{entry.copyCount} 次</span>
              </div>

              {/* 创建时间 */}
              <div className="detail-section detail-row">
                <span className="detail-section-label">创建时间</span>
                <span className="detail-value">{formatDateTime(entry.createdAt)}</span>
              </div>

              {/* 更新时间 */}
              <div className="detail-section detail-row">
                <span className="detail-section-label">更新时间</span>
                <span className="detail-value">{formatDateTime(entry.updatedAt)}</span>
              </div>
            </div>
          </div>
        )}

        {/* === 组选择器面板 === */}
        {panel === 'group' && (
          <div className="group-panel">
            <div className="menu-header">
              <button className="menu-back" onClick={() => setPanel('menu')}><ChevronLeftIcon /></button>
              <span className="menu-title">组标签</span>
              <button className="menu-close" onClick={onClose}><CloseIcon /></button>
            </div>

            <div className="group-picker-list">
              {/* 取消分组选项 */}
              <button
                className={`group-picker-item ${selectedGroupId === undefined ? 'selected' : ''}`}
                onClick={() => setSelectedGroupId(undefined)}
              >
                <span className="group-picker-icon"><FileTextIcon /></span>
                <span className="group-picker-name">未分组</span>
                {selectedGroupId === undefined && <span className="group-picker-check">&#10003;</span>}
              </button>

              {isLoadingGroups ? (
                <div className="group-picker-loading">加载中...</div>
              ) : groups.length > 0 ? (
                groups.map(group => (
                  <button
                    key={group.id}
                    className={`group-picker-item ${selectedGroupId === group.id ? 'selected' : ''}`}
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <span className="group-picker-icon"><FolderIcon /></span>
                    <span className="group-picker-name">{group.name}</span>
                    {selectedGroupId === group.id && <span className="group-picker-check">&#10003;</span>}
                  </button>
                ))
              ) : (
                <div className="group-picker-empty">还没有创建组</div>
              )}
            </div>

            {/* 底部操作按钮 */}
            <div className="group-picker-actions">
              <button
                className="group-picker-btn group-picker-cancel"
                onClick={() => setPanel('menu')}
                disabled={isSaving}
              >
                取消
              </button>
              <button
                className="group-picker-btn group-picker-confirm"
                onClick={handleSaveGroup}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : '确定'}
              </button>
            </div>
          </div>
        )}

        {/* === AI 对话面板 === */}
        {panel === 'ai-chat' && (
          <div className="group-panel ai-chat-panel">
            <div className="menu-header">
              <button className="menu-back" onClick={() => setPanel('menu')}><ChevronLeftIcon /></button>
              <span className="menu-title">AI 对话</span>
              <button className="menu-close" onClick={onClose}><CloseIcon /></button>
            </div>

            <div className="ai-chat-options">
              <button className="ai-chat-option" onClick={handleStartChat}>
                <span className="ai-chat-option-icon"><MessageCircleIcon /></span>
                <div className="ai-chat-option-text">
                  <div className="ai-chat-option-title">就此内容谈话</div>
                  <div className="ai-chat-option-desc">跳转到 Chat 页面，将此条目作为上下文</div>
                </div>
              </button>
              <button className="ai-chat-option" onClick={handleAddPrepare}>
                <span className="ai-chat-option-icon"><PaperclipIcon /></span>
                <div className="ai-chat-option-text">
                  <div className="ai-chat-option-title">添加预备</div>
                  <div className="ai-chat-option-desc">存入内存，在 Chat 页面「就此内容谈话」后自动带入</div>
                </div>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
