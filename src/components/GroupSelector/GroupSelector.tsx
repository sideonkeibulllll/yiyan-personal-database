/**
 * 组选择栏组件
 * 用于选择所属组（工作区概念）
 */
import { useState, useCallback } from 'react';
import { getDatabase } from '@/services/database';
import type { Group } from '@/types';
import './GroupSelector.css';

interface GroupSelectorProps {
  selectedGroupId?: string;
  onSelect: (groupId?: string) => void;
  onClose?: () => void;
}

export function GroupSelector({ selectedGroupId, onSelect, onClose }: GroupSelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // 加载组列表
  useState(() => {
    const loadGroups = async () => {
      try {
        const db = await getDatabase();
        const allGroups = await db.getAllGroups();
        setGroups(allGroups);
      } catch (error) {
        console.error('加载组失败:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadGroups();
  });

  // 创建新组
  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;

    try {
      const db = await getDatabase();
      const group = await db.createGroup(newGroupName.trim());
      setGroups(prev => [...prev, group]);
      onSelect(group.id);
      setNewGroupName('');
      setIsCreating(false);
    } catch (error) {
      console.error('创建组失败:', error);
    }
  }, [newGroupName, onSelect]);

  return (
    <div className="group-selector">
      {/* 头部 */}
      <div className="selector-header">
        <h3 className="selector-title">选择所属组</h3>
        {onClose && (
          <button className="selector-close" onClick={onClose}>✕</button>
        )}
      </div>

      {/* 组列表 */}
      <div className="group-list">
        {/* 无组选项 */}
        <button
          className={`group-item ${!selectedGroupId ? 'selected' : ''}`}
          onClick={() => onSelect(undefined)}
        >
          <span className="group-icon">📝</span>
          <span className="group-name">未分组</span>
          {!selectedGroupId && <span className="group-check">✓</span>}
        </button>

        {isLoading ? (
          <div className="loading-text">加载中...</div>
        ) : groups.length > 0 ? (
          groups.map(group => (
            <button
              key={group.id}
              className={`group-item ${selectedGroupId === group.id ? 'selected' : ''}`}
              onClick={() => onSelect(group.id)}
            >
              <span className="group-icon">📁</span>
              <span className="group-name">{group.name}</span>
              {selectedGroupId === group.id && <span className="group-check">✓</span>}
            </button>
          ))
        ) : (
          <div className="no-groups">
            <p>还没有创建组</p>
          </div>
        )}
      </div>

      {/* 创建新组 */}
      <div className="create-group">
        {isCreating ? (
          <div className="create-form glass">
            <input
              type="text"
              className="create-input"
              placeholder="输入组名称..."
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              autoFocus
            />
            <button
              className="create-confirm"
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim()}
            >
              确认
            </button>
            <button
              className="create-cancel"
              onClick={() => {
                setIsCreating(false);
                setNewGroupName('');
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <button className="create-trigger glass" onClick={() => setIsCreating(true)}>
            <span className="btn-icon">+</span>
            <span>新建组</span>
          </button>
        )}
      </div>
    </div>
  );
}

export type { GroupSelectorProps };
