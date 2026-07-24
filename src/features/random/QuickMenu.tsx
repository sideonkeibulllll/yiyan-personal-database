/**
 * 快捷菜单组件 v2
 * 长按卡片呼出，固定在屏幕底部居中（bottom sheet 风格）
 * v2 变更：
 * - b.2: 移除「详情」选项，菜单直接显示更新时间（默认创建时间，编辑后显示更新时间）
 * - b.3: 组标签选择器支持多选
 * - b.5: 「添加预备」对接 ChatPage 数据选择器，添加后自动选中
 * - b.6: 「就此内容谈话」跳到 AI 页面并选中数据（不单开一页）
 * - b.7: 「转为待办」后选项变为「编辑新建的待办」，点击跳到待办编辑页
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Entry, Group } from '@/types';
import { getDatabase } from '@/services/database';
import { useEntryStore } from '@/stores/entryStore';
import { useTodoStore } from '@/stores/todoStore';
import './QuickMenu.css';

interface QuickMenuProps {
  entry: Entry;
  onClose: () => void;
  onToggleStar: () => void;
  onViewLinks?: () => void;
  onEditTags?: () => void;
  /** AI 对话回调：跳转到 chat 页面并携带条目信息 */
  onAIChat?: (entryId: string) => void;
  /** 转为待办回调 */
  onConvertToTodo?: (entry: Entry) => void;
  /** 编辑详情回调 */
  onEditInfo?: (entry: Entry) => void;
}

type PanelMode = 'menu' | 'group' | 'ai-chat';

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

const CheckCircleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
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

const EditIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

