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
}

type PanelMode = 'menu' | 'detail' | 'group';

export function QuickMenu({
  entry,
  onClose,
  onToggleStar,
  onViewLinks,
  onEditTags,
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
    { icon: '🏷️', label: '编辑标签', action: onEditTags },
    { icon: entry.isStarred ? '⭐' : '☆', label: entry.isStarred ? '取消星标' : '星标', action: onToggleStar },
    { icon: '📋', label: '详情', action: () => setPanel('detail') },
    { icon: '📎', label: '组标签', action: () => setPanel('group') },
    { icon: '🔗', label: '查看连线', action: onViewLinks },
    { icon: '💬', label: 'AI 对话', action: () => {} },
  ];

  return (
    <div className="quick-menu-overlay" onClick={onClose}>
      <div className="quick-menu glass" onClick={e => e.stopPropagation()}>

        {/* === 主菜单面板 === */}
        {panel === 'menu' && (
          <>
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
                    if (item.action) {
                      item.action();
                      if (index !== 2 && index !== 3) {
                        // 详情和组标签不关闭菜单（切换面板）
                        // AI 对话也不关闭（空函数）
                        // 其他操作关闭菜单
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
                <span className="item-icon">🕒</span>
                <span className="item-label">加入时间：{formatDate(entry.createdAt)}</span>
              </div>
            </div>
          </>
        )}

        {/* === 详情面板 === */}
        {panel === 'detail' && (
          <div className="detail-panel">
            <div className="menu-header">
              <button className="menu-back" onClick={() => setPanel('menu')}>‹</button>
              <span className="menu-title">详情</span>
              <button className="menu-close" onClick={onClose}>✕</button>
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
                <span className="detail-value">{entry.isStarred ? '⭐ 已星标' : '☆ 未星标'}</span>
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
              <button className="menu-back" onClick={() => setPanel('menu')}>‹</button>
              <span className="menu-title">组标签</span>
              <button className="menu-close" onClick={onClose}>✕</button>
            </div>

            <div className="group-picker-list">
              {/* 取消分组选项 */}
              <button
                className={`group-picker-item ${selectedGroupId === undefined ? 'selected' : ''}`}
                onClick={() => setSelectedGroupId(undefined)}
              >
                <span className="group-picker-icon">📝</span>
                <span className="group-picker-name">未分组</span>
                {selectedGroupId === undefined && <span className="group-picker-check">✓</span>}
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
                    <span className="group-picker-icon">📁</span>
                    <span className="group-picker-name">{group.name}</span>
                    {selectedGroupId === group.id && <span className="group-picker-check">✓</span>}
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

      </div>
    </div>
  );
}
