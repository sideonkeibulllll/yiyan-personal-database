/**
 * Web 平台待办数据库服务
 * 使用 localStorage 存储，独立于笔记数据
 */
import type { Todo, TodoTag, TodoTemplate, TodoTemplateItem, TodoSearchTimeFilter } from '@/types';
import type { ITodoDatabaseService } from './types';

class WebTodoDatabaseService implements ITodoDatabaseService {
  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  // ==================== 待办 CRUD ====================

  async createTodo(todo: Omit<Todo, 'id'>): Promise<Todo> {
    const todos = this.getTodosFromStorage();
    const newTodo: Todo = {
      ...todo,
      id: this.generateId(),
    };
    todos.unshift(newTodo);
    this.saveTodosToStorage(todos);
    return newTodo;
  }

  async getTodoById(id: string): Promise<Todo | null> {
    const todos = this.getTodosFromStorage();
    return todos.find(t => t.id === id) || null;
  }

  async updateTodo(id: string, updates: Partial<Todo>): Promise<void> {
    const todos = this.getTodosFromStorage();
    const index = todos.findIndex(t => t.id === id);
    if (index !== -1) {
      todos[index] = { ...todos[index], ...updates, updatedAt: Date.now() };
      this.saveTodosToStorage(todos);
    }
  }

  async deleteTodo(id: string): Promise<void> {
    await this.updateTodo(id, { deletedAt: Date.now() });
  }

  async restoreTodo(id: string): Promise<void> {
    await this.updateTodo(id, { deletedAt: undefined });
  }

  async permanentDeleteTodo(id: string): Promise<void> {
    const todos = this.getTodosFromStorage();
    const filtered = todos.filter(t => t.id !== id);
    this.saveTodosToStorage(filtered);
  }

  async emptyRecycleBin(): Promise<void> {
    const todos = this.getTodosFromStorage();
    const filtered = todos.filter(t => !t.deletedAt);
    this.saveTodosToStorage(filtered);
  }

  async getTodosByDate(folderDate: string): Promise<Todo[]> {
    const todos = this.getTodosFromStorage();
    return todos
      .filter(t => t.folderDate === folderDate && !t.deletedAt)
      .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  }

  async getAllTodos(options?: { includeDeleted?: boolean }): Promise<Todo[]> {
    const todos = this.getTodosFromStorage();
    return options?.includeDeleted ? todos : todos.filter(t => !t.deletedAt);
  }

