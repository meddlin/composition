/**
 * What the to-do panel exchanges with the backend. Types only, apart from TODO_METHODS, so it is safe to import
 * anywhere (renderer, preload, main). Desktop only, like the panels that show it.
 */

import type { ArchiveReason } from "./todoEvents";
import type { TodoLook } from "./todoLook";
import type { ReportKind } from "./todoReports";
import type { TodoSettings } from "./todoSettings";

/** Where an item stands, in the order the board shows them. */
export const TODO_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export const isTodoStatus = (value: unknown): value is TodoStatus => TODO_STATUSES.includes(value as TodoStatus);

/** How urgent an item is, 1 (critical) to 5 (nice to have). An item with none set has no priority. */
export const TODO_PRIORITIES = [1, 2, 3, 4, 5] as const;

export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const isTodoPriority = (value: unknown): value is TodoPriority => TODO_PRIORITIES.includes(value as TodoPriority);

/** What each priority is called, for the menu and the tooltip. */
export const TODO_PRIORITY_NAMES: Record<TodoPriority, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Nice to have",
};

/** A priority as it is written: "P1". */
export const priorityTag = (priority: TodoPriority): string => `P${priority}`;

/**
 * One to-do item. An item with a `parentId` is a sub-item of that item; sub-items nest without limit. `done` is
 * `status === "done"`, kept as a field because the list view ticks items off.
 */
export type Todo = {
  id: number;
  parentId: number | null;
  title: string;
  status: TodoStatus;
  done: boolean;
  /** How urgent it is; absent while none is set. Kept when it is archived and restored. */
  priority?: TodoPriority;
  createdAt: string;
  updatedAt: string;
  /** When it was ticked off (an instant, ISO); absent while it is not done. */
  doneAt?: string;
  /** While it waits in Rolled over: the first day of the week it first rolled over from. Absent once it is placed. */
  rolledFromWeek?: string;
  /** How many week closes it has been through while open; absent until it has been through one. */
  rollCount?: number;
};

/**
 * An item that has left the live list: ticked off and swept at the end of a week, removed by the owner, or dropped from
 * Rolled over. It stays for the retention window; `archiveWeek` is the first day of the week it was archived in.
 */
export type ArchivedTodo = {
  id: number;
  parentId: number | null;
  title: string;
  status: TodoStatus;
  createdAt: string;
  doneAt?: string;
  archivedAt: string;
  archiveWeek: string;
  archiveReason: ArchiveReason;
};

/** The first-run question: whether it is still to be asked, and how many completed items it is about (docs/todo-archival-plan.md, T15). */
export type TodoSetup = { pending: boolean; completed: number };

/** A weekly, monthly or quarterly report: a note, found by the link the weekly cycle recorded when it made it. */
export type TodoReportRef = { noteId: number; title: string };

/** What deleting an item for good would erase: the item and everything under it (archived or not), and the reports that mention any of them. */
export type TodoDeletePreview = { items: number; reports: TodoReportRef[] };

/** Every kind of report, as data (the bridge checks a kind against it). */
export const REPORT_KINDS = ["weekly", "monthly", "quarterly"] as const satisfies readonly ReportKind[];

export const isReportKind = (value: unknown): value is ReportKind => REPORT_KINDS.includes(value as ReportKind);

/** A report that exists, as the Reports view lists it: its note, and the period and moment it was made for. `label` is how titles name the period. */
export type TodoReportEntry = {
  noteId: number;
  title: string;
  kind: ReportKind;
  periodStart: string;
  periodEnd: string;
  label: string;
  generatedAt: string;
};

/** A closed period that has no report (a quiet week, or one that was deleted), which can be made by hand. */
export type TodoMissingReport = { kind: ReportKind; periodStart: string; periodEnd: string; label: string };

/** The reports, newest period first (every copy of one), and the closed periods in the retention window that have none. */
export type TodoReports = { reports: TodoReportEntry[]; missing: TodoMissingReport[] };

/** The longest an item's title may be. The page limits its input to this; the backend refuses more. */
export const MAX_TODO_TITLE_LENGTH = 500;

