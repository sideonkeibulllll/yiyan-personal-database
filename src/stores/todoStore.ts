/**
 * 待办状态管理
 *
 * v2.6.0 状态拆分（性能优化）：
 * - `todos`     全量未删除待办，供 HomePage 顶部卡片 / RandomPage 等使用
 * - `dateTodos` 当前选中日期的待办，供 TodoPage / TodoManagerPage 使用
 *
 * 拆分前两个页面共用同一个 `todos` 数组，`loadTodosByDate` 会把全量数据覆盖成
 * 单日数据，导致首页卡片丢失其他日期的待办；为了兜底只能每次进页面重新全量查询，
 * 造成「切回来又读一次」的体感。拆分后各自独立，无需反复全量拉取。
 */
import { create } from 'zustand';
import type { Todo, TodoSearchTimeFilter } from '@/types';
import { getTodoDatabase } from '@/services/todoDatabase';

interface TodoStore {
  /** 全量未删除待办（按 created_at DESC） */
  todos: Todo[];
  /** 当前选中日期的待办（按 start_time ASC） */
  dateTodos: Todo[];
  currentTodo: Todo | null;
  isLoading: boolean;
  error: string | null;

  // 操作
  loadTodosByDate: (folderDate: string) => Promise<void>;
  loadAllTodos: () => Promise<void>;
  /** 仅刷新全量列表，用于外部改动后同步 */
  refreshAllTodos: () => Promise<void>;
  addTodo: (data: {
    title: string;
    note?: string;
    startTime?: number;
    endTime?: number;
    isToday?: boolean;
    folderDate: string;
    tagIds?: string[];
  }) => Promise<Todo>;
  updateTodo: (id: string, updates: Partial<Todo>) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  restoreTodo: (id: string) => Promise<void>;
  permanentDeleteTodo: (id: string) => Promise<void>;
  emptyRecycleBin: () => Promise<void>;
  searchTodos: (keyword: string, timeFilter: TodoSearchTimeFilter) => Promise<Todo[]>;
  batchUpdateTime: (ids: string[], offsetMs: number) => Promise<void>;
  batchAddTags: (ids: string[], tagIds: string[]) => Promise<void>;
  setCurrentTodo: (todo: Todo | null) => void;
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  dateTodos: [],
  currentTodo: null,
  isLoading: false,
  error: null,

  loadTodosByDate: async (folderDate: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getTodoDatabase();
      const todos = await db.getTodosByDate(folderDate);
      set({ dateTodos: todos, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadAllTodos: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = await getTodoDatabase();
      const todos = await db.getAllTodos();
      set({ todos, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  refreshAllTodos: async () => {
    try {
      const db = await getTodoDatabase();
      const todos = await db.getAllTodos();
      set({ todos });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  addTodo: async (data) => {
    const now = Date.now();
    const db = await getTodoDatabase();
    const todo = await db.createTodo({
      title: data.title,
      note: data.note,
      status: 'pending',
      startTime: data.startTime,
      endTime: data.endTime,
      isToday: data.isToday ?? false,
      tagIds: data.tagIds,
      createdAt: now,
      updatedAt: now,
      folderDate: data.folderDate,
    });

    set(state => ({ todos: [todo, ...state.todos] }));
    return todo;
  },

  updateTodo: async (id, updates) => {
    const db = await getTodoDatabase();
    await db.updateTodo(id, updates);
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, ...updates } : t),
      dateTodos: state.dateTodos.map(t => t.id === id ? { ...t, ...updates } : t),
      currentTodo: state.currentTodo?.id === id ? { ...state.currentTodo, ...updates } : state.currentTodo,
    }));
  },

  toggleDone: async (id) => {
    const todo = get().todos.find(t => t.id === id) || get().dateTodos.find(t => t.id === id);
    if (!todo) return;

    const newStatus = todo.status === 'pending' ? 'done' : 'pending';
    const completedAt = newStatus === 'done' ? Date.now() : undefined;
    const db = await getTodoDatabase();
    await db.updateTodo(id, { status: newStatus, completedAt });
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, status: newStatus, completedAt } : t),
      dateTodos: state.dateTodos.map(t => t.id === id ? { ...t, status: newStatus, completedAt } : t),
    }));
  },

  deleteTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.deleteTodo(id);
    set(state => ({
      todos: state.todos.filter(t => t.id !== id),
      dateTodos: state.dateTodos.filter(t => t.id !== id),
    }));
  },

  restoreTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.restoreTodo(id);
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, deletedAt: undefined } : t),
      dateTodos: state.dateTodos.map(t => t.id === id ? { ...t, deletedAt: undefined } : t),
    }));
  },

  permanentDeleteTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.permanentDeleteTodo(id);
    set(state => ({
      todos: state.todos.filter(t => t.id !== id),
      dateTodos: state.dateTodos.filter(t => t.id !== id),
    }));
  },

  emptyRecycleBin: async () => {
    const db = await getTodoDatabase();
    await db.emptyRecycleBin();
    set(state => ({
      todos: state.todos.filter(t => !t.deletedAt),
      dateTodos: state.dateTodos.filter(t => !t.deletedAt),
    }));
  },

  searchTodos: async (keyword, timeFilter) => {
    const db = await getTodoDatabase();
    return db.searchTodos(keyword, timeFilter);
  },

  batchUpdateTime: async (ids, offsetMs) => {
    const db = await getTodoDatabase();
    await db.batchUpdateTime(ids, offsetMs);
    const patch = (list: Todo[]) => list.map(t => {
      if (!ids.includes(t.id)) return t;
      return {
        ...t,
        startTime: t.startTime ? t.startTime + offsetMs : t.startTime,
        endTime: t.endTime ? t.endTime + offsetMs : t.endTime,
      };
    });
    set(state => ({ todos: patch(state.todos), dateTodos: patch(state.dateTodos) }));
  },

  batchAddTags: async (ids, tagIds) => {
    const db = await getTodoDatabase();
    await db.batchAddTags(ids, tagIds);
    const patch = (list: Todo[]) => list.map(t => {
      if (!ids.includes(t.id)) return t;
      const existing = new Set(t.tagIds || []);
      for (const tid of tagIds) existing.add(tid);
      return { ...t, tagIds: Array.from(existing) };
    });
    set(state => ({ todos: patch(state.todos), dateTodos: patch(state.dateTodos) }));
  },

  setCurrentTodo: (todo) => set({ currentTodo: todo }),
}));
