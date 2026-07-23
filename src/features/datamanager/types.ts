/**
 * 数据管理器类型定义
 */

/** 管理模式 */
export type ManagerMode = 'tags' | 'groups' | 'data';

/** 排序方式 */
export type SortBy = 'time' | 'name' | 'usage';

/** 窗口侧 */
export type WindowSide = 'left' | 'right';

/** 路径段 */
export interface PathSegment {
  /** 显示名称 */
  label: string;
  /** 对应的 ID（标签id/组id，根路径为空） */
  id: string;
  /** 路径层级类型 */
  type: 'root' | 'folder';
}

/** 窗口状态 */
export interface WindowState {
  /** 当前模式 */
  mode: ManagerMode;
  /** 当前路径 */
  path: PathSegment[];
  /** 路径历史 */
  history: PathSegment[][];
  /** 历史索引 */
  historyIndex: number;
  /** 选中的条目 ID */
  selectedIds: Set<string>;
  /** 排序方式 */
  sortBy: SortBy;
  /** 刷新计数器（变化时触发重新加载） */
  refreshKey: number;
}

/** 列表项类型 */
export type ListItemType = 'folder' | 'file';

/** 列表项 */
export interface ListItem {
  id: string;
  type: ListItemType;
  title: string;
  subtitle?: string;
  meta?: string;
  isStarred?: boolean;
  /** 附件数量（有附件时显示小按钮，点击进入浏览模式） */
  attachmentCount?: number;
}

/** 导入结果 */
export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/** 创建初始窗口状态 */
export function createInitialWindowState(mode: ManagerMode): WindowState {
  const rootPath: PathSegment[] = getRootPath(mode);
  return {
    mode,
    path: rootPath,
    history: [rootPath],
    historyIndex: 0,
    selectedIds: new Set(),
    sortBy: 'time',
    refreshKey: 0,
  };
}

/** 获取根路径 */
export function getRootPath(mode: ManagerMode): PathSegment[] {
  switch (mode) {
    case 'tags':
      return [{ label: '标签', id: '', type: 'root' }];
    case 'groups':
      return [{ label: '组', id: '', type: 'root' }];
    case 'data':
      return [{ label: '数据', id: '', type: 'root' }];
  }
}

/** 内容 hash 函数 */
export function contentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
