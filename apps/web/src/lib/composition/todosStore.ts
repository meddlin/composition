import { cleanTodoTitle, subtreeIds, withDone, withStatus } from "./todos";
import { DEFAULT_TODO_LOOK, type TodoLook } from "./todoLook";
import type { ReportKind } from "./todoReports";
import type { ArchivedTodo, Todo, TodoDeletePreview, TodoReportEntry, TodoReports, TodosApi, TodoSetup, TodoStatus } from "./todosApi";

/** What the store reaches outside for: the to-do items' backend. */
export type TodosDeps = TodosApi;

export type TodosSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the items are then unknown, not empty). */
  status: "idle" | "loading" | "ready" | "error";
  todos: Todo[];
  /** How the to-do panels look (Settings > Styling); the default until loaded. */
  look: TodoLook;
  /** The first-run question about completed items, once loaded; null until then, and when it could not be read. */
  setup: TodoSetup | null;
  /** The archive, once something has asked to see it (the Archive view); null until then. Once loaded it is kept up to date. */
  archive: ArchivedTodo[] | null;
  /** The reports, once something has asked to see them (the Reports view); null until then. Once loaded they are kept up to date. */
  reports: TodoReports | null;
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
  /** Adds an item at the end of its siblings, to the backlog if asked. Resolves once the backend has it. */
  add(title: string, parentId: number | null, status?: "backlog"): Promise<TodoResult>;
  /** Shows the new title at once. A title that is empty after trimming is refused. */
  rename(id: number, title: string): Promise<TodoResult>;
  /** Shows the change at once. */
  setDone(id: number, done: boolean): Promise<TodoResult>;
  /** Shows the move at once. "done" is the same as ticking the item. */
  setStatus(id: number, status: TodoStatus): Promise<TodoResult>;
  /** Reads the items again, for when the weekly cycle changed them behind the screen's back. Does nothing before the first load; if it fails the list stays as it was. */
  reload(): Promise<void>;
  /** Removes the item and everything under it, at once, to the archive (not for good). `restore` is the Undo. */
  remove(id: number): Promise<TodoResult>;
  /** Reads the archive, and from then on keeps it up to date. Says why if it cannot. */
  loadArchive(): Promise<TodoResult>;
  /** Reads the reports, and from then on keeps them up to date. Says why if it cannot. */
  loadReports(): Promise<TodoResult>;
  /** Makes another report for a closed period (Regenerate, or a period that has none), and returns it; says why if it cannot. */
  generateReport(kind: ReportKind, periodStart: string): Promise<TodoResult & { report?: TodoReportEntry }>;
  /** Deletes the item and everything under it for good, archived or not, at once. There is no Undo: ask `previewDelete` first. */
  deleteForGood(id: number): Promise<TodoResult>;
  /** What deleting the item for good would erase, and the reports that mention it. Deletes nothing. */
  previewDelete(id: number): Promise<{ preview?: TodoDeletePreview; error?: string }>;
  /** Brings an archived item back, with what was archived with it; says if it came back at the top level because its parent is still archived. */
  restore(id: number): Promise<TodoResult & { toTopLevel?: boolean }>;
  /** "Add to this week": the rolled-over item and everything rolled under it are placed, at once. */
  acceptRolled(id: number): Promise<TodoResult>;
  /** "Move to backlog": the rolled-over item goes to the backlog and the whole rolled branch starts clean, at once. */
  moveRolledToBacklog(id: number): Promise<TodoResult>;
  /** "Drop": the rolled-over item and everything under it go to the archive, at once. */
  drop(id: number): Promise<TodoResult>;
  /** Answers the first-run question (archive the completed items now, or leave them); it goes away once answered. */
  finishSetup(archiveCompleted: boolean): Promise<TodoResult>;
  /** Shows the look at once, in every to-do panel of every window, and saves it. */
  setLook(look: TodoLook): Promise<TodoResult>;
};

