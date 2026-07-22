/**
 * 文件管理器窗口组件
 * 单个窗口，显示列表，支持导航和选择
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Entry } from '@/types';
import type { WindowState, PathSegment, ListItem, SortBy } from './types';
import { getDatabase } from '@/services/database';
import './FileManagerWindow.css';

interface FileManagerWindowProps {
  side: 'left' | 'right';
  state: WindowState;
  isActive: boolean;
  onSelect: (id: string) => void;
  onMultiSelectToggle: (id: string) => void;
  onLongPress: (id: string) => void;
}

export function FileManagerWindow({
  side,
  state,
  isActive,
  onSelect,
  onMultiSelectToggle,
  onLongPress,
}: FileManagerWindowProps) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const currentPath = state.path;
      const isRoot = currentPath.length === 1 && currentPath[0].type === 'root';
      const mode = state.mode;

      if (isRoot) {
        // 根路径：显示文件夹列表
        if (mode === 'tags') {
          const tags = await db.getAllTags();
          const allEntries = await db.getAllEntries();
          const list: ListItem[] = tags.map(tag => ({
            id: tag.id,
            type: 'folder',
            title: tag.name,
            subtitle: '标签',
            meta: `${allEntries.filter(e => e.tags?.some(t => t.id === tag.id)).length} 条`,
          }));
          setItems(sortItems(list, state.sortBy));
        } else if (mode === 'groups') {
          const groups = await db.getAllGroups();
          const allEntries = await db.getAllEntries();
          const list: ListItem[] = groups.map(group => ({
            id: group.id,
            type: 'folder',
            title: group.name,
            subtitle: '组',
            meta: `${allEntries.filter(e => e.groupId === group.id).length} 条`,
          }));
          setItems(sortItems(list, state.sortBy));
        } else {
          // 数据模式根路径直接显示所有条目
          const entries = await db.getAllEntries();
          setItems(entriesToItems(entries, state.sortBy));
        }
      } else {
        // 进入文件夹：显示条目
        const folderId = currentPath[currentPath.length - 1].id;
        let entries: Entry[] = [];
        if (mode === 'tags') {
          entries = await db.getEntriesByTagId(folderId);
        } else if (mode === 'groups') {
          entries = await db.getEntriesByGroupId(folderId);
        }
        setItems(entriesToItems(entries, state.sortBy));
      }
    } catch (err) {
      console.error('Load items error:', err);
    } finally {
      setLoading(false);
    }
  }, [state.path, state.mode, state.sortBy]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // 重置多选模式当路径变化
  useEffect(() => {
    setMultiSelectMode(false);
  }, [state.path]);

  const handleItemClick = (item: ListItem) => {
    if (multiSelectMode) {
      onMultiSelectToggle(item.id);
      return;
    }
    if (item.type === 'folder') {
      // 进入文件夹
      const newPath = [...state.path, { label: item.title, id: item.id, type: 'folder' as const }];
      // 通过路径变化触发父组件更新
      const event = new CustomEvent('dm-navigate', { detail: { side, path: newPath } });
      window.dispatchEvent(event);
    } else {
      onSelect(item.id);
    }
  };

  const handleItemLongPress = (item: ListItem) => {
    if (item.type === 'file') {
      // 长按只弹出菜单，不影响选中状态
      onLongPress(item.id);
    }
  };

  const startLongPress = (item: ListItem) => {
    longPressTimer.current = setTimeout(() => {
      handleItemLongPress(item);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleExitMultiSelect = () => {
    setMultiSelectMode(false);
    // 清除选中
    const event = new CustomEvent('dm-clear-selection', { detail: { side } });
    window.dispatchEvent(event);
  };

  return (
    <div className={`fm-window ${isActive ? 'active' : ''} ${side}`}>
      <div className="fm-window-path">
        {state.path.map((seg, i) => (
          <span key={i} className="fm-path-segment">
            {i > 0 && <span className="fm-path-sep">/</span>}
            <span className="fm-path-label">{seg.label}</span>
          </span>
        ))}
        {multiSelectMode && (
          <button className="fm-multi-exit" onClick={handleExitMultiSelect}>✕ 退出多选</button>
        )}
      </div>
      <div className="fm-window-content">
        {loading ? (
          <div className="fm-loading">加载中...</div>
        ) : items.length === 0 ? (
          <div className="fm-empty">暂无数据</div>
        ) : (
          <ul className="fm-list">
            {items.map(item => {
              const isSelected = state.selectedIds.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`fm-list-item ${item.type} ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleItemClick(item)}
                  onTouchStart={() => startLongPress(item)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onMouseDown={() => startLongPress(item)}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                >
                  <span className="fm-item-icon">
                    {item.type === 'folder' ? '📁' : item.isStarred ? '⭐' : '📄'}
                  </span>
                  <div className="fm-item-info">
                    <span className="fm-item-title">{item.title}</span>
                    {item.subtitle && <span className="fm-item-subtitle">{item.subtitle}</span>}
                  </div>
                  {item.meta && <span className="fm-item-meta">{item.meta}</span>}
                  {multiSelectMode && isSelected && <span className="fm-item-check">✓</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 条目转列表项 */
function entriesToItems(entries: Entry[], sortBy: SortBy): ListItem[] {
  const items: ListItem[] = entries.map(e => ({
    id: e.id,
    type: 'file',
    title: e.content.length > 40 ? e.content.slice(0, 40) + '...' : e.content,
    subtitle: e.source || undefined,
    meta: formatDate(e.createdAt),
    isStarred: e.isStarred,
  }));

  return sortItems(items, sortBy);
}

/** 排序列表项 */
function sortItems(items: ListItem[], sortBy: SortBy): ListItem[] {
  const sorted = [...items];
  switch (sortBy) {
    case 'name':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'time':
      // 文件夹优先，然后按 meta 降序
      return sorted.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (b.meta || '').localeCompare(a.meta || '');
      });
    case 'usage':
      return sorted.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (b.meta || '').localeCompare(a.meta || '');
      });
    default:
      return sorted;
  }
}

/** 格式化日期 */
function formatDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
