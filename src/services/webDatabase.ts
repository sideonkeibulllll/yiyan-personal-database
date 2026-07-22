/**
 * Web 平台数据库服务
 * 使用 localStorage 存储，便于开发和测试
 */
import type { Entry, Tag, Group, Link, Settings } from '@/types';
import type { IDatabaseService } from './types';

/** Simple content hash for deduplication */
function simpleContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

class WebDatabaseService implements IDatabaseService {
  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  // ==================== 条目操作 ====================

  async createEntry(entry: Omit<Entry, 'tags'>): Promise<Entry> {
    const entries = this.getEntriesFromStorage();
    const newEntry: Entry = { ...entry, tags: [] };
    entries.unshift(newEntry);
    this.saveEntriesToStorage(entries);
    return newEntry;
  }

  async getAllEntries(): Promise<Entry[]> {
    return this.getEntriesFromStorage();
  }

  async getEntryById(id: string): Promise<Entry | null> {
    const entries = this.getEntriesFromStorage();
    return entries.find(e => e.id === id) || null;
  }

  async updateEntry(id: string, updates: Partial<Entry>): Promise<void> {
    const entries = this.getEntriesFromStorage();
    const index = entries.findIndex(e => e.id === id);
    if (index !== -1) {
      entries[index] = { ...entries[index], ...updates };
      this.saveEntriesToStorage(entries);
    }
  }

  async deleteEntry(id: string): Promise<void> {
    const entries = this.getEntriesFromStorage();
    const filtered = entries.filter(e => e.id !== id);
    this.saveEntriesToStorage(filtered);
  }

  async searchEntries(keyword: string, options?: { tagIds?: string[]; isStarred?: boolean }): Promise<Entry[]> {
    let entries = this.getEntriesFromStorage();

    if (keyword) {
      entries = entries.filter(e => e.content.toLowerCase().includes(keyword.toLowerCase()));
    }

    if (options?.tagIds && options.tagIds.length > 0) {
      entries = entries.filter(e => e.tags?.some(t => options.tagIds!.includes(t.id)));
    }

    if (options?.isStarred !== undefined) {
      entries = entries.filter(e => e.isStarred === options.isStarred);
    }

    return entries;
  }

