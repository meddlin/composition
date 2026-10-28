import { cleanTodoTitle, subtreeIds, withDone, withStatus } from "./todos";
import { DEFAULT_TODO_LOOK, type TodoLook } from "./todoLook";
import type { Todo, TodosApi, TodoStatus } from "./todosApi";

/** What the store reaches outside for: the to-do items' backend. */
export type TodosDeps = TodosApi;

export type TodosSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the items are then unknown, not empty). */
  status: "idle" | "loading" | "ready" | "error";
  todos: Todo[];
  /** How the to-do panels look (Settings > Styling); the default until loaded. */
  look: TodoLook;
  /** Why the last load or change failed, until the next one succeeds. */
  error: string | null;
};

/** What a change that can be refused reports: the reason, or nothing when it went through. */
export type TodoResult = { error?: string };

export type TodosStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): TodosSnapshot;
  /** Reads the items and the look from the backend. Does nothing once they are loaded (or while they load); after a failure it tries again. */
  load(): Promise<void>;
  /** Adds an item at the end of its siblings. Resolves once the backend has it. */
  add(title: string, parentId: number | null): Promise<TodoResult>;
  /** Shows the new title at once. A title that is empty after trimming is refused. */
  rename(id: number, title: string): Promise<TodoResult>;
  /** Shows the change at once. */
  setDone(id: number, done: boolean): Promise<TodoResult>;
  /** Shows the move at once. "done" is the same as ticking the item. */
  setStatus(id: number, status: TodoStatus): Promise<TodoResult>;
  /** Removes the item and everything under it, at once. */
  remove(id: number): Promise<TodoResult>;
  /** Shows the look at once, in every to-do panel of every window, and saves it. */
  setLook(look: TodoLook): Promise<TodoResult>;
};

export const NO_TODOS: TodosSnapshot = { status: "idle", todos: [], look: DEFAULT_TODO_LOOK, error: null };

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/**
 * The to-do items, with no React in it, so every panel showing them (in any window) sees the same list. A change
 * shows at once and is sent to the backend; if the backend refuses it, the list is read again so the screen
 * shows what is really stored.
 */
export function createTodosStore(deps: TodosDeps): TodosStore {
  let state: TodosSnapshot = NO_TODOS;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function set(next: Partial<TodosSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  function load(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (loading) return loading;
    set({ status: "loading", error: null });
    loading = Promise.all([deps.listTodos(), deps.loadTodoLook()])
      .then(([todos, look]) => set({ status: "ready", todos, look, error: null }))
      .catch((error) => set({ status: "error", error: reason(error) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  /** A change the backend turned down (or failed): shows why, and puts back what is really stored. */
  async function undo(error: unknown): Promise<TodoResult> {
    const message = reason(error);
    try {
      set({ todos: await deps.listTodos(), error: message });
    } catch {
      set({ error: message });
    }
    return { error: message };
  }

  const replace = (todo: Todo) => set({ todos: state.todos.map((t) => (t.id === todo.id ? todo : t)) });

  async function add(title: string, parentId: number | null): Promise<TodoResult> {
    const cleaned = cleanTodoTitle(title);
    if (cleaned === null) return { error: "A to-do needs a title (up to 500 characters)." };
    try {
      const created = await deps.createTodo(cleaned, parentId);
      set({ todos: [...state.todos, created], error: null });
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function rename(id: number, title: string): Promise<TodoResult> {
    const cleaned = cleanTodoTitle(title);
    if (cleaned === null) return { error: "A to-do needs a title (up to 500 characters)." };
    set({ todos: state.todos.map((t) => (t.id === id ? { ...t, title: cleaned } : t)), error: null });
    try {
      replace(await deps.renameTodo(id, cleaned));
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function setDone(id: number, done: boolean): Promise<TodoResult> {
    set({ todos: state.todos.map((t) => (t.id === id ? withDone(t, done) : t)), error: null });
    try {
      replace(await deps.setTodoDone(id, done));
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function setStatus(id: number, status: TodoStatus): Promise<TodoResult> {
    set({ todos: state.todos.map((t) => (t.id === id ? withStatus(t, status) : t)), error: null });
    try {
      replace(await deps.setTodoStatus(id, status));
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function remove(id: number): Promise<TodoResult> {
    const gone = subtreeIds(state.todos, id);
    set({ todos: state.todos.filter((t) => !gone.has(t.id)), error: null });
    try {
      await deps.deleteTodo(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function setLook(look: TodoLook): Promise<TodoResult> {
    const previous = state.look;
    set({ look, error: null });
    try {
      await deps.saveTodoLook(look);
      return {};
    } catch (error) {
      set({ look: previous, error: reason(error) });
      return { error: reason(error) };
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    load,
    add,
    rename,
    setDone,
    setStatus,
    remove,
    setLook,
  };
}

/** For a workspace with no to-do backend (the web app has no to-do panel): loading it reports that. */
export const unavailableTodos: TodosDeps = {
  loadTodoLook: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  saveTodoLook: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  listTodos: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  createTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  renameTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  setTodoDone: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  setTodoStatus: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  deleteTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
};