  async getDeletedTodos(): Promise<Todo[]> {
    const todos = this.getTodosFromStorage();
    return todos.filter(t => t.deletedAt).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  async searchTodos(keyword: string, timeFilter: TodoSearchTimeFilter): Promise<Todo[]> {
    const todos = this.getTodosFromStorage();
    const now = Date.now();
    const retentionMs = 30 * 24 * 60 * 60 * 1000; // 30 天

    let filtered: Todo[];
    if (timeFilter === 'future') {
      filtered = todos.filter(t => !t.deletedAt && (!t.endTime || t.endTime >= now));
    } else if (timeFilter === 'expired') {
      filtered = todos.filter(t => !t.deletedAt && t.endTime && t.endTime < now);
    } else {
      // expiredOverMonth — 回收站中
      filtered = todos.filter(t => t.deletedAt && (now - t.deletedAt) > retentionMs);
    }

    if (keyword) {
      const lower = keyword.toLowerCase();
      filtered = filtered.filter(t => t.title.toLowerCase().includes(lower));
    }

    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  async batchUpdateTime(ids: string[], offsetMs: number): Promise<void> {
    const todos = this.getTodosFromStorage();
    const idSet = new Set(ids);
    for (const todo of todos) {
      if (idSet.has(todo.id)) {
        if (todo.startTime) todo.startTime += offsetMs;
        if (todo.endTime) todo.endTime += offsetMs;
        todo.updatedAt = Date.now();
      }
    }
    this.saveTodosToStorage(todos);
  }

  async batchAddTags(ids: string[], tagIds: string[]): Promise<void> {
    const todos = this.getTodosFromStorage();
    const idSet = new Set(ids);
    for (const todo of todos) {
      if (idSet.has(todo.id)) {
        const existing = new Set(todo.tagIds || []);
        for (const tid of tagIds) existing.add(tid);
        todo.tagIds = Array.from(existing);
        todo.updatedAt = Date.now();
      }
    }
    this.saveTodosToStorage(todos);
  }

  // ==================== 待办标签 ====================

  async createTodoTag(name: string, color?: string): Promise<TodoTag> {
    const tags = this.getTodoTagsFromStorage();
    const existing = tags.find(t => t.name === name);
    if (existing) return existing;

    const tag: TodoTag = {
      id: this.generateId(),
      name,
      color,
      createdAt: Date.now(),
    };
    tags.unshift(tag);
    this.saveTodoTagsToStorage(tags);
    return tag;
  }

  async getAllTodoTags(): Promise<TodoTag[]> {
    return this.getTodoTagsFromStorage();
  }

  async updateTodoTag(tagId: string, updates: Partial<TodoTag>): Promise<void> {
    const tags = this.getTodoTagsFromStorage();
    const index = tags.findIndex(t => t.id === tagId);
    if (index !== -1) {
      tags[index] = { ...tags[index], ...updates };
      this.saveTodoTagsToStorage(tags);
    }
  }

  async deleteTodoTag(tagId: string): Promise<void> {
    const tags = this.getTodoTagsFromStorage();
    const filtered = tags.filter(t => t.id !== tagId);
    this.saveTodoTagsToStorage(filtered);

    // 同时从所有待办中移除该标签
    const todos = this.getTodosFromStorage();
    for (const todo of todos) {
      if (todo.tagIds) {
        todo.tagIds = todo.tagIds.filter(id => id !== tagId);
      }
    }
    this.saveTodosToStorage(todos);
  }

  async setTodoTags(todoId: string, tagIds: string[]): Promise<void> {
    const todos = this.getTodosFromStorage();
    const todo = todos.find(t => t.id === todoId);
    if (todo) {
      todo.tagIds = tagIds;
      todo.updatedAt = Date.now();
      this.saveTodosToStorage(todos);
    }
  }

  // ==================== 模板 ====================

  async createTemplate(name: string): Promise<TodoTemplate> {
    const templates = this.getTemplatesFromStorage();
    const template: TodoTemplate = {
      id: this.generateId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    templates.unshift(template);
    this.saveTemplatesToStorage(templates);
    return template;
  }

  async getAllTemplates(): Promise<TodoTemplate[]> {
    return this.getTemplatesFromStorage();
  }

  async getTemplateById(id: string): Promise<TodoTemplate | null> {
    const templates = this.getTemplatesFromStorage();
    return templates.find(t => t.id === id) || null;
  }

  async updateTemplate(id: string, updates: Partial<TodoTemplate>): Promise<void> {
    const templates = this.getTemplatesFromStorage();
    const index = templates.findIndex(t => t.id === id);
    if (index !== -1) {
      templates[index] = { ...templates[index], ...updates, updatedAt: Date.now() };
      this.saveTemplatesToStorage(templates);
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    const templates = this.getTemplatesFromStorage();
    const filtered = templates.filter(t => t.id !== id);
    this.saveTemplatesToStorage(filtered);

    // 同时删除模板下的待办项
    const items = this.getTemplateItemsFromStorage();
    const filteredItems = items.filter(i => i.templateId !== id);
    this.saveTemplateItemsToStorage(filteredItems);
  }

  async getTemplateItems(templateId: string): Promise<TodoTemplateItem[]> {
    const items = this.getTemplateItemsFromStorage();
    return items
      .filter(i => i.templateId === templateId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async addTemplateItem(item: Omit<TodoTemplateItem, 'id'>): Promise<TodoTemplateItem> {
    const items = this.getTemplateItemsFromStorage();
    const newItem: TodoTemplateItem = {
      ...item,
      id: this.generateId(),
    };
    items.push(newItem);
    this.saveTemplateItemsToStorage(items);
    return newItem;
  }

  async updateTemplateItem(id: string, updates: Partial<TodoTemplateItem>): Promise<void> {
    const items = this.getTemplateItemsFromStorage();
    const index = items.findIndex(i => i.id === id);
    if (index !== -1) {
      items[index] = { ...items[index], ...updates };
      this.saveTemplateItemsToStorage(items);
    }
  }

  async deleteTemplateItem(id: string): Promise<void> {
    const items = this.getTemplateItemsFromStorage();
    const filtered = items.filter(i => i.id !== id);
    this.saveTemplateItemsToStorage(filtered);
  }

  async importTemplateToDate(templateId: string, folderDate: string): Promise<Todo[]> {
    const items = await this.getTemplateItems(templateId);
    const created: Todo[] = [];

    // 解析 folderDate 为当天 0 点的时间戳
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

  // ==================== 存储工具 ====================

  private getTodosFromStorage(): Todo[] {
    try {
      const data = localStorage.getItem('yiyan_todos');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveTodosToStorage(todos: Todo[]): void {
    localStorage.setItem('yiyan_todos', JSON.stringify(todos));
  }

  private getTodoTagsFromStorage(): TodoTag[] {
    try {
      const data = localStorage.getItem('yiyan_todo_tags');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveTodoTagsToStorage(tags: TodoTag[]): void {
    localStorage.setItem('yiyan_todo_tags', JSON.stringify(tags));
  }

  private getTemplatesFromStorage(): TodoTemplate[] {
    try {
      const data = localStorage.getItem('yiyan_todo_templates');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveTemplatesToStorage(templates: TodoTemplate[]): void {
    localStorage.setItem('yiyan_todo_templates', JSON.stringify(templates));
  }

  private getTemplateItemsFromStorage(): TodoTemplateItem[] {
    try {
      const data = localStorage.getItem('yiyan_todo_template_items');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveTemplateItemsToStorage(items: TodoTemplateItem[]): void {
    localStorage.setItem('yiyan_todo_template_items', JSON.stringify(items));
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

export { WebTodoDatabaseService };
export default WebTodoDatabaseService;
