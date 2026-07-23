/**
 * 文件管理器窗口组件
 * 单个窗口，显示列表，支持导航和选择
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Entry } from '@/types';
import type { WindowState, PathSegment, ListItem, SortBy } from './types';
import { getDatabase } from '@/services/database';
import { readThumbAsSrc } from '@/services/attachmentService';
import { ImageViewer } from '@/components/ImageViewer/ImageViewer';
import './FileManagerWindow.css';

interface FileManagerWindowProps {
  side: 'left' | 'right';
  state: WindowState;
  isActive: boolean;
  onSelect: (id: string) => void;
  onMultiSelectToggle: (id: string) => void;
  onLongPress: (id: string) => void;
}

/** Folder icon */
const FolderSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/** Star icon */
const StarSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

/** File text icon */
const FileTextSvg = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8M16 17H8M10 9H8" />
  </svg>
);

/** X (close) icon */
const XSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Paperclip icon（附件标识） */
const PaperclipSvg = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

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
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 点击附件小按钮：读取该条目的所有附件缩略图，打开浏览模式
  const handleAttachmentView = useCallback(async (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    try {
      const db = await getDatabase();
      const entry = await db.getEntryById(entryId);
      if (!entry?.attachments || entry.attachments.length === 0) return;
      const srcs = await Promise.all(entry.attachments.map(a => readThumbAsSrc(a.thumbPath)));
      setViewerImages(srcs.filter(Boolean));
    } catch (err) {
      console.warn('[FileManager] 读取附件失败:', err);
    }
  }, []);

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
  }, [state.path, state.mode, state.sortBy, state.refreshKey]);

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
      // === 修复 2：所有模式（数据/标签/组）下的 file 类型都支持多选切换 ===
      onMultiSelectToggle(item.id);
      // 进入多选模式
      if (!multiSelectMode) {
        setMultiSelectMode(true);
      }
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
          <button className="fm-multi-exit" onClick={handleExitMultiSelect}><XSvg /> 退出多选</button>
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
                    {item.type === 'folder' ? <FolderSvg /> : item.isStarred ? <StarSvg /> : <FileTextSvg />}
                  </span>
                  <div className="fm-item-info">
                    <span className="fm-item-title">
                      {item.title}
                      {item.attachmentCount ? (
                        <button
                          className="fm-item-att-btn"
                          onClick={(e) => handleAttachmentView(e, item.id)}
                          title={`查看 ${item.attachmentCount} 张附件`}
                        >
                          <PaperclipSvg />
                          {item.attachmentCount > 1 && (
                            <span className="fm-att-count">{item.attachmentCount}</span>
                          )}
                        </button>
                      ) : null}
                    </span>
                    {item.subtitle && <span className="fm-item-subtitle">{item.subtitle}</span>}
                  </div>
                  {item.meta && <span className="fm-item-meta">{item.meta}</span>}
                  {multiSelectMode && isSelected && <span className="fm-item-check">&#10003;</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 附件浏览模式 */}
      {viewerImages && viewerImages.length > 0 && (
        <ImageViewer
          images={viewerImages}
          startIndex={0}
          onClose={() => setViewerImages(null)}
        />
      )}
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
    attachmentCount: e.attachments?.length,
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
