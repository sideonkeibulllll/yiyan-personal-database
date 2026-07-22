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

/** X (close) icon */
const XCloseSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** File text icon (for ungrouped) */
const FileTextSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" />
  </svg>
);

/** Folder icon */
const FolderSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/** Plus icon */
const PlusSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function GroupSelector({ selectedGroupId, onSelect, onClose }: GroupSelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

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
      <div className="selector-header">
        <h3 className="selector-title">选择所属组</h3>
        {onClose && (
          <button className="selector-close" onClick={onClose}><XCloseSvg /></button>
        )}
      </div>
      <div className="group-list">
        <button
          className={`group-item ${!selectedGroupId ? 'selected' : ''}`}
          onClick={() => onSelect(undefined)}
        >
          <span className="group-icon"><FileTextSvg /></span>
          <span className="group-name">未分组</span>
          {!selectedGroupId && <span className="group-check">&#10003;</span>}
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
              <span className="group-icon"><FolderSvg /></span>
              <span className="group-name">{group.name}</span>
              {selectedGroupId === group.id && <span className="group-check">&#10003;</span>}
            </button>
          ))
        ) : (
          <div className="no-groups">
            <p>还没有创建组</p>
          </div>
        )}
      </div>
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
            <span className="btn-icon"><PlusSvg /></span>
            <span>新建组</span>
          </button>
        )}
      </div>
    </div>
  );
}

export type { GroupSelectorProps };