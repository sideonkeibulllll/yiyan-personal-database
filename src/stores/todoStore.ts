/**
 * 待办状态管理
 */
import { create } from 'zustand';
import type { Todo, TodoSearchTimeFilter } from '@/types';
import { getTodoDatabase } from '@/services/todoDatabase';

interface TodoStore {
  todos: Todo[];
  currentTodo: Todo | null;
  isLoading: boolean;
  error: string | null;

  // 操作
  loadTodosByDate: (folderDate: string) => Promise<void>;
  loadAllTodos: () => Promise<void>;
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
  currentTodo: null,
  isLoading: false,
  error: null,

  loadTodosByDate: async (folderDate: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getTodoDatabase();
      const todos = await db.getTodosByDate(folderDate);
      set({ todos, isLoading: false });
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
      currentTodo: state.currentTodo?.id === id ? { ...state.currentTodo, ...updates } : state.currentTodo,
    }));
  },

  toggleDone: async (id) => {
    const todo = get().todos.find(t => t.id === id);
    if (!todo) return;

    const newStatus = todo.status === 'pending' ? 'done' : 'pending';
    const completedAt = newStatus === 'done' ? Date.now() : undefined;
    const db = await getTodoDatabase();
    await db.updateTodo(id, { status: newStatus, completedAt });
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, status: newStatus, completedAt } : t),
    }));
  },

  deleteTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.deleteTodo(id);
    set(state => ({
      todos: state.todos.filter(t => t.id !== id),
    }));
  },

  restoreTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.restoreTodo(id);
    set(state => ({
      todos: state.todos.map(t => t.id === id ? { ...t, deletedAt: undefined } : t),
    }));
  },

  permanentDeleteTodo: async (id) => {
    const db = await getTodoDatabase();
    await db.permanentDeleteTodo(id);
    set(state => ({
      todos: state.todos.filter(t => t.id !== id),
    }));
  },

  emptyRecycleBin: async () => {
    const db = await getTodoDatabase();
    await db.emptyRecycleBin();
    set(state => ({
      todos: state.todos.filter(t => !t.deletedAt),
    }));
  },

  searchTodos: async (keyword, timeFilter) => {
    const db = await getTodoDatabase();
    return db.searchTodos(keyword, timeFilter);
  },

  batchUpdateTime: async (ids, offsetMs) => {
    const db = await getTodoDatabase();
    await db.batchUpdateTime(ids, offsetMs);
    set(state => ({
      todos: state.todos.map(t => {
        if (!ids.includes(t.id)) return t;
        return {
          ...t,
          startTime: t.startTime ? t.startTime + offsetMs : t.startTime,
          endTime: t.endTime ? t.endTime + offsetMs : t.endTime,
        };
      }),
    }));
  },

  batchAddTags: async (ids, tagIds) => {
    const db = await getTodoDatabase();
    await db.batchAddTags(ids, tagIds);
    set(state => ({
      todos: state.todos.map(t => {
        if (!ids.includes(t.id)) return t;
        const existing = new Set(t.tagIds || []);
        for (const tid of tagIds) existing.add(tid);
        return { ...t, tagIds: Array.from(existing) };
      }),
    }));
  },

  setCurrentTodo: (todo) => set({ currentTodo: todo }),
}));