export const NO_TODOS: TodosSnapshot = { status: "idle", todos: [], look: DEFAULT_TODO_LOOK, setup: null, archive: null, reports: null, error: null };

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
    // The first-run question is a nicety: if it cannot be read, the list still loads, and nothing is asked.
    loading = Promise.all([deps.listTodos(), deps.loadTodoLook(), deps.loadTodoSetup().catch(() => null)])
      .then(([todos, look, setup]) => set({ status: "ready", todos, look, setup, error: null }))
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
    await refreshArchive();
    return { error: message };
  }

  /** Reads the archive again, if it has been loaded. A failure leaves the one it has. */
  async function refreshArchive(): Promise<void> {
    if (state.archive === null) return;
    try {
      set({ archive: await deps.listArchivedTodos() });
    } catch {
      // The archive is only on screen in its own view, which says so when it loads; the list is what matters here.
    }
  }

  /** Reads the reports again, if they have been loaded. A failure leaves the ones it has. */
  async function refreshReports(): Promise<void> {
    if (state.reports === null) return;
    try {
      set({ reports: await deps.loadTodoReports() });
    } catch {
      // As with the archive: the Reports view says so when it loads.
    }
  }

  async function loadReports(): Promise<TodoResult> {
    try {
      set({ reports: await deps.loadTodoReports(), error: null });
      return {};
    } catch (error) {
      set({ error: reason(error) });
      return { error: reason(error) };
    }
  }

  async function generateReport(kind: ReportKind, periodStart: string): Promise<TodoResult & { report?: TodoReportEntry }> {
    try {
      const report = await deps.generateTodoReport(kind, periodStart);
      set({ error: null });
      await refreshReports();
      return { report };
    } catch (error) {
      set({ error: reason(error) });
      await refreshReports();
      return { error: reason(error) };
    }
  }

  async function loadArchive(): Promise<TodoResult> {
    try {
      set({ archive: await deps.listArchivedTodos(), error: null });
      return {};
    } catch (error) {
      set({ error: reason(error) });
      return { error: reason(error) };
    }
  }

  const replace = (todo: Todo) => set({ todos: state.todos.map((t) => (t.id === todo.id ? todo : t)) });

  async function add(title: string, parentId: number | null, status?: "backlog"): Promise<TodoResult> {
    const cleaned = cleanTodoTitle(title);
    if (cleaned === null) return { error: "A to-do needs a title (up to 500 characters)." };
    try {
      const created = await deps.createTodo(cleaned, parentId);
      // New items start in This week; one for the backlog is moved there as soon as it is made.
      set({ todos: [...state.todos, status ? await deps.setTodoStatus(created.id, status) : created], error: null });
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

  async function reload(): Promise<void> {
    if (state.status !== "ready") return;
    try {
      set({ todos: await deps.listTodos(), error: null });
    } catch (error) {
      set({ error: reason(error) });
    }
    await refreshArchive();
    await refreshReports();
  }

  /** Takes the item and everything under it out of the list, and asks the backend to archive it that way. */
  async function archive(id: number, ask: (id: number) => Promise<void>): Promise<TodoResult> {
    const gone = subtreeIds(state.todos, id);
    set({ todos: state.todos.filter((t) => !gone.has(t.id)), error: null });
    try {
      await ask(id);
      await refreshArchive();
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  const remove = (id: number) => archive(id, deps.removeTodo);
  const drop = (id: number) => archive(id, deps.dropTodo);

  async function restore(id: number): Promise<TodoResult & { toTopLevel?: boolean }> {
    try {
      const { toTopLevel } = await deps.restoreTodo(id);
      set({ todos: await deps.listTodos(), error: null });
      await refreshArchive();
      return { toTopLevel };
    } catch (error) {
      return undo(error);
    }
  }

  /** The item with its rolled-over marks gone; `keepCount` leaves how many weeks it rolled. */
  const placed = (todo: Todo, keepCount: boolean): Todo => {
    const { rolledFromWeek: _week, rollCount, ...rest } = todo;
    void _week;
    return keepCount && rollCount !== undefined ? { ...rest, rollCount } : rest;
  };

  async function acceptRolled(id: number): Promise<TodoResult> {
    const branch = subtreeIds(state.todos, id);
    set({ todos: state.todos.map((t) => (branch.has(t.id) && t.rolledFromWeek !== undefined ? placed(t, true) : t)), error: null });
    try {
      await deps.acceptRolledTodo(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function moveRolledToBacklog(id: number): Promise<TodoResult> {
    const branch = subtreeIds(state.todos, id);
    set({ todos: state.todos.map((t) => (branch.has(t.id) ? placed(t.id === id ? withStatus(t, "backlog") : t, false) : t)), error: null });
    try {
      await deps.moveRolledTodoToBacklog(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function deleteForGood(id: number): Promise<TodoResult> {
    const gone = subtreeIds([...state.todos, ...(state.archive ?? [])], id);
    set({
      todos: state.todos.filter((t) => !gone.has(t.id)),
      archive: state.archive && state.archive.filter((t) => !gone.has(t.id)),
      error: null,
    });
    try {
      await deps.deleteTodo(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function previewDelete(id: number): Promise<{ preview?: TodoDeletePreview; error?: string }> {
    try {
      return { preview: await deps.previewTodoDelete(id) };
    } catch (error) {
      return { error: reason(error) };
    }
  }

  async function finishSetup(archiveCompleted: boolean): Promise<TodoResult> {
    try {
      await deps.finishTodoSetup(archiveCompleted);
      set({ setup: { pending: false, completed: 0 }, todos: await deps.listTodos(), error: null });
      await refreshArchive();
      return {};
    } catch (error) {
      set({ error: reason(error) });
      return { error: reason(error) };
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
    reload,
    loadArchive,
    loadReports,
    generateReport,
    deleteForGood,
    previewDelete,
    remove,
    restore,
    acceptRolled,
    moveRolledToBacklog,
    drop,
    finishSetup,
    setLook,
  };
}

/** For a workspace with no to-do backend (the web app has no to-do panel): loading it reports that. */
export const unavailableTodos: TodosDeps = {
  loadTodoLook: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  saveTodoLook: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  loadTodoSettings: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  saveTodoSettings: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  previewTodoPurge: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  listTodos: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  createTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  renameTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  setTodoDone: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  setTodoStatus: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  deleteTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  previewTodoDelete: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  loadTodoReports: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  generateTodoReport: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  listArchivedTodos: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  removeTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  dropTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  restoreTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  acceptRolledTodo: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  moveRolledTodoToBacklog: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  loadTodoSetup: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
  finishTodoSetup: () => Promise.reject(new Error("The to-do list is only available in the desktop app.")),
};