export interface TodosApi {
  /** How the to-do panels look (one setting for all of them; see todoLook.ts). */
  loadTodoLook(): Promise<TodoLook>;
  /** Saves how the to-do panels look. Rejects anything that is not a look. */
  saveTodoLook(look: TodoLook): Promise<void>;
  /** How the to-do cycle is set up: the week's first day, how long the archive is kept, the fiscal year (see todoSettings.ts). */
  loadTodoSettings(): Promise<TodoSettings>;
  /** Saves them, merged into the other settings. Rejects anything that is not valid, saving nothing. */
  saveTodoSettings(settings: TodoSettings): Promise<void>;
  /**
   * How many archived items a keep-for window of `months` (`null`: forever) would delete now, for the warning before the
   * window is shortened. Deletes nothing. Rejects a window that is not valid.
   */
  previewTodoPurge(months: number | null): Promise<number>;
  /** Every item, in the order the owner arranged them; items not arranged yet are last, oldest first. */
  listTodos(): Promise<Todo[]>;
  /** Adds an item at the end of its siblings, under `parentId` or at the top level. Rejects an empty title or a missing parent. */
  createTodo(title: string, parentId: number | null): Promise<Todo>;
  /** Rejects an empty title or a missing item. */
  renameTodo(id: number, title: string): Promise<Todo>;
  /** Marks the item done or not done. Unticking a done item puts it back to "todo"; sub-items are left as they are. */
  setTodoDone(id: number, done: boolean): Promise<Todo>;
  /** Moves the item to a status ("done" is the same as ticking it). Its sub-items are left as they are. Rejects a missing item. */
  setTodoStatus(id: number, status: TodoStatus): Promise<Todo>;
  /** Sets the item's priority, or clears it with null. Its sub-items are left as they are. Rejects a priority that is not one, or a missing item. */
  setTodoPriority(id: number, priority: TodoPriority | null): Promise<Todo>;
  /**
   * Puts the item immediately before `beforeId` among its siblings (the items under the same parent), or last among them
   * when `beforeId` is null or not one of them. The order is kept; it is not a change to the item, so it is not logged.
   * Rejects a missing item.
   */
  moveTodo(id: number, beforeId: number | null): Promise<void>;
  /**
   * Makes the item a sub-item of `parentId` (or a top-level item when that is null), with everything under it coming
   * along, immediately before `beforeId` among its new siblings, or last among them when `beforeId` is null or not one of
   * them. Its status and everything else are kept; like `moveTodo` it is not logged. Rejects a missing item or parent, and
   * a parent that is the item itself or under it.
   */
  nestTodo(id: number, parentId: number | null, beforeId: number | null): Promise<void>;
  /** "Move completed to the bottom": among the siblings at every level, the done items go below the open ones, each keeping its order. */
  sortDoneTodosLast(): Promise<void>;
  /** "Sort by priority": among the siblings at every level, P1 comes first and items with no priority last, each keeping its order among equals. */
  sortTodosByPriority(): Promise<void>;
  /**
   * Deletes the item and everything under it, for good, archived or not, with their rows in the activity log ("Delete
   * permanently"). Deleting an item that is already gone is not an error.
   */
  deleteTodo(id: number): Promise<void>;
  /**
   * What `deleteTodo` would erase: how many items (the item and everything under it, archived or not) and which reports
   * mention any of their titles, so the owner can edit those notes first. Deletes nothing; an item that is not there
   * has none of either.
   */
  previewTodoDelete(id: number): Promise<TodoDeletePreview>;
  /** The reports that exist (every copy, newest period first) and the closed periods in the retention window that have none. */
  loadTodoReports(): Promise<TodoReports>;
  /**
   * Makes another report for a closed period ("Regenerate", or a period that has none), as a new note; the reports already
   * made for it are not touched. Rejects a kind that is not one, a period that has not closed, or one older than archived items are kept.
   */
  generateTodoReport(kind: ReportKind, periodStart: string): Promise<TodoReportEntry>;
  /** Everything in the archive, oldest first. */
  listArchivedTodos(): Promise<ArchivedTodo[]>;
  /**
   * "Remove": archives the item and everything under it as removed, filed under the week the Week-starts-on setting makes.
   * An Undo is `restoreTodo`. Rejects a missing item; an item that is already archived is left as it is.
   */
  removeTodo(id: number): Promise<void>;
  /** "Drop", in Rolled over: archives the item and everything under it as dropped. Rejects an item that is not waiting in Rolled over. */
  dropTodo(id: number): Promise<void>;
  /**
   * Brings an archived item back as a to-do, with the sub-items archived along with it (they keep their own status, so
   * Remove then Undo is a round trip for a branch). `toTopLevel` is true when it
   * came back at the top level because its parent is still archived. Rejects an item that is not in the archive.
   */
  restoreTodo(id: number): Promise<{ toTopLevel: boolean }>;
  /**
   * "Add to this week": the item leaves Rolled over and keeps how many weeks it has rolled. An item that is not in Rolled
   * over is returned as it is. Rejects a missing item.
   */
  acceptRolledTodo(id: number): Promise<Todo>;
  /**
   * "Move to backlog", for an item waiting in Rolled over: its top item goes to the backlog and the whole rolled branch
   * starts clean, keeping its sub-items' own status. Rejects an item that is not waiting in Rolled over.
   */
  moveRolledTodoToBacklog(id: number): Promise<Todo>;
  /** Whether the first-run question ("Archive N items you've already completed?") is still to be asked. */
  loadTodoSetup(): Promise<TodoSetup>;
  /**
   * Answers it. Yes archives the completed items now, filed under the weeks they were last changed in; no leaves them
   * (they go, with no date, at the first week close). Either way the weekly cycle starts. Answering again does nothing.
   */
  finishTodoSetup(archiveCompleted: boolean): Promise<void>;
}

/** Every method of TodosApi, as data, so the preload script and the main process can't drift from it. */
export const TODO_METHODS = [
  "loadTodoLook",
  "saveTodoLook",
  "loadTodoSettings",
  "saveTodoSettings",
  "previewTodoPurge",
  "listTodos",
  "createTodo",
  "renameTodo",
  "setTodoDone",
  "setTodoStatus",
  "setTodoPriority",
  "moveTodo",
  "nestTodo",
  "sortDoneTodosLast",
  "sortTodosByPriority",
  "deleteTodo",
  "previewTodoDelete",
  "loadTodoReports",
  "generateTodoReport",
  "listArchivedTodos",
  "removeTodo",
  "dropTodo",
  "restoreTodo",
  "acceptRolledTodo",
  "moveRolledTodoToBacklog",
  "loadTodoSetup",
  "finishTodoSetup",
] as const satisfies readonly (keyof TodosApi)[];

export type TodoMethod = (typeof TODO_METHODS)[number];

type MissingFromTodoMethods = Exclude<keyof TodosApi, TodoMethod>;
const _everyMethodListed: [MissingFromTodoMethods] extends [never] ? true : never = true;
void _everyMethodListed;