  async getRecentEntries(limit: number): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage();
    return entries.slice(0, limit);
  }

  // ==================== 标签操作 ====================

  async createTag(name: string): Promise<Tag> {
    const tags = this.getTagsFromStorage();
    const existing = tags.find(t => t.name === name);
    if (existing) return existing;

    const tag: Tag = {
      id: this.generateId(),
      name,
      createdAt: Date.now(),
    };
    tags.unshift(tag);
    this.saveTagsToStorage(tags);
    return tag;
  }

  async getAllTags(): Promise<Tag[]> {
    return this.getTagsFromStorage();
  }

  async getTagsByEntryId(entryId: string): Promise<Tag[]> {
    const entries = this.getEntriesFromStorage();
    const entry = entries.find(e => e.id === entryId);
    return entry?.tags || [];
  }

  async addTagToEntry(entryId: string, tagId: string): Promise<void> {
    const entries = this.getEntriesFromStorage();
    const tags = this.getTagsFromStorage();
    const entry = entries.find(e => e.id === entryId);
    const tag = tags.find(t => t.id === tagId);

    if (entry && tag && !entry.tags?.find(t => t.id === tagId)) {
      entry.tags = [...(entry.tags || []), tag];
      this.saveEntriesToStorage(entries);
    }
  }

  async removeTagFromEntry(entryId: string, tagId: string): Promise<void> {
    const entries = this.getEntriesFromStorage();
    const entry = entries.find(e => e.id === entryId);

    if (entry) {
      entry.tags = entry.tags?.filter(t => t.id !== tagId) || [];
      this.saveEntriesToStorage(entries);
    }
  }

  async deleteTag(tagId: string): Promise<void> {
    const tags = this.getTagsFromStorage();
    const filtered = tags.filter(t => t.id !== tagId);
    this.saveTagsToStorage(filtered);

    // 同时从所有条目中移除该标签
    const entries = this.getEntriesFromStorage();
    entries.forEach(entry => {
      entry.tags = entry.tags?.filter(t => t.id !== tagId) || [];
    });
    this.saveEntriesToStorage(entries);
  }

  async renameTag(tagId: string, newName: string): Promise<void> {
    const tags = this.getTagsFromStorage();
    const tag = tags.find(t => t.id === tagId);
    if (tag) {
      tag.name = newName;
      this.saveTagsToStorage(tags);
    }

    // 同时更新所有条目中的标签名
    const entries = this.getEntriesFromStorage();
    entries.forEach(entry => {
      entry.tags?.forEach(t => {
        if (t.id === tagId) t.name = newName;
      });
    });
    this.saveEntriesToStorage(entries);
  }

  // ==================== 连线操作 ====================

  async createLink(sourceId: string, targetId: string, description?: string): Promise<Link> {
    const links = this.getLinksFromStorage();
    const link: Link = {
      id: this.generateId(),
      sourceId,
      targetId,
      description,
      createdAt: Date.now(),
    };
    links.unshift(link);
    this.saveLinksToStorage(links);
    return link;
  }

  async getLinksByEntryId(entryId: string): Promise<Link[]> {
    const links = this.getLinksFromStorage();
    return links.filter(l => l.sourceId === entryId || l.targetId === entryId);
  }

  async deleteLink(linkId: string): Promise<void> {
    const links = this.getLinksFromStorage();
    const filtered = links.filter(l => l.id !== linkId);
    this.saveLinksToStorage(filtered);
  }

  // ==================== 组操作 ====================

  async createGroup(name: string): Promise<Group> {
    const groups = this.getGroupsFromStorage();
    const group: Group = {
      id: this.generateId(),
      name,
      sortOrder: groups.length,
    };
    groups.push(group);
    this.saveGroupsToStorage(groups);
    return group;
  }

  async getAllGroups(): Promise<Group[]> {
    return this.getGroupsFromStorage();
  }

  async updateGroup(groupId: string, updates: Partial<Group>): Promise<void> {
    const groups = this.getGroupsFromStorage();
    const index = groups.findIndex(g => g.id === groupId);
    if (index !== -1) {
      groups[index] = { ...groups[index], ...updates };
      this.saveGroupsToStorage(groups);
    }
  }

  async deleteGroup(groupId: string): Promise<void> {
    const groups = this.getGroupsFromStorage();
    const filtered = groups.filter(g => g.id !== groupId);
    this.saveGroupsToStorage(filtered);
  }

  async getEntriesByTagId(tagId: string): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage();
    return entries.filter(e => e.tags?.some(t => t.id === tagId));
  }

  async getEntriesByGroupId(groupId: string): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage();
    return entries.filter(e => e.groupId === groupId);
  }

  async getAllContentHashes(): Promise<Set<string>> {
    const entries = this.getEntriesFromStorage();
    const hashes = new Set<string>();
    for (const entry of entries) {
      const hash = simpleContentHash(entry.content);
      hashes.add(hash);
    }
    return hashes;
  }

  // ==================== 设置操作 ====================

  async getSettings(): Promise<Settings | null> {
    try {
      const data = localStorage.getItem('yiyan_settings');
      return data ? JSON.parse(data) as Settings : null;
    } catch {
      return null;
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    localStorage.setItem('yiyan_settings', JSON.stringify(settings));
  }

  // ==================== 存储工具 ====================

  private getEntriesFromStorage(): Entry[] {
    try {
      const data = localStorage.getItem('yiyan_entries');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveEntriesToStorage(entries: Entry[]): void {
    localStorage.setItem('yiyan_entries', JSON.stringify(entries));
  }

  private getTagsFromStorage(): Tag[] {
    try {
      const data = localStorage.getItem('yiyan_tags');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveTagsToStorage(tags: Tag[]): void {
    localStorage.setItem('yiyan_tags', JSON.stringify(tags));
  }

  private getLinksFromStorage(): Link[] {
    try {
      const data = localStorage.getItem('yiyan_links');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveLinksToStorage(links: Link[]): void {
    localStorage.setItem('yiyan_links', JSON.stringify(links));
  }

  private getGroupsFromStorage(): Group[] {
    try {
      const data = localStorage.getItem('yiyan_groups');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveGroupsToStorage(groups: Group[]): void {
    localStorage.setItem('yiyan_groups', JSON.stringify(groups));
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export { WebDatabaseService };
export default WebDatabaseService;
