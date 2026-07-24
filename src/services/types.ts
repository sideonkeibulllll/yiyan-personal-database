/**
 * 数据库服务接口
 */
import type { Entry, Tag, Group, Link, Settings, Attachment, Todo, TodoTag, TodoTemplate, TodoTemplateItem, TodoSearchTimeFilter } from '@/types';

/** 对话历史会话（v2.0.0 新增） */
export interface ChatSession {
  id: string;
  title: string;
  messages: unknown[];  // ChatMessage[] 但为避免循环依赖用 unknown[]
  createdAt: number;
  updatedAt: number;
  model?: string;
  mcpEnabledTools?: string[];
  mcpSearchResults?: { entryId: string; content: string; source?: string }[];
}

export interface IDatabaseService {
  init(): Promise<void>;

  // 条目操作
  createEntry(entry: Omit<Entry, 'tags' | 'attachments'>): Promise<Entry>;
  getAllEntries(): Promise<Entry[]>;
  getEntryById(id: string): Promise<Entry | null>;
  updateEntry(id: string, updates: Partial<Entry>): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  searchEntries(keyword: string, options?: { tagIds?: string[]; isStarred?: boolean; hasAttachment?: boolean }): Promise<Entry[]>;
  getRecentEntries(limit: number): Promise<Entry[]>;

  // 标签操作
  createTag(name: string, options?: { isSmart?: boolean; searchCriteria?: { keyword?: string; tagIds?: string[]; isStarred?: boolean; hasAttachment?: boolean } }): Promise<Tag>;
  getAllTags(): Promise<Tag[]>;
  getTagsByEntryId(entryId: string): Promise<Tag[]>;
  addTagToEntry(entryId: string, tagId: string): Promise<void>;
  removeTagFromEntry(entryId: string, tagId: string): Promise<void>;
  deleteTag(tagId: string): Promise<void>;
  renameTag(tagId: string, newName: string): Promise<void>;

  // 连线操作
  createLink(sourceId: string, targetId: string, description?: string): Promise<Link>;
  getLinksByEntryId(entryId: string): Promise<Link[]>;
  deleteLink(linkId: string): Promise<void>;

  // 组操作
  createGroup(name: string): Promise<Group>;
  getAllGroups(): Promise<Group[]>;
  updateGroup(groupId: string, updates: Partial<Group>): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;

  // 图片附件操作
  // id 可选传入：导入/同步场景下复用源设备 id，便于跨设备按需拉取原图
  addAttachment(attachment: Omit<Attachment, 'id'> & { id?: string }): Promise<Attachment>;
  getAttachmentsByEntryId(entryId: string): Promise<Attachment[]>;
  getAllAttachments(): Promise<Attachment[]>;
  deleteAttachment(attachmentId: string): Promise<void>;
  deleteAttachmentsByEntryId(entryId: string): Promise<void>;
  updateAttachmentSort(attachmentIds: string[], sortOrder: number[]): Promise<void>;

  // 扩展查询
  getEntriesByTagId(tagId: string): Promise<Entry[]>;
  getEntriesByGroupId(groupId: string): Promise<Entry[]>;
  getAllContentHashes(): Promise<Set<string>>;

  // 设置操作
  getSettings(): Promise<Settings | null>;
  saveSettings(settings: Settings): Promise<void>;

  // 对话历史操作（v2.0.0 新增）
  saveChatSession(session: ChatSession): Promise<void>;
  getAllChatSessions(): Promise<ChatSession[]>;
  deleteChatSession(id: string): Promise<void>;
  deleteAllChatSessions(): Promise<void>;
}

/**
 * 待办数据库服务接口（独立数据层）
 */
export interface ITodoDatabaseService {
  init(): Promise<void>;

  // 待办 CRUD
  createTodo(todo: Omit<Todo, 'id'>): Promise<Todo>;
  getTodoById(id: string): Promise<Todo | null>;
  updateTodo(id: string, updates: Partial<Todo>): Promise<void>;
  /** 软删除：移入回收站 */
  deleteTodo(id: string): Promise<void>;
  /** 恢复回收站中的待办 */
  restoreTodo(id: string): Promise<void>;
  /** 彻底删除 */
  permanentDeleteTodo(id: string): Promise<void>;
  /** 清空回收站 */
  emptyRecycleBin(): Promise<void>;
  /** 获取某日的待办 */
  getTodosByDate(folderDate: string): Promise<Todo[]>;
  /** 获取所有未删除的待办 */
  getAllTodos(options?: { includeDeleted?: boolean }): Promise<Todo[]>;
  /** 获取回收站中的待办 */
  getDeletedTodos(): Promise<Todo[]>;
  /** 搜索待办 */
  searchTodos(keyword: string, timeFilter: TodoSearchTimeFilter): Promise<Todo[]>;
  /** 批量更新时间 */
  batchUpdateTime(ids: string[], offsetMs: number): Promise<void>;
  /** 批量添加标签 */
  batchAddTags(ids: string[], tagIds: string[]): Promise<void>;

  // 待办标签
  createTodoTag(name: string, color?: string): Promise<TodoTag>;
  getAllTodoTags(): Promise<TodoTag[]>;
  updateTodoTag(tagId: string, updates: Partial<TodoTag>): Promise<void>;
  deleteTodoTag(tagId: string): Promise<void>;
  setTodoTags(todoId: string, tagIds: string[]): Promise<void>;

  // 模板
  createTemplate(name: string): Promise<TodoTemplate>;
  getAllTemplates(): Promise<TodoTemplate[]>;
  getTemplateById(id: string): Promise<TodoTemplate | null>;
  updateTemplate(id: string, updates: Partial<TodoTemplate>): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  getTemplateItems(templateId: string): Promise<TodoTemplateItem[]>;
  addTemplateItem(item: Omit<TodoTemplateItem, 'id'>): Promise<TodoTemplateItem>;
  updateTemplateItem(id: string, updates: Partial<TodoTemplateItem>): Promise<void>;
  deleteTemplateItem(id: string): Promise<void>;
  /** 将模板应用到指定日期 */
  importTemplateToDate(templateId: string, folderDate: string): Promise<Todo[]>;
}
