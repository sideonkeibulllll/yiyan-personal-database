/**
 * 数据库服务接口
 */
import type { Entry, Tag, Group, Link } from '@/types';

export interface IDatabaseService {
  init(): Promise<void>;

  // 条目操作
  createEntry(entry: Omit<Entry, 'tags'>): Promise<Entry>;
  getAllEntries(): Promise<Entry[]>;
  getEntryById(id: string): Promise<Entry | null>;
  updateEntry(id: string, updates: Partial<Entry>): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  searchEntries(keyword: string, options?: { tagIds?: string[]; isStarred?: boolean }): Promise<Entry[]>;
  getRecentEntries(limit: number): Promise<Entry[]>;

  // 标签操作
  createTag(name: string): Promise<Tag>;
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
}
