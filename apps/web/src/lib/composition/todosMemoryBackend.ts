import type { TodoLook } from "./todoLook";
import { DEFAULT_TODO_SETTINGS } from "./todoSettings";
import { subtreeIds, withDone, withStatus } from "./todos";
import type { ArchivedTodo, Todo, TodoReportRef, TodoReports, TodoSetup, TodosApi } from "./todosApi";

const REPORT_NAMES = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" } as const;

/** The week the stand-in files what is archived under, and when. */
const THIS_WEEK = "2026-10-25";
const ARCHIVED_AT = "2026-10-28T12:00:00.000Z";

/**
 * For tests of the to-do store and panel: a backend that keeps everything in memory and follows the same rules as the real
 * service (todosService.ts) where the screen can tell, so a test of the screen is a test of how it behaves with them: Remove
 * archives a branch and Restore brings it back, Drop and Move to backlog only work on an item waiting in Rolled over, and
 * Add to this week and Move to backlog act on the whole rolled branch.
 */
export function memoryTodosBackend(
  options: {
    todos?: Todo[];
    look?: TodoLook;
    setup?: TodoSetup;
    /** Archived items to start with (each its own archive action, filed under the week given). */
    archived?: { todo: Todo; reason: ArchivedTodo["archiveReason"]; week?: string; action?: number }[];
    /** The reports that mention an item, by the item's id (for the delete confirmation). */
    reports?: Record<number, TodoReportRef[]>;
    /** The reports that exist, and the closed periods that have none (for the Reports view). */
    todoReports?: TodoReports;
  } = {},
): TodosApi {
  let items = [...(options.todos ?? [])];
  let look: TodoLook = options.look ?? { background: "notes", color: null };
  let setup: TodoSetup = options.setup ?? { pending: false, completed: 0 };
  /** What has been archived, each with the action that archived it, so a restore brings back what went together. */
  let archive: { todo: Todo; reason: ArchivedTodo["archiveReason"]; action: number; week: string }[] = [];
  let nextId = 100;
  let todoReports: TodoReports = options.todoReports ?? { reports: [], missing: [] };
  let nextNote = 500;
  // Entries given the same `action` were archived together, so a restore brings them back together.
  let action = Math.max(0, ...(options.archived ?? []).map((a) => a.action ?? 0));
  for (const { todo, reason, week, action: given } of options.archived ?? []) {
    archive.push({ todo, reason, action: given ?? ++action, week: week ?? THIS_WEEK });
  }

  const find = (id: number) => items.find((t) => t.id === id);
  const need = (id: number): Todo => {
    const todo = find(id);
    if (!todo) throw new Error("That to-do no longer exists.");
    return todo;
  };
  const needRolled = (id: number): Todo => {
    const todo = find(id);
    if (todo?.rolledFromWeek === undefined) throw new Error("That to-do is not waiting in Rolled over.");
    return todo;
  };
  const archiveBranch = (id: number, reason: ArchivedTodo["archiveReason"]) => {
    const branch = subtreeIds(items, id);
    action += 1;
    for (const todo of items.filter((t) => branch.has(t.id))) archive.push({ todo, reason, action, week: THIS_WEEK });
    items = items.filter((t) => !branch.has(t.id));
  };
  const update = (id: number, change: (todo: Todo) => Todo): Todo => {
    items = items.map((t) => (t.id === id ? change(t) : t));
    return need(id);
  };
  const clearRolled = (todo: Todo, keepCount: boolean): Todo => {
    const { rolledFromWeek: _week, rollCount, ...rest } = todo;
    void _week;
    return keepCount && rollCount !== undefined ? { ...rest, rollCount } : rest;
  };

  return {
    loadTodoLook: async () => look,
    saveTodoLook: async (saved) => {
      look = saved;
    },
    loadTodoSettings: async () => DEFAULT_TODO_SETTINGS,
    saveTodoSettings: async () => {},
    previewTodoPurge: async () => 0,
    listTodos: async () => items,
    createTodo: async (title, parentId) => {
      const created: Todo = { id: nextId++, parentId, title, status: "todo", done: false, createdAt: "", updatedAt: "" };
      items = [...items, created];
      return created;
    },
    renameTodo: async (id, title) => update(id, (t) => ({ ...t, title })),
    setTodoDone: async (id, done) => update(id, (t) => withDone(t, done)),
    setTodoStatus: async (id, status) =>
      update(id, (t) => {
        const moved = withStatus(t, status);
        return status === "backlog" ? clearRolled(moved, false) : moved;
      }),
    deleteTodo: async (id) => {
      const branch = subtreeIds([...items, ...archive.map((a) => a.todo)], id);
      items = items.filter((t) => !branch.has(t.id));
      archive = archive.filter((a) => !branch.has(a.todo.id));
    },
    previewTodoDelete: async (id) => {
      const everything = [...items, ...archive.map((a) => a.todo)];
      if (!everything.some((t) => t.id === id)) return { items: 0, reports: [] };
      return { items: subtreeIds(everything, id).size, reports: options.reports?.[id] ?? [] };
    },
    loadTodoReports: async () => todoReports,
    generateTodoReport: async (kind, periodStart) => {
      const missing = todoReports.missing.find((m) => m.kind === kind && m.periodStart === periodStart);
      const base = missing ?? todoReports.reports.find((r) => r.kind === kind && r.periodStart === periodStart);
      if (!base) throw new Error("That period has not closed, so there is nothing to report on yet.");
      const noteId = nextNote++;
      const entry = {
        noteId,
        title: `${REPORT_NAMES[kind]} ${base.label} · generated 2026-11-01 14:${String(noteId - 499).padStart(2, "0")}`,
        kind,
        periodStart: base.periodStart,
        periodEnd: base.periodEnd,
        label: base.label,
        generatedAt: "2026-11-01T14:00:00.000Z",
      };
      todoReports = {
        reports: [entry, ...todoReports.reports].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
        missing: todoReports.missing.filter((m) => m !== missing),
      };
      return entry;
    },
    listArchivedTodos: async () =>
      archive.map(({ todo, reason, week }) => ({
        id: todo.id,
        parentId: todo.parentId,
        title: todo.title,
        status: todo.status,
        createdAt: todo.createdAt,
        ...(todo.doneAt !== undefined && { doneAt: todo.doneAt }),
        archivedAt: ARCHIVED_AT,
        archiveWeek: week,
        archiveReason: reason,
      })),
    removeTodo: async (id) => {
      need(id);
      archiveBranch(id, "removed");
    },
    dropTodo: async (id) => {
      needRolled(id);
      archiveBranch(id, "dropped");
    },
    restoreTodo: async (id) => {
      const entry = archive.find((a) => a.todo.id === id);
      if (!entry) throw new Error("That to-do is not in the archive.");
      const together = archive.filter((a) => a.action === entry.action);
      const branch = subtreeIds(
        together.map((a) => a.todo),
        id,
      );
      const parentId = entry.todo.parentId;
      const toTopLevel = parentId !== null && !find(parentId);
      const back = together
        .filter((a) => branch.has(a.todo.id))
        .map((a) => (a.todo.id === id ? { ...clearRolled(withStatus(a.todo, "todo"), true), parentId: toTopLevel ? null : parentId } : a.todo));
      archive = archive.filter((a) => !branch.has(a.todo.id) || a.action !== entry.action);
      items = [...items, ...back].sort((a, b) => a.id - b.id);
      return { toTopLevel };
    },
    acceptRolledTodo: async (id) => {
      need(id);
      const branch = subtreeIds(items, id);
      items = items.map((t) => (branch.has(t.id) && t.rolledFromWeek !== undefined ? clearRolled(t, true) : t));
      return need(id);
    },
    moveRolledTodoToBacklog: async (id) => {
      needRolled(id);
      const branch = subtreeIds(items, id);
      items = items.map((t) => (branch.has(t.id) ? clearRolled(t.id === id ? withStatus(t, "backlog") : t, false) : t));
      return need(id);
    },
    loadTodoSetup: async () => setup,
    finishTodoSetup: async (archiveCompleted) => {
      if (archiveCompleted) {
        for (const todo of items.filter((t) => t.status === "done")) {
          action += 1;
          archive.push({ todo, reason: "done", action, week: THIS_WEEK });
        }
        items = items.filter((t) => t.status !== "done");
      }
      setup = { pending: false, completed: 0 };
    },
  };
}
