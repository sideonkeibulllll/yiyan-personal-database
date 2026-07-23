/**
 * 原生平台待办数据库服务
 * 使用 Capacitor SQLite，独立于笔记数据
 * Electron 环境下通过适配器转发到主进程的 sql.js
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Todo, TodoTag, TodoTemplate, TodoTemplateItem, TodoSearchTimeFilter } from '@/types';
import type { ITodoDatabaseService } from './types';

class NativeTodoDatabaseService implements ITodoDatabaseService {
  private sqlite: SQLiteConnection;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;
  private isElectron: boolean;

  constructor(electron = false) {
    this.isElectron = electron;
    if (electron) {
      const adapter = (globalThis as any).__ELECTRON_SQLITE__;
      this.sqlite = new adapter.SQLiteConnection();
    } else {
      this.sqlite = new SQLiteConnection(CapacitorSQLite);
    }
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.isElectron && Capacitor.getPlatform() === 'web') {
      await import('jeep-sqlite/loader');
      await customElements.whenDefined('jeep-sqlite');
      await this.sqlite.initWebStore();
    }

    const ret = await this.sqlite.checkConnectionsConsistency();
    const isConn = (await this.sqlite.isConnection('memorydb_todo', false)).result;

    if (ret.result && isConn) {
      this.db = await this.sqlite.retrieveConnection('memorydb_todo', false);
    } else {
      this.db = await this.sqlite.createConnection('memorydb_todo', false, 'no-encryption', 1, false);
    }

    await this.db.open();
    await this.createTables();
    this.isInitialized = true;
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Todo database not initialized');

    const schemas = [
      `CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT,
        status TEXT DEFAULT 'pending',
        start_time INTEGER,
        end_time INTEGER,
        is_today INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        deleted_at INTEGER,
        folder_date TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_todos_folder_date ON todos(folder_date)`,
      `CREATE INDEX IF NOT EXISTS idx_todos_deleted_at ON todos(deleted_at)`,
      `CREATE TABLE IF NOT EXISTS todo_tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS todo_tag_relations (
        todo_id TEXT,
        tag_id TEXT,
        PRIMARY KEY (todo_id, tag_id),
        FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES todo_tags(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS todo_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS todo_template_items (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        title TEXT NOT NULL,
        note TEXT,
        start_time INTEGER,
        end_time INTEGER,
        is_today INTEGER DEFAULT 0,
        tag_ids TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (template_id) REFERENCES todo_templates(id) ON DELETE CASCADE
      )`,
    ];

    for (const sql of schemas) {
      await this.db.run(sql, []);
    }
  }

  // ==================== 待办 CRUD ====================

  async createTodo(todo: Omit<Todo, 'id'>): Promise<Todo> {
    if (!this.db) throw new Error('Database not initialized');
    const id = this.generateId();
    await this.db.run(
      `INSERT INTO todos (id, title, note, status, start_time, end_time, is_today, created_at, updated_at, completed_at, deleted_at, folder_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, todo.title, todo.note || null, todo.status, todo.startTime || null, todo.endTime || null,
       todo.isToday ? 1 : 0, todo.createdAt, todo.updatedAt, todo.completedAt || null, todo.deletedAt || null, todo.folderDate]
    );

    // 保存标签关联
    if (todo.tagIds && todo.tagIds.length > 0) {
      for (const tagId of todo.tagIds) {
        await this.db.run(
          'INSERT OR IGNORE INTO todo_tag_relations (todo_id, tag_id) VALUES (?, ?)',
          [id, tagId]
        );
      }
    }

    return { ...todo, id };
  }

  async getTodoById(id: string): Promise<Todo | null> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM todos WHERE id = ?', [id]);
    if (!result.values || result.values.length === 0) return null;
    return await this.rowToTodo(result.values[0]);
  }

  async updateTodo(id: string, updates: Partial<Todo>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.note !== undefined) { fields.push('note = ?'); values.push(updates.note); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.startTime !== undefined) { fields.push('start_time = ?'); values.push(updates.startTime); }
    if (updates.endTime !== undefined) { fields.push('end_time = ?'); values.push(updates.endTime); }
    if (updates.isToday !== undefined) { fields.push('is_today = ?'); values.push(updates.isToday ? 1 : 0); }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
    if (updates.deletedAt !== undefined) { fields.push('deleted_at = ?'); values.push(updates.deletedAt); }
    if (updates.folderDate !== undefined) { fields.push('folder_date = ?'); values.push(updates.folderDate); }
    fields.push('updated_at = ?'); values.push(Date.now()); values.push(id);
    await this.db.run(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteTodo(id: string): Promise<void> {
    await this.updateTodo(id, { deletedAt: Date.now() });
  }

  async restoreTodo(id: string): Promise<void> {
    await this.updateTodo(id, { deletedAt: undefined });
  }

  async permanentDeleteTodo(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM todos WHERE id = ?', [id]);
  }

  async emptyRecycleBin(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM todos WHERE deleted_at IS NOT NULL');
  }

  async getTodosByDate(folderDate: string): Promise<Todo[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT * FROM todos WHERE folder_date = ? AND deleted_at IS NULL ORDER BY start_time ASC',
      [folderDate]
    );
    const todos: Todo[] = [];
    if (result.values) {
      for (const row of result.values) {
        todos.push(await this.rowToTodo(row));
      }
    }
    return todos;
  }

  async getAllTodos(options?: { includeDeleted?: boolean }): Promise<Todo[]> {
    if (!this.db) throw new Error('Database not initialized');
    const sql = options?.includeDeleted
      ? 'SELECT * FROM todos ORDER BY created_at DESC'
      : 'SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY created_at DESC';
    const result = await this.db.query(sql);
    const todos: Todo[] = [];
    if (result.values) {
      for (const row of result.values) {
        todos.push(await this.rowToTodo(row));
      }
    }
    return todos;
  }

  async getDeletedTodos(): Promise<Todo[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM todos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
    const todos: Todo[] = [];
    if (result.values) {
      for (const row of result.values) {
        todos.push(await this.rowToTodo(row));
      }
    }
    return todos;
  }

  async searchTodos(keyword: string, timeFilter: TodoSearchTimeFilter): Promise<Todo[]> {
    if (!this.db) throw new Error('Database not initialized');
    const now = Date.now();
    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    let sql: string;
    const values: unknown[] = [];

    if (timeFilter === 'future') {
      sql = 'SELECT * FROM todos WHERE deleted_at IS NULL AND (end_time IS NULL OR end_time >= ?)';
      values.push(now);
    } else if (timeFilter === 'expired') {
      sql = 'SELECT * FROM todos WHERE deleted_at IS NULL AND end_time IS NOT NULL AND end_time < ?';
      values.push(now);
    } else {
      sql = 'SELECT * FROM todos WHERE deleted_at IS NOT NULL AND (? - deleted_at) > ?';
      values.push(now, retentionMs);
    }

    if (keyword) {
      sql += ' AND title LIKE ?';
      values.push(`%${keyword}%`);
    }
    sql += ' ORDER BY created_at DESC';

    const result = await this.db.query(sql, values);
    const todos: Todo[] = [];
    if (result.values) {
      for (const row of result.values) {
        todos.push(await this.rowToTodo(row));
      }
    }
    return todos;
  }

  async batchUpdateTime(ids: string[], offsetMs: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    for (const id of ids) {
      await this.db.run(
        `UPDATE todos SET start_time = CASE WHEN start_time IS NOT NULL THEN start_time + ? ELSE NULL END,
         end_time = CASE WHEN end_time IS NOT NULL THEN end_time + ? ELSE NULL END,
         updated_at = ? WHERE id = ?`,
        [offsetMs, offsetMs, Date.now(), id]
      );
    }
  }

  async batchAddTags(ids: string[], tagIds: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    for (const todoId of ids) {
      for (const tagId of tagIds) {
        await this.db.run(
          'INSERT OR IGNORE INTO todo_tag_relations (todo_id, tag_id) VALUES (?, ?)',
          [todoId, tagId]
        );
      }
    }
  }

  // ==================== 待办标签 ====================

  async createTodoTag(name: string, color?: string): Promise<TodoTag> {
    if (!this.db) throw new Error('Database not initialized');
    const tag: TodoTag = {
      id: this.generateId(),
      name,
      color,
      createdAt: Date.now(),
    };
    await this.db.run(
      'INSERT INTO todo_tags (id, name, color, created_at) VALUES (?, ?, ?, ?)',
      [tag.id, tag.name, tag.color || null, tag.createdAt]
    );
    return tag;
  }

  async getAllTodoTags(): Promise<TodoTag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM todo_tags ORDER BY created_at DESC');
    return result.values?.map(row => ({
      id: row.id as string,
      name: row.name as string,
      color: row.color as string | undefined,
      createdAt: row.created_at as number,
    })) || [];
  }

  async updateTodoTag(tagId: string, updates: Partial<TodoTag>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
    values.push(tagId);
    await this.db.run(`UPDATE todo_tags SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteTodoTag(tagId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM todo_tags WHERE id = ?', [tagId]);
  }

  async setTodoTags(todoId: string, tagIds: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    // 先清除现有关联
    await this.db.run('DELETE FROM todo_tag_relations WHERE todo_id = ?', [todoId]);
    // 再插入新关联
    for (const tagId of tagIds) {
      await this.db.run(
        'INSERT OR IGNORE INTO todo_tag_relations (todo_id, tag_id) VALUES (?, ?)',
        [todoId, tagId]
      );
    }
  }

  // ==================== 模板 ====================

  async createTemplate(name: string): Promise<TodoTemplate> {
    if (!this.db) throw new Error('Database not initialized');
    const template: TodoTemplate = {
      id: this.generateId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.db.run(
      'INSERT INTO todo_templates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [template.id, template.name, template.createdAt, template.updatedAt]
    );
    return template;
  }

  async getAllTemplates(): Promise<TodoTemplate[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM todo_templates ORDER BY created_at DESC');
    return result.values?.map(row => ({
      id: row.id as string,
      name: row.name as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    })) || [];
  }

  async getTemplateById(id: string): Promise<TodoTemplate | null> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query('SELECT * FROM todo_templates WHERE id = ?', [id]);
    if (!result.values || result.values.length === 0) return null;
    return {
      id: result.values[0].id as string,
      name: result.values[0].name as string,
      createdAt: result.values[0].created_at as number,
      updatedAt: result.values[0].updated_at as number,
    };
  }

  async updateTemplate(id: string, updates: Partial<TodoTemplate>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    fields.push('updated_at = ?'); values.push(Date.now()); values.push(id);
    await this.db.run(`UPDATE todo_templates SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM todo_templates WHERE id = ?', [id]);
    await this.db.run('DELETE FROM todo_template_items WHERE template_id = ?', [id]);
  }

  async getTemplateItems(templateId: string): Promise<TodoTemplateItem[]> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.query(
      'SELECT * FROM todo_template_items WHERE template_id = ? ORDER BY sort_order ASC',
      [templateId]
    );
    return result.values?.map(row => ({
      id: row.id as string,
      templateId: row.template_id as string,
      title: row.title as string,
      note: row.note as string | undefined,
      startTime: row.start_time as number | undefined,
      endTime: row.end_time as number | undefined,
      isToday: Boolean(row.is_today),
      tagIds: row.tag_ids as string | undefined,
      sortOrder: row.sort_order as number,
    })) || [];
  }

  async addTemplateItem(item: Omit<TodoTemplateItem, 'id'>): Promise<TodoTemplateItem> {
    if (!this.db) throw new Error('Database not initialized');
    const id = this.generateId();
    await this.db.run(
      `INSERT INTO todo_template_items (id, template_id, title, note, start_time, end_time, is_today, tag_ids, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, item.templateId, item.title, item.note || null, item.startTime || null, item.endTime || null,
       item.isToday ? 1 : 0, item.tagIds || null, item.sortOrder]
    );
    return { ...item, id };
  }

  async updateTemplateItem(id: string, updates: Partial<TodoTemplateItem>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.note !== undefined) { fields.push('note = ?'); values.push(updates.note); }
    if (updates.startTime !== undefined) { fields.push('start_time = ?'); values.push(updates.startTime); }
    if (updates.endTime !== undefined) { fields.push('end_time = ?'); values.push(updates.endTime); }
    if (updates.isToday !== undefined) { fields.push('is_today = ?'); values.push(updates.isToday ? 1 : 0); }
    if (updates.tagIds !== undefined) { fields.push('tag_ids = ?'); values.push(updates.tagIds); }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder); }
    values.push(id);
    await this.db.run(`UPDATE todo_template_items SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteTemplateItem(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.run('DELETE FROM todo_template_items WHERE id = ?', [id]);
  }

  async importTemplateToDate(templateId: string, folderDate: string): Promise<Todo[]> {
    if (!this.db) throw new Error('Database not initialized');
    const items = await this.getTemplateItems(templateId);
    const created: Todo[] = [];

    const [year, month, day] = folderDate.split('-').map(Number);
    const baseTime = new Date(year, month - 1, day).getTime();

    for (const item of items) {
      const todo = await this.createTodo({
        title: item.title,
        note: item.note,
        status: 'pending',
        startTime: item.startTime !== undefined ? baseTime + item.startTime * 60 * 1000 : undefined,
        endTime: item.endTime !== undefined ? baseTime + item.endTime * 60 * 1000 : undefined,
        isToday: item.isToday,
        tagIds: item.tagIds ? JSON.parse(item.tagIds) : undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        folderDate,
      });
      created.push(todo);
    }

    return created;
  }

  // ==================== 工具 ====================

  private async rowToTodo(row: Record<string, unknown>): Promise<Todo> {
    let tagIds: string[] | undefined;
    if (this.db) {
      const tagResult = await this.db.query(
        'SELECT tag_id FROM todo_tag_relations WHERE todo_id = ?',
        [row.id as string]
      );
      if (tagResult.values && tagResult.values.length > 0) {
        tagIds = tagResult.values.map(r => r.tag_id as string);
      }
    }

    return {
      id: row.id as string,
      title: row.title as string,
      note: row.note as string | undefined,
      status: row.status as 'pending' | 'done',
      startTime: row.start_time as number | undefined,
      endTime: row.end_time as number | undefined,
      isToday: Boolean(row.is_today),
      tagIds,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      completedAt: row.completed_at as number | undefined,
      deletedAt: row.deleted_at as number | undefined,
      folderDate: row.folder_date as string,
    };
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export { NativeTodoDatabaseService };
export default NativeTodoDatabaseService;