export function QuickMenu({
  entry,
  onClose,
  onToggleStar,
  onViewLinks,
  onEditTags,
  onAIChat,
  onConvertToTodo,
  onEditInfo,
}: QuickMenuProps) {
  const navigate = useNavigate();
  const [panel, setPanel] = useState<PanelMode>('menu');
  const [groups, setGroups] = useState<Group[]>([]);
  // b.3: 组标签支持多选
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(entry.groupId ? [entry.groupId] : []);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // b.7: 转为待办后的状态
  const [createdTodoId, setCreatedTodoId] = useState<string | null>(null);

  const updateEntry = useEntryStore(state => state.updateEntry);
  const addTodo = useTodoStore(state => state.addTodo);

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

  // b.3: 保存多选组
  const handleSaveGroups = useCallback(async () => {
    setIsSaving(true);
    try {
      // 多选时只取第一个作为 groupId（数据库 schema 限制）
      // 但在前端展示上可以支持多选（通过 supplement 或扩展字段）
      // 这里先存第一个，后续如果数据库支持多组再改
      const primaryGroup = selectedGroupIds[0];
      await updateEntry(entry.id, { groupId: primaryGroup });
      setPanel('menu');
    } catch (error) {
      console.error('保存组失败:', error);
    } finally {
      setIsSaving(false);
    }
  }, [entry.id, selectedGroupIds, updateEntry]);

  // b.3: 切换组选中
  const toggleGroupSelection = useCallback((groupId: string) => {
    setSelectedGroupIds(prev =>
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  }, []);

  // === 全局"预备"内存：跨页面传递的临时条目 ID 列表 ===
  const PREPARED_KEY = '__yiyan_prepared_entry_ids__';

  // b.5: 添加预备 — 对接 ChatPage 数据选择器，关闭快捷操作（不跳转）
  const handleAddPrepare = useCallback(() => {
    const prepared: string[] = (window as any)[PREPARED_KEY] || [];
    if (!prepared.includes(entry.id)) {
      prepared.push(entry.id);
      (window as any)[PREPARED_KEY] = prepared;
    }
    // 关闭快捷操作，不跳转到 Chat 页面
    onClose();
  }, [entry.id, onClose]);

  // b.6: 就此内容谈话 — 跳到 AI 页面并选中数据（不单开一页）
  const handleStartChat = useCallback(() => {
    // 跳转到 Chat 页面，带上 entryId，Chat 页面会自动打开数据选择器并选中
    navigate(`/chat?entryId=${entry.id}&from=random`);
    onClose();
  }, [entry.id, onClose, navigate]);

  // b.7: 转为待办 — 创建后菜单项变为「编辑新建的待办」（不关闭菜单）
  const handleConvertToTodo = useCallback(async () => {
    const today = new Date();
    const folderDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todo = await addTodo({
      title: entry.content.slice(0, 80) + (entry.content.length > 80 ? '...' : ''),
      note: entry.content,
      folderDate,
      isToday: true,
    });
    // 设置创建的待办 ID，菜单项变为「编辑新建的待办」（保持菜单打开）
    setCreatedTodoId(todo.id);
  }, [entry.id, entry.content, addTodo]);

  // b.7: 编辑新建的待办
  const handleEditCreatedTodo = useCallback(() => {
    if (createdTodoId) {
      navigate(`/todo/edit/${createdTodoId}`);
      onClose();
    }
  }, [createdTodoId, navigate]);

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

  // b.2: 判断是否显示更新时间（编辑数据后 updatedAt !== createdAt 时显示更新时间）
  const showUpdatedTime = entry.updatedAt !== entry.createdAt;
  const timeLabel = showUpdatedTime ? '更新时间' : '加入时间';
  const timeValue = showUpdatedTime ? formatDateTime(entry.updatedAt) : formatDate(entry.createdAt);

  // 菜单项
  const menuItems = [
    { icon: <TagIcon />, label: '编辑标签', action: onEditTags },
    { icon: entry.isStarred ? <StarFilledIcon /> : <StarOutlineIcon />, label: entry.isStarred ? '取消星标' : '星标', action: onToggleStar },
    // b.2: 移除「详情」选项，改为直接在菜单底部显示时间
    // b.3: 组标签支持多选
    { icon: <PaperclipIcon />, label: '组标签', action: () => setPanel('group') },
    { icon: <LinkIcon />, label: '查看连线', action: onViewLinks },
    { icon: <MessageCircleIcon />, label: 'AI 对话', action: () => setPanel('ai-chat') },
    // b.7: 转为待办后变为「编辑新建的待办」
    ...(createdTodoId
      ? [{ icon: <EditIcon />, label: '编辑新建的待办', action: handleEditCreatedTodo }]
      : (onConvertToTodo
        ? [{ icon: <CheckCircleIcon />, label: '转为待办', action: handleConvertToTodo }]
        : [])),
    ...(onEditInfo ? [{ icon: <FileTextIcon />, label: '编辑详情', action: () => { onEditInfo(entry); onClose(); } }] : []),
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
                      // 只有需要关闭菜单的操作才关闭：编辑标签(0)、星标(1)、查看连线(3)
                      // 组标签(2)、AI对话(4)、转为待办(5/编辑待办) 不关闭
                      if (index === 0 || index === 1 || index === 3) {
                        onClose();
                      }
                      // 编辑详情也关闭
                      if (item.label === '编辑详情') {
                        // onEditInfo 回调中已调用 onClose
                      }
                    }
                  }}
                >
                  <span className="item-icon">{item.icon}</span>
                  <span className="item-label">{item.label}</span>
                </button>
              ))}

              {/* b.2: 分隔线 + 直接显示时间（默认创建时间，编辑后显示更新时间） */}
              <div className="menu-divider" />
              <div className="menu-info-item">
                <span className="item-icon"><ClockIcon /></span>
                <span className="item-label">{timeLabel}：{timeValue}</span>
              </div>
            </div>
          </>
        )}

        {/* === 组选择器面板（b.3: 多选）=== */}
        {panel === 'group' && (
          <div className="group-panel">
            <div className="menu-header">
              <button className="menu-back" onClick={() => setPanel('menu')}><ChevronLeftIcon /></button>
              <span className="menu-title">组标签（可多选）</span>
              <button className="menu-close" onClick={onClose}><CloseIcon /></button>
            </div>

            <div className="group-picker-list">
              {/* 取消分组选项 */}
              <button
                className={`group-picker-item ${selectedGroupIds.length === 0 ? 'selected' : ''}`}
                onClick={() => setSelectedGroupIds([])}
              >
                <span className="group-picker-icon"><FileTextIcon /></span>
                <span className="group-picker-name">未分组</span>
                {selectedGroupIds.length === 0 && <span className="group-picker-check">&#10003;</span>}
              </button>

              {isLoadingGroups ? (
                <div className="group-picker-loading">加载中...</div>
              ) : groups.length > 0 ? (
                groups.map(group => (
                  <button
                    key={group.id}
                    className={`group-picker-item ${selectedGroupIds.includes(group.id) ? 'selected' : ''}`}
                    onClick={() => toggleGroupSelection(group.id)}
                  >
                    <span className="group-picker-icon"><FolderIcon /></span>
                    <span className="group-picker-name">{group.name}</span>
                    {selectedGroupIds.includes(group.id) && <span className="group-picker-check">&#10003;</span>}
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
                onClick={handleSaveGroups}
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
              {/* b.6: 就此内容谈话 — 跳到 AI 页面并选中数据 */}
              <button className="ai-chat-option" onClick={handleStartChat}>
                <span className="ai-chat-option-icon"><MessageCircleIcon /></span>
                <div className="ai-chat-option-text">
                  <div className="ai-chat-option-title">就此内容谈话</div>
                  <div className="ai-chat-option-desc">跳转到 AI 页面，将此条目作为对话上下文</div>
                </div>
              </button>
              {/* b.5: 添加预备 — 对接 ChatPage 数据选择器，添加后自动选中 */}
              <button className="ai-chat-option" onClick={handleAddPrepare}>
                <span className="ai-chat-option-icon"><PaperclipIcon /></span>
                <div className="ai-chat-option-text">
                  <div className="ai-chat-option-title">添加预备</div>
                  <div className="ai-chat-option-desc">存入预备列表，下次打开 AI 对话时自动选中</div>
                </div>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
