/**
 * 原生平台数据库服务
 * 使用 Capacitor SQLite
 * Electron 环境下通过适配器转发到主进程的 sql.js
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Entry, Tag, Group, Link, Settings, Attachment } from '@/types';
import type { IDatabaseService } from './types';
import { getSharedSQLiteConnection } from './sharedSQLite';

class NativeDatabaseService implements IDatabaseService {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private isElectron: boolean;

  constructor(electron = false) {
    this.isElectron = electron;
    if (electron) {
      // Electron 模式：使用适配器
      const adapter = (globalThis as any).__ELECTRON_SQLITE__;
      this.sqlite = new adapter.SQLiteConnection();
    } else {
      this.sqlite = getSharedSQLiteConnection();
    }
  }

  async init(): Promise<void> {
    if (this.isInitialized && this.db) return;

    // Web 平台需要特殊处理（Electron 不需要）
    if (!this.isElectron && Capacitor.getPlatform() === 'web') {
      await import('jeep-sqlite/loader');
      await customElements.whenDefined('jeep-sqlite');
      await this.sqlite.initWebStore();
    }

    await this.initConnection();
    await this.createTables();
    this.isInitialized = true;
  }

  /**
   * 初始化数据库连接（带重试）
   *
   * Android 上 Capacitor SQLite 的 checkConnectionsConsistency 可能返回 false
   * 或 createConnection 后 open() 静默失败。
   * 此方法尝试多种恢复策略，最多重试 3 次。
   */
  private async initConnection(): Promise<void> {
    const DB_NAME = 'memorydb';
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 快速路径：直接尝试 retrieveConnection（如果连接已存在）
        try {
          this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
          await this.db.open();
          await this.db.query('SELECT 1 as test');
          return; // 成功
        } catch {
          // retrieveConnection 失败，说明连接不存在或不一致，继续创建新连接
        }

        // 创建新连接
        try {
          this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
        } catch (createErr) {
          // 如果连接已存在（原生层有但 JS 层没有），先关闭再重建
          if (String(createErr).includes('already exists')) {
            await this.sqlite.closeConnection(DB_NAME, false);
            this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
          } else {
            throw createErr;
          }
        }
        await this.db.open();

        // 验证连接是否真的可用
        await this.db.query('SELECT 1 as test');
        return; // 成功
      } catch (err) {
        console.warn(`[NativeDatabase] initConnection attempt ${attempt + 1} failed:`, err);
        lastError = err;
        this.db = null;
        // 尝试关闭可能残留的连接
        try {
          await this.sqlite.closeConnection(DB_NAME, false);
        } catch {
          // 忽略关闭失败
        }
        // 短暂等待后重试
        if (attempt < 2) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
    }

    throw new Error(`Database connection failed after 3 attempts: ${lastError}`);
  }

  /**
   * 检查连接健康状态，必要时重新初始化
   * 应在外部调用方发现连接可能丢失时调用
   */
  async ensureConnection(): Promise<void> {
    if (!this.db || !this.isInitialized) {
      this.isInitialized = false;
      this.db = null;
      await this.init();
      return;
    }

    try {
      // 健康检查
      await this.db.query('SELECT 1 as test');
    } catch {
      // 连接已断开，重新初始化
      console.warn('[NativeDatabase] connection lost, reinitializing...');
      this.isInitialized = false;
      this.db = null;
      await this.init();
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const schemas = [
      `CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT,
        group_id TEXT,
        supplement TEXT,
        is_starred INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        copy_count INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT,
        tag_id TEXT,
        PRIMARY KEY (entry_id, tag_id),
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES entries(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES entries(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumb_path TEXT NOT NULL,
        mime_type TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id)`,
    ];

    for (const sql of schemas) {
      await this.db.run(sql, []);
    }
  }

  async createEntry(entry: Omit<Entry, 'tags'>): Promise<Entry> {
    if (!this.db) throw new Error('Database not initialized');
    const sql = `INSERT INTO entries (id, content, source, group_id, supplement, is_starred, created_at, updated_at, last_used_at, copy_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await this.db.run(sql, [
      entry.id, entry.content, entry.source || null, entry.groupId || null,
      entry.supplement || null, entry.isStarred ? 1 : 0, entry.createdAt,
      entry.updatedAt, entry.lastUsedAt || null, entry.copyCount || 0,
    ]);
    return { ...entry, tags: [] };
  }

  async getAllEntries(): Promise<Entry[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM entries ORDER BY created_at DESC');
    const entries: Entry[] = [];
    if (result.values) {
      for (const row of result.values) {
        const tags = await this.getTagsByEntryId(row.id as string);
        entries.push(this.rowToEntry(row, tags));
      }
    }
    await this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getEntryById(id: string): Promise<Entry | null> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM entries WHERE id = ?', [id]);
    if (!result.values || result.values.length === 0) return null;
    const row = result.values[0];
    const tags = await this.getTagsByEntryId(id);
    const attachments = await this.getAttachmentsByEntryId(id);
    return this.rowToEntry(row, tags, attachments);
  }

  async updateEntry(id: string, updates: Partial<Entry>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.source !== undefined) { fields.push('source = ?'); values.push(updates.source); }
    if (updates.groupId !== undefined) { fields.push('group_id = ?'); values.push(updates.groupId); }
    if (updates.supplement !== undefined) { fields.push('supplement = ?'); values.push(updates.supplement); }
    if (updates.isStarred !== undefined) { fields.push('is_starred = ?'); values.push(updates.isStarred ? 1 : 0); }
    if (updates.lastUsedAt !== undefined) { fields.push('last_used_at = ?'); values.push(updates.lastUsedAt); }
    if (updates.copyCount !== undefined) { fields.push('copy_count = ?'); values.push(updates.copyCount); }
    fields.push('updated_at = ?'); values.push(Date.now()); values.push(id);
    await this.db.run(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteEntry(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM entries WHERE id = ?', [id]);
  }

  async searchEntries(keyword: string, options?: { tagIds?: string[]; isStarred?: boolean }): Promise<Entry[]> {
    if (!this.db) throw new Error('Database not initialized');
    let sql = 'SELECT DISTINCT e.* FROM entries e';
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (options?.tagIds && options.tagIds.length > 0) {
      sql += ' JOIN entry_tags et ON e.id = et.entry_id';
      conditions.push(`et.tag_id IN (${options.tagIds.map(() => '?').join(',')})`);
      values.push(...options.tagIds);
    }
    if (keyword) { conditions.push('e.content LIKE ?'); values.push(`%${keyword}%`); }
    if (options?.isStarred !== undefined) { conditions.push('e.is_starred = ?'); values.push(options.isStarred ? 1 : 0); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY e.created_at DESC';
    const result = await this.db.query(sql, values);
    const entries: Entry[] = [];
    if (result.values) {
      for (const row of result.values) {
        const tags = await this.getTagsByEntryId(row.id as string);
        entries.push(this.rowToEntry(row, tags));
      }
    }
    await this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getRecentEntries(limit: number): Promise<Entry[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM entries ORDER BY created_at DESC LIMIT ?', [limit]);
    const entries: Entry[] = [];
    if (result.values) {
      for (const row of result.values) {
        const tags = await this.getTagsByEntryId(row.id as string);
        entries.push(this.rowToEntry(row, tags));
      }
    }
    await this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async createTag(name: string, options?: { isSmart?: boolean; searchCriteria?: { keyword?: string; tagIds?: string[]; isStarred?: boolean } }): Promise<Tag> {
    if (!this.db) throw new Error('Database not initialized');
    const tag: Tag = {
      id: this.generateId(),
      name,
      createdAt: Date.now(),
      ...(options?.isSmart ? { isSmart: true, searchCriteria: options.searchCriteria } : {}),
    };
    // 注意：is_smart 和 search_criteria 字段需要对应的表结构升级
    // 当前版本简化处理：将智能标签信息序列化存储到 name 字段后缓（临时方案）
    // 后续版本应升级 tags 表添加 is_smart BOOLEAN 和 search_criteria TEXT 列
    if (options?.isSmart && options.searchCriteria) {
      await this.db.run(
        'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)',
        [tag.id, `[智能] ${tag.name}`, tag.createdAt]
      );
      // 智能标签搜索条件存在 localStorage
      try {
        const key = `yiyan_smart_tag_${tag.id}`;
        localStorage.setItem(key, JSON.stringify(options.searchCriteria));
      } catch {}
    } else {
      await this.db.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)', [tag.id, tag.name, tag.createdAt]);
    }
    return tag;
  }

  async getAllTags(): Promise<Tag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM tags ORDER BY created_at DESC');
    return result.values?.map(row => ({ id: row.id as string, name: row.name as string, createdAt: row.created_at as number })) || [];
  }

  async getTagsByEntryId(entryId: string): Promise<Tag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT t.* FROM tags t JOIN entry_tags et ON t.id = et.tag_id WHERE et.entry_id = ?',
      [entryId]
    );
    return result.values?.map(row => ({ id: row.id as string, name: row.name as string, createdAt: row.created_at as number })) || [];
  }

  async addTagToEntry(entryId: string, tagId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [entryId, tagId]);
  }

  async removeTagFromEntry(entryId: string, tagId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM entry_tags WHERE entry_id = ? AND tag_id = ?', [entryId, tagId]);
  }

  async deleteTag(tagId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM tags WHERE id = ?', [tagId]);
  }

  async renameTag(tagId: string, newName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('UPDATE tags SET name = ? WHERE id = ?', [newName, tagId]);
  }

  async createLink(sourceId: string, targetId: string, description?: string): Promise<Link> {
    if (!this.db) throw new Error('Database not initialized');
    const link: Link = { id: this.generateId(), sourceId, targetId, description, createdAt: Date.now() };
    await this.db.run(
      'INSERT INTO links (id, source_id, target_id, description, created_at) VALUES (?, ?, ?, ?, ?)',
      [link.id, link.sourceId, link.targetId, link.description || null, link.createdAt]
    );
    return link;
  }

  async getLinksByEntryId(entryId: string): Promise<Link[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT * FROM links WHERE source_id = ? OR target_id = ? ORDER BY created_at DESC',
      [entryId, entryId]
    );
    return result.values?.map(row => ({
      id: row.id as string, sourceId: row.source_id as string,
      targetId: row.target_id as string, description: row.description as string | undefined,
      createdAt: row.created_at as number,
    })) || [];
  }

  async deleteLink(linkId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM links WHERE id = ?', [linkId]);
  }

  async createGroup(name: string): Promise<Group> {
    if (!this.db) throw new Error('Database not initialized');
    const group: Group = { id: this.generateId(), name, sortOrder: 0 };
    await this.db.run('INSERT INTO groups (id, name, sort_order) VALUES (?, ?, ?)', [group.id, group.name, group.sortOrder]);
    return group;
  }

  async getAllGroups(): Promise<Group[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM groups ORDER BY sort_order ASC');
    return result.values?.map(row => ({
      id: row.id as string, name: row.name as string, sortOrder: row.sort_order as number,
    })) || [];
  }

  async updateGroup(groupId: string, updates: Partial<Group>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = []; const values: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder); }
    values.push(groupId);
    await this.db.run(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteGroup(groupId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM groups WHERE id = ?', [groupId]);
  }

  async getEntriesByTagId(tagId: string): Promise<Entry[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT DISTINCT e.* FROM entries e JOIN entry_tags et ON e.id = et.entry_id WHERE et.tag_id = ? ORDER BY e.created_at DESC',
      [tagId]
    );
    const entries: Entry[] = [];
    if (result.values) {
      for (const row of result.values) {
        const tags = await this.getTagsByEntryId(row.id as string);
        entries.push(this.rowToEntry(row, tags));
      }
    }
    await this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getEntriesByGroupId(groupId: string): Promise<Entry[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT * FROM entries WHERE group_id = ? ORDER BY created_at DESC',
      [groupId]
    );
    const entries: Entry[] = [];
    if (result.values) {
      for (const row of result.values) {
        const tags = await this.getTagsByEntryId(row.id as string);
        entries.push(this.rowToEntry(row, tags));
      }
    }
    await this.fillAttachmentsForEntries(entries);
    return entries;
  }

  async getAllContentHashes(): Promise<Set<string>> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT content FROM entries', []);
    const hashes = new Set<string>();
    if (result.values) {
      for (const row of result.values) {
        const content = row.content as string;
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
          const char = content.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        hashes.add(Math.abs(hash).toString(36));
      }
    }
    return hashes;
  }

  async getSettings(): Promise<Settings | null> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT data FROM settings WHERE id = 1');
    if (!result.values || result.values.length === 0) return null;
    try {
      return JSON.parse(result.values[0].data as string) as Settings;
    } catch {
      return null;
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const data = JSON.stringify(settings);
    const now = Date.now();
    await this.db.run(
      'INSERT OR REPLACE INTO settings (id, data, updated_at) VALUES (1, ?, ?)',
      [data, now]
    );
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private rowToEntry(row: Record<string, unknown>, tags: Tag[], attachments: Attachment[] = []): Entry {
    return {
      id: row.id as string, content: row.content as string,
      source: row.source as string | undefined, groupId: row.group_id as string | undefined,
      supplement: row.supplement as string | undefined, isStarred: Boolean(row.is_starred),
      createdAt: row.created_at as number, updatedAt: row.updated_at as number,
      lastUsedAt: row.last_used_at as number | undefined, copyCount: row.copy_count as number,
      tags, attachments,
    };
  }

  private rowToAttachment(row: Record<string, unknown>): Attachment {
    return {
      id: row.id as string,
      entryId: row.entry_id as string,
      filePath: row.file_path as string,
      thumbPath: row.thumb_path as string,
      mimeType: (row.mime_type as string) || 'image/jpeg',
      sortOrder: (row.sort_order as number) ?? 0,
      createdAt: row.created_at as number,
    };
  }

  /** 批量为 entries 填充 attachments（避免 N+1 查询） */
  private async fillAttachmentsForEntries(entries: Entry[]): Promise<void> {
    if (!this.db || entries.length === 0) return;
    const ids = entries.map(e => e.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = await this.db.query(
      `SELECT * FROM attachments WHERE entry_id IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`,
      ids
    );
    const map = new Map<string, Attachment[]>();
    if (result.values) {
      for (const row of result.values) {
        const att = this.rowToAttachment(row);
        const list = map.get(att.entryId) || [];
        list.push(att);
        map.set(att.entryId, list);
      }
    }
    for (const e of entries) {
      e.attachments = map.get(e.id) || [];
    }
  }

  // ==================== 图片附件操作 ====================

  async addAttachment(attachment: Omit<Attachment, 'id'> & { id?: string }): Promise<Attachment> {
    if (!this.db) throw new Error('Database not initialized');
    const id = attachment.id || this.generateId();
    const full: Attachment = { ...attachment, id };
    await this.db.run(
      `INSERT INTO attachments (id, entry_id, file_path, thumb_path, mime_type, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, full.entryId, full.filePath, full.thumbPath, full.mimeType, full.sortOrder, full.createdAt]
    );
    return full;
  }

  async getAttachmentsByEntryId(entryId: string): Promise<Attachment[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT * FROM attachments WHERE entry_id = ? ORDER BY sort_order ASC, created_at ASC',
      [entryId]
    );
    if (!result.values) return [];
    return result.values.map(row => this.rowToAttachment(row));
  }

  async getAllAttachments(): Promise<Attachment[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM attachments ORDER BY created_at ASC', []);
    if (!result.values) return [];
    return result.values.map(row => this.rowToAttachment(row));
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM attachments WHERE id = ?', [attachmentId]);
  }

  async deleteAttachmentsByEntryId(entryId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM attachments WHERE entry_id = ?', [entryId]);
  }

  async updateAttachmentSort(attachmentIds: string[], sortOrder: number[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (attachmentIds.length !== sortOrder.length) {
      throw new Error('attachmentIds 和 sortOrder 长度不一致');
    }
    for (let i = 0; i < attachmentIds.length; i++) {
      await this.db.run(
        'UPDATE attachments SET sort_order = ? WHERE id = ?',
        [sortOrder[i], attachmentIds[i]]
      );
    }
  }
}

export { NativeDatabaseService };
export default NativeDatabaseService;
