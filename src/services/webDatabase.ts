/**
 * Web 平台数据库服务
 * 使用 localStorage 存储，便于开发和测试
 */
import type { Entry, Tag, Group, Link, Settings, Attachment } from '@/types';
import type { IDatabaseService, ChatSession } from './types';

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

  async createEntry(entry: Omit<Entry, 'tags' | 'attachments'>): Promise<Entry> {
    const entries = this.getEntriesFromStorage();
    const newEntry: Entry = { ...entry, tags: [], attachments: [] };
    entries.unshift(newEntry);
    this.saveEntriesToStorage(entries);
    return newEntry;
  }

  async getAllEntries(): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage();
    this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getEntryById(id: string): Promise<Entry | null> {
    const entries = this.getEntriesFromStorage();
    const entry = entries.find(e => e.id === id) || null;
    if (entry) {
      entry.attachments = this.getAttachmentsFromStorage().filter(a => a.entryId === id);
    }
    return entry;
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
    // 级联删除附件记录
    const attachments = this.getAttachmentsFromStorage();
    this.saveAttachmentsToStorage(attachments.filter(a => a.entryId !== id));
  }

  async searchEntries(keyword: string, options?: { tagIds?: string[]; isStarred?: boolean; hasAttachment?: boolean }): Promise<Entry[]> {
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

    this.fillAttachmentsForEntries(entries);

    if (options?.hasAttachment !== undefined) {
      entries = entries.filter(e => (e.attachments && e.attachments.length > 0) === options.hasAttachment);
    }

    return entries;
  }

  async getRecentEntries(limit: number): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage().slice(0, limit);
    this.fillAttachmentsForEntries(entries);
    return entries;
  }

  // ==================== 图片附件操作 ====================

  async addAttachment(attachment: Omit<Attachment, 'id'> & { id?: string }): Promise<Attachment> {
    const attachments = this.getAttachmentsFromStorage();
    const full: Attachment = { ...attachment, id: attachment.id || this.generateId() };
    attachments.push(full);
    this.saveAttachmentsToStorage(attachments);
    return full;
  }

  async getAttachmentsByEntryId(entryId: string): Promise<Attachment[]> {
    return this.getAttachmentsFromStorage()
      .filter(a => a.entryId === entryId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  }

  async getAllAttachments(): Promise<Attachment[]> {
    return this.getAttachmentsFromStorage();
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    const attachments = this.getAttachmentsFromStorage();
    this.saveAttachmentsToStorage(attachments.filter(a => a.id !== attachmentId));
  }

  async deleteAttachmentsByEntryId(entryId: string): Promise<void> {
    const attachments = this.getAttachmentsFromStorage();
    this.saveAttachmentsToStorage(attachments.filter(a => a.entryId !== entryId));
  }

  async updateAttachmentSort(attachmentIds: string[], sortOrder: number[]): Promise<void> {
    if (attachmentIds.length !== sortOrder.length) {
      throw new Error('attachmentIds 和 sortOrder 长度不一致');
    }
    const attachments = this.getAttachmentsFromStorage();
    const idToOrder = new Map<string, number>();
    for (let i = 0; i < attachmentIds.length; i++) {
      idToOrder.set(attachmentIds[i], sortOrder[i]);
    }
    for (const att of attachments) {
      if (idToOrder.has(att.id)) {
        att.sortOrder = idToOrder.get(att.id)!;
      }
    }
    this.saveAttachmentsToStorage(attachments);
  }

  // ==================== 标签操作 ====================

  async createTag(name: string, options?: { isSmart?: boolean; searchCriteria?: { keyword?: string; tagIds?: string[]; isStarred?: boolean } }): Promise<Tag> {
    const tags = this.getTagsFromStorage();
    const existing = tags.find(t => t.name === name && !t.isSmart && !options?.isSmart);
    if (existing && !options?.isSmart) return existing;

    const tag: Tag = {
      id: this.generateId(),
      name,
      createdAt: Date.now(),
      ...(options?.isSmart ? { isSmart: true, searchCriteria: options.searchCriteria } : {}),
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
    const entries = this.getEntriesFromStorage().filter(e => e.tags?.some(t => t.id === tagId));
    this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getEntriesByGroupId(groupId: string): Promise<Entry[]> {
    const entries = this.getEntriesFromStorage().filter(e => e.groupId === groupId);
    this.fillAttachmentsForEntries(entries);
    return entries;
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

  // ==================== 对话历史操作 ====================

  async saveChatSession(session: ChatSession): Promise<void> {
    const sessions = this.getChatSessionsFromStorage();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.unshift(session);
    }
    this.saveChatSessionsToStorage(sessions);
  }

  async getAllChatSessions(): Promise<ChatSession[]> {
    return this.getChatSessionsFromStorage().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteChatSession(id: string): Promise<void> {
    const sessions = this.getChatSessionsFromStorage().filter(s => s.id !== id);
    this.saveChatSessionsToStorage(sessions);
  }

  async deleteAllChatSessions(): Promise<void> {
    this.saveChatSessionsToStorage([]);
  }

  private getChatSessionsFromStorage(): ChatSession[] {
    try {
      const data = localStorage.getItem('yiyan_chat_sessions_db');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveChatSessionsToStorage(sessions: ChatSession[]): void {
    try { localStorage.setItem('yiyan_chat_sessions_db', JSON.stringify(sessions)); } catch { /* ignore */ }
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

  private getAttachmentsFromStorage(): Attachment[] {
    try {
      const data = localStorage.getItem('yiyan_attachments');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveAttachmentsToStorage(attachments: Attachment[]): void {
    localStorage.setItem('yiyan_attachments', JSON.stringify(attachments));
  }

  /** 批量为 entries 填充 attachments */
  private fillAttachmentsForEntries(entries: Entry[]): void {
    if (entries.length === 0) return;
    const all = this.getAttachmentsFromStorage();
    const map = new Map<string, Attachment[]>();
    for (const att of all) {
      const list = map.get(att.entryId) || [];
      list.push(att);
      map.set(att.entryId, list);
    }
    for (const e of entries) {
      const list = (map.get(e.id) || []).slice().sort(
        (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
      );
      e.attachments = list;
    }
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export { WebDatabaseService };
export default WebDatabaseService;
