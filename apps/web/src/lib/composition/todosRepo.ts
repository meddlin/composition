import type Database from "better-sqlite3";
import { getDb } from "./db";
import type { ArchiveReason, EventKind, TodoEvent } from "./todoEvents";
import { planSweep, type SweepItem, type WeekPlan } from "./todoSweep";
import { placeBefore } from "./ordering";
import { doneLastGroups, priorityGroups, withDone, withStatus } from "./todos";
import { localDateOf, weekOf, type DayOfWeek, type Period } from "./todoWeeks";
import { isTodoPriority, isTodoStatus, type ArchivedTodo, type Todo, type TodoDeletePreview, type TodoPriority, type TodoStatus } from "./todosApi";

type TodoRow = {
  id: number;
  parent_id: number | null;
  title: string;
  done: number;
  status: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  rolled_from_week: string | null;
  roll_count: number;
};

function fromRow(row: TodoRow): Todo {
  // `done` is the one a row from an older version is sure to have right; a status that isn't one of ours falls back to it.
  const done = row.done === 1;
  const status: TodoStatus = isTodoStatus(row.status) ? row.status : done ? "done" : "todo";
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    status,
    done: status === "done",
    ...(isTodoPriority(row.priority) && { priority: row.priority }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.done_at !== null && status === "done" && { doneAt: row.done_at }),
    ...(row.rolled_from_week !== null && { rolledFromWeek: row.rolled_from_week }),
    ...(row.roll_count > 0 && { rollCount: row.roll_count }),
  };
}

/**
 * Display order among siblings: the ones the owner has arranged (`position` set) in that order, then the rest, oldest first,
 * which is where a new item goes.
 */
const DISPLAY_ORDER = "position IS NULL, position, id";

/** The live list: everything that has not been archived, in display order. */
export function listTodos(): Todo[] {
  return (getDb().prepare(`SELECT * FROM todos WHERE archived_at IS NULL ORDER BY ${DISPLAY_ORDER}`).all() as TodoRow[]).map(fromRow);
}

type ArchivedRow = TodoRow & { archived_at: string; archive_week: string; archive_reason: string };

/** Everything in the archive, oldest first. */
export function listArchivedTodos(): ArchivedTodo[] {
  const rows = getDb().prepare("SELECT * FROM todos WHERE archived_at IS NOT NULL ORDER BY id").all() as ArchivedRow[];
  return rows.map((row) => {
    const { id, parentId, title, status, createdAt, doneAt } = fromRow(row);
    return {
      id,
      parentId,
      title,
      status,
      createdAt,
      ...(doneAt !== undefined && { doneAt }),
      archivedAt: row.archived_at,
      archiveWeek: row.archive_week,
      archiveReason: row.archive_reason as ArchiveReason,
    };
  });
}

export function getTodo(id: number): Todo | null {
  const row = getDb().prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
  return row ? fromRow(row) : null;
}

/** An instant as stored, or null when it is not one (an old row written with no time in it). */
function instantOf(stored: string | null): Date | null {
  if (!stored) return null;
  const date = new Date(stored);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Before every date, for an item whose creation time is not known. */
const BEFORE_ALL_DATES = "0000-01-01";

/** What the weekly sweep looks at: every item, archived ones too, with the local date it was made on. */
export function listSweepItems(): SweepItem[] {
  const rows = getDb().prepare("SELECT * FROM todos ORDER BY id").all() as (TodoRow & { archived_at: string | null })[];
  return rows.map((row) => {
    const made = instantOf(row.created_at);
    return {
      id: row.id,
      parentId: row.parent_id,
      status: fromRow(row).status,
      createdOn: made ? localDateOf(made) : BEFORE_ALL_DATES,
      archived: row.archived_at !== null,
      rolledFromWeek: row.rolled_from_week,
      rollCount: row.roll_count,
    };
  });
}

type EventRow = {
  todo_id: number;
  kind: string;
  at: string;
  on_date: string;
  utc_offset: number;
  from_status: string | null;
  to_status: string | null;
  week_start: string | null;
  roll_count: number | null;
  reason: string | null;
};

function eventFromRow(row: EventRow): TodoEvent {
  const event: TodoEvent = {
    todoId: row.todo_id,
    kind: row.kind as EventKind,
    at: row.at,
    on: row.on_date,
    utcOffset: row.utc_offset,
  };
  if (row.from_status !== null) event.fromStatus = row.from_status as TodoStatus;
  if (row.to_status !== null) event.toStatus = row.to_status as TodoStatus;
  if (row.week_start !== null) event.weekStart = row.week_start;
  if (row.roll_count !== null) event.rollCount = row.roll_count;
  if (row.reason !== null) event.reason = row.reason as ArchiveReason;
  return event;
}

/** The activity log, oldest first. Never shown; the weekly sweep and the reports read it. */
export function listTodoEvents(): TodoEvent[] {
  return (getDb().prepare("SELECT * FROM todo_events ORDER BY id").all() as EventRow[]).map(eventFromRow);
}

/** Writes one event: when it happened as an instant, as the local date the person saw, and the zone's offset then. */
function logEvent(
  db: Database.Database,
  todoId: number,
  kind: EventKind,
  now: Date,
  detail: Pick<TodoEvent, "fromStatus" | "toStatus" | "weekStart" | "rollCount" | "reason"> = {},
): void {
  db.prepare(
    `INSERT INTO todo_events (todo_id, kind, at, on_date, utc_offset, from_status, to_status, week_start, roll_count, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    todoId,
    kind,
    now.toISOString(),
    localDateOf(now),
    -now.getTimezoneOffset(),
    detail.fromStatus ?? null,
    detail.toStatus ?? null,
    detail.weekStart ?? null,
    detail.rollCount ?? null,
    detail.reason ?? null,
  );
}

export function addTodo(title: string, parentId: number | null, now: Date = new Date()): Todo {
  const db = getDb();
  const at = now.toISOString();
  const id = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO todos (parent_id, title, done, status, created_at, updated_at) VALUES (?, ?, 0, 'todo', ?, ?)")
      .run(parentId, title, at, at);
    const newId = Number(result.lastInsertRowid);
    logEvent(db, newId, "created", now);
    return newId;
  })();
  const todo = getTodo(id);
  if (!todo) throw new Error("Failed to read back the to-do that was just added");
  return todo;
}

/** A change to an item: a new title, and/or ticking it (`done`) or moving it (`status`; wins over `done` if both are given). */
export function updateTodo(
  id: number,
  change: { title?: string; done?: boolean; status?: TodoStatus; priority?: TodoPriority | null },
  now: Date = new Date(),
): Todo | null {
  const current = getTodo(id);
  if (!current) return null;
  let next = current;
  if (change.done !== undefined) next = withDone(next, change.done);
  if (change.status !== undefined) next = withStatus(next, change.status);
  const title = change.title ?? current.title;
  // A priority is not part of the activity log (the weekly reports count status changes), so changing it logs nothing.
  const priority = change.priority === undefined ? (current.priority ?? null) : change.priority;
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE todos SET title = ?, done = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?").run(
      title,
      next.done ? 1 : 0,
      next.status,
      priority,
      now.toISOString(),
      id,
    );
    // When it was ticked is kept on the row; unticking clears it (the log still has the completion).
    if (next.status === "done" && current.status !== "done") {
      db.prepare("UPDATE todos SET done_at = ?, done_on = ? WHERE id = ?").run(now.toISOString(), localDateOf(now), id);
    } else if (next.status !== "done" && current.status === "done") {
      db.prepare("UPDATE todos SET done_at = NULL, done_on = NULL WHERE id = ?").run(id);
    }
    // An item sent to the backlog starts clean when it comes back: it is no longer waiting in Rolled over, and its count is reset.
    if (next.status === "backlog" && current.status !== "backlog") {
      db.prepare("UPDATE todos SET rolled_from_week = NULL, roll_count = 0 WHERE id = ?").run(id);
    }
    if (title !== current.title) logEvent(db, id, "renamed", now);
    if (next.status !== current.status) {
      logEvent(db, id, "status_changed", now, { fromStatus: current.status, toStatus: next.status });
    }
  })();
  return getTodo(id);
}

/**
 * Puts the item immediately before `beforeId` among its live siblings, or last when `beforeId` is null or not one of
 * them, and fixes the whole sibling list's order, so what the owner sees is what stays. Not a content edit: nothing is
 * logged and `updated_at` is left alone. False, with nothing changed, when the item is not on the live list.
 */
export function placeTodo(id: number, beforeId: number | null): boolean {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT parent_id FROM todos WHERE id = ? AND archived_at IS NULL").get(id) as { parent_id: number | null } | undefined;
    if (!row) return false;
    const siblings = (
      db.prepare(`SELECT id FROM todos WHERE parent_id IS ? AND archived_at IS NULL ORDER BY ${DISPLAY_ORDER}`).all(row.parent_id) as { id: number }[]
    ).map((sibling) => sibling.id);
    const setPosition = db.prepare("UPDATE todos SET position = ? WHERE id = ?");
    placeBefore(siblings, id, beforeId).forEach((todoId, index) => setPosition.run(index, todoId));
    return true;
  })();
}

/**
 * Moves the item, with everything under it, under `parentId` (or to the top level when that is null), immediately before
 * `beforeId` among its new live siblings or last, and fixes their order. Like `placeTodo` it is not a content edit: nothing
 * is logged and `updated_at` is left alone. "missing" when the item or the parent is not on the live list, "inside" when
 * the parent is the item or under it; nothing changes then.
 */
export function nestTodo(id: number, parentId: number | null, beforeId: number | null): "ok" | "missing" | "inside" {
  const db = getDb();
  return db.transaction(() => {
    const live = (todoId: number) => db.prepare("SELECT 1 FROM todos WHERE id = ? AND archived_at IS NULL").get(todoId) !== undefined;
    if (!live(id) || (parentId !== null && !live(parentId))) return "missing";
    if (parentId !== null) {
      const inside = db.prepare(`${SUBTREE} SELECT 1 FROM subtree WHERE id = ?`).get(id, parentId) !== undefined;
      if (inside) return "inside";
    }
    db.prepare("UPDATE todos SET parent_id = ? WHERE id = ?").run(parentId, id);
    const siblings = (
      db.prepare(`SELECT id FROM todos WHERE parent_id IS ? AND archived_at IS NULL ORDER BY ${DISPLAY_ORDER}`).all(parentId) as { id: number }[]
    ).map((sibling) => sibling.id);
    const setPosition = db.prepare("UPDATE todos SET position = ? WHERE id = ?");
    placeBefore(siblings, id, beforeId).forEach((todoId, index) => setPosition.run(index, todoId));
    return "ok" as const;
  })();
}

/** "Move completed to the bottom": among the siblings at every level, the done items go below the open ones, each keeping its order. */
export function sortDoneLast(): void {
  const db = getDb();
  db.transaction(() => {
    const setPosition = db.prepare("UPDATE todos SET position = ? WHERE id = ?");
    for (const ids of doneLastGroups(listTodos())) ids.forEach((todoId, index) => setPosition.run(index, todoId));
  })();
}

/** "Sort by priority": among the siblings at every level, P1 goes first and items with none last, equal ones keeping their order. */
export function sortByPriority(): void {
  const db = getDb();
  db.transaction(() => {
    const setPosition = db.prepare("UPDATE todos SET position = ? WHERE id = ?");
    for (const ids of priorityGroups(listTodos())) ids.forEach((todoId, index) => setPosition.run(index, todoId));
  })();
}

const SUBTREE = `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM todos WHERE id = ?
         UNION ALL
         SELECT t.id FROM todos t JOIN subtree s ON t.parent_id = s.id
       )`;

/**
 * Archives the item and every item under it that is not archived yet (one that already is keeps its own reason), for
 * the reason given: "removed" by the owner, or "dropped" from Rolled over. `startDay` is the day weeks start on, which
 * decides the week it is filed under.
 */
export function archiveTodoTree(id: number, reason: Exclude<ArchiveReason, "done">, startDay: DayOfWeek, now: Date = new Date()): void {
  const db = getDb();
  const week = weekOf(localDateOf(now), startDay).start;
  db.transaction(() => {
    const ids = db.prepare(`${SUBTREE} SELECT id FROM todos WHERE id IN (SELECT id FROM subtree) AND archived_at IS NULL ORDER BY id`).all(id) as { id: number }[];
    for (const { id: todoId } of ids) {
      db.prepare("UPDATE todos SET archived_at = ?, archive_week = ?, archive_reason = ? WHERE id = ?").run(now.toISOString(), week, reason, todoId);
      logEvent(db, todoId, "archived", now, { weekStart: week, reason });
    }
  })();
}

type ActivityRow = {
  id: number;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  archived_at: string | null;
};

/**
 * The items the retention window has run out on. Only archived items are ever candidates, and the clock is the latest
 * activity (made, changed, done, archived) anywhere in an item's subtree: a branch goes only when all of it is archived
 * and all of it is older than the window. `windowMonths` null keeps everything.
 */
function expiredIds(windowMonths: number | null, now: Date): number[] {
  if (windowMonths === null) return [];
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const limit = cutoff.toISOString();

  const rows = getDb().prepare("SELECT id, parent_id, created_at, updated_at, done_at, archived_at FROM todos").all() as ActivityRow[];
  const childrenOf = new Map<number, ActivityRow[]>();
  for (const row of rows) {
    if (row.parent_id !== null) childrenOf.set(row.parent_id, [...(childrenOf.get(row.parent_id) ?? []), row]);
  }

  const summaries = new Map<number, { allArchived: boolean; last: string }>();
  const summarize = (row: ActivityRow, path: ReadonlySet<number>): { allArchived: boolean; last: string } => {
    const known = summaries.get(row.id);
    if (known) return known;
    // A loop in the parent links is not a branch anyone can have made; leave it alone.
    if (path.has(row.id)) return { allArchived: false, last: "" };
    const nested = new Set(path).add(row.id);
    let allArchived = row.archived_at !== null;
    let last = [row.created_at, row.updated_at, row.done_at ?? "", row.archived_at ?? ""].reduce((a, b) => (a > b ? a : b));
    for (const child of childrenOf.get(row.id) ?? []) {
      const below = summarize(child, nested);
      allArchived &&= below.allArchived;
      if (below.last > last) last = below.last;
    }
    const summary = { allArchived, last };
    summaries.set(row.id, summary);
    return summary;
  };

  const doomed = new Set<number>();
  const collect = (row: ActivityRow) => {
    doomed.add(row.id);
    for (const child of childrenOf.get(row.id) ?? []) collect(child);
  };
  for (const row of rows) {
    const { allArchived, last } = summarize(row, new Set());
    if (row.archived_at !== null && allArchived && last < limit) collect(row);
  }
  return [...doomed].sort((a, b) => a - b);
}

/** How many archived items `purgeExpired` would delete now, for the warning before the window is shortened. */
export function previewPurge(windowMonths: number | null, now: Date = new Date()): number {
  return expiredIds(windowMonths, now).length;
}

/** Deletes the archived items the retention window has run out on, with their log rows. Returns how many. */
export function purgeExpired(windowMonths: number | null, now: Date = new Date()): number {
  const db = getDb();
  const ids = expiredIds(windowMonths, now);
  db.transaction(() => {
    for (const id of ids) {
      db.prepare("DELETE FROM todo_events WHERE todo_id = ?").run(id);
      db.prepare("DELETE FROM todos WHERE id = ?").run(id);
    }
  })();
  return ids.length;
}

/** The last day of the latest week the sweep has closed, or null if it has closed none. */
export function lastClosedWeekEnd(): string | null {
  const row = getDb().prepare("SELECT MAX(period_end) AS end FROM todo_closed WHERE kind = 'week'").get() as { end: string | null };
  return row.end;
}

/** The periods the cycle closes: weeks, months and fiscal quarters (the sweep and the reports). */
export type PeriodKind = "week" | "month" | "quarter";

/** The last day of the latest period of that kind that has been closed, or null if none has. */
export function lastClosedPeriodEnd(kind: PeriodKind): string | null {
  const row = getDb().prepare("SELECT MAX(period_end) AS end FROM todo_closed WHERE kind = ?").get(kind) as { end: string | null };
  return row.end;
}

/** Records a month or quarter (or a week) as dealt with. Does nothing if it already is. True if it was recorded now. */
export function markPeriodClosed(kind: PeriodKind, period: Period, now: Date = new Date()): boolean {
  const result = getDb()
    .prepare("INSERT OR IGNORE INTO todo_closed (kind, period_start, period_end, closed_at) VALUES (?, ?, ?, ?)")
    .run(kind, period.start, period.end, now.toISOString());
  return result.changes > 0;
}

/** Every period of that kind that has been closed, newest first. */
export function closedPeriods(kind: PeriodKind): Period[] {
  const rows = getDb().prepare("SELECT period_start, period_end FROM todo_closed WHERE kind = ? ORDER BY period_start DESC").all(kind) as {
    period_start: string;
    period_end: string;
  }[];
  return rows.map((row) => ({ start: row.period_start, end: row.period_end }));
}

/** What a report needs to know of every item, archived ones too: which it is, what it is under, and what it was called. */
export function listReportItems(): { id: number; parentId: number | null; title: string }[] {
  const rows = getDb().prepare("SELECT id, parent_id, title FROM todos ORDER BY id").all() as { id: number; parent_id: number | null; title: string }[];
  return rows.map((row) => ({ id: row.id, parentId: row.parent_id, title: row.title }));
}

/** Records a week as dealt with, touching no item. Does nothing if it already is. True if it was recorded now. */
export function markWeekClosed(week: Period, now: Date = new Date()): boolean {
  const result = getDb()
    .prepare("INSERT OR IGNORE INTO todo_closed (kind, period_start, period_end, closed_at) VALUES ('week', ?, ?, ?)")
    .run(week.start, week.end, now.toISOString());
  return result.changes > 0;
}

/**
 * Applies what the sweep planned for one week, once: the finished items are archived as done, the open ones are
 * marked as rolled over, and the week is recorded as closed. Every change is logged against the week that closed, not
 * the day the sweep happened to run. False, with nothing changed, if the week was already closed.
 */
export function closeWeek(plan: WeekPlan, now: Date = new Date()): boolean {
  const db = getDb();
  return db.transaction(() => {
    if (!markWeekClosed(plan.week, now)) return false;
    // An item deleted since the plan was made has nothing to change, and nothing to log.
    for (const id of plan.archive) {
      const result = db
        .prepare("UPDATE todos SET archived_at = ?, archive_week = ?, archive_reason = 'done' WHERE id = ?")
        .run(now.toISOString(), plan.week.start, id);
      if (result.changes > 0) logEvent(db, id, "archived", now, { weekStart: plan.week.start, reason: "done" });
    }
    for (const { id, rolledFromWeek, rollCount } of plan.roll) {
      const result = db.prepare("UPDATE todos SET rolled_from_week = ?, roll_count = ? WHERE id = ?").run(rolledFromWeek, rollCount, id);
      if (result.changes > 0) logEvent(db, id, "rolled", now, { weekStart: plan.week.start, rollCount });
    }
    return true;
  })();
}

/**
 * "Add to this week": the item leaves Rolled over and stays as it is, and keeps how many weeks it has rolled. So does
 * everything rolled under it, because a rolled branch is placed as one.
 */
export function acceptRolledTodo(id: number, now: Date = new Date()): void {
  getDb()
    .prepare(`${SUBTREE} UPDATE todos SET rolled_from_week = NULL, updated_at = ? WHERE id IN (SELECT id FROM subtree) AND rolled_from_week IS NOT NULL`)
    .run(id, now.toISOString());
}

/**
 * "Move to backlog", for a rolled branch: its top item goes to the backlog, and the whole branch starts clean (no longer
 * rolled over, count reset). The sub-items keep their own status and stay under it.
 */
export function moveRolledToBacklog(id: number, now: Date = new Date()): void {
  const db = getDb();
  db.transaction(() => {
    if (!updateTodo(id, { status: "backlog" }, now)) return;
    db.prepare(`${SUBTREE} UPDATE todos SET rolled_from_week = NULL, roll_count = 0 WHERE id IN (SELECT id FROM subtree)`).run(id);
  })();
}

/** The live items a first run offers to archive: done, with only finished things under them (the rule the weekly sweep uses). */
export function finishedTodoIds(now: Date = new Date()): number[] {
  const day = localDateOf(now);
  return planSweep(listSweepItems(), listTodoEvents(), [{ start: day, end: day }])[0].archive;
}

/**
 * A first run's "yes": archives `finishedTodoIds` as done, backdated. An item with no completion date takes the day it was
 * last changed, which the log is told (so a month's report counts it); one that has a date keeps it. Each is filed under
 * the week that date falls in. No report is made for those weeks. Returns how many.
 */
export function archiveFinishedTodos(startDay: DayOfWeek, now: Date = new Date()): number {
  const db = getDb();
  return db.transaction(() => {
    const ids = finishedTodoIds(now);
    for (const id of ids) {
      const row = db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow;
      const completed = instantOf(row.done_at) ?? instantOf(row.updated_at) ?? instantOf(row.created_at) ?? now;
      const week = weekOf(localDateOf(completed), startDay).start;
      if (row.done_at === null) {
        db.prepare("UPDATE todos SET done_at = ?, done_on = ? WHERE id = ?").run(completed.toISOString(), localDateOf(completed), id);
        logEvent(db, id, "status_changed", completed, { fromStatus: "todo", toStatus: "done" });
      }
      db.prepare("UPDATE todos SET archived_at = ?, archive_week = ?, archive_reason = 'done' WHERE id = ?").run(now.toISOString(), week, id);
      logEvent(db, id, "archived", now, { weekStart: week, reason: "done" });
    }
    return ids.length;
  })();
}

/**
 * True the first time it is called on a local day, so the purge runs at most once a day. Kept in `todo_closed` under a
 * kind of its own, and only the latest day is kept.
 */
export function claimDailyPurge(day: string, now: Date = new Date()): boolean {
  const db = getDb();
  return db.transaction(() => {
    const result = db
      .prepare("INSERT OR IGNORE INTO todo_closed (kind, period_start, period_end, closed_at) VALUES ('purge', ?, ?, ?)")
      .run(day, day, now.toISOString());
    if (result.changes > 0) db.prepare("DELETE FROM todo_closed WHERE kind = 'purge' AND period_start < ?").run(day);
    return result.changes > 0;
  })();
}

/**
 * Brings an archived item back to the live list as a `todo`, with the sub-items that were archived in the same action
 * (so removing a branch and restoring it is a round trip; sub-items archived earlier stay archived). An item whose parent
 * is still archived, or gone, comes back at the top level, as a note does from the Trash Can. The history is not
 * rewritten: the log keeps the earlier completion. Null when the item is not archived.
 */
export function restoreTodo(id: number, now: Date = new Date()): { toTopLevel: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM todos WHERE id = ? AND archived_at IS NOT NULL").get(id) as
      | (TodoRow & { parent_id: number | null; archived_at: string })
      | undefined;
    if (!row) return null;

    const restoring = [id];
    for (let i = 0; i < restoring.length; i++) {
      const children = db.prepare("SELECT id FROM todos WHERE parent_id = ? AND archived_at = ? ORDER BY id").all(restoring[i], row.archived_at) as { id: number }[];
      restoring.push(...children.map((child) => child.id));
    }

    const parent =
      row.parent_id === null
        ? undefined
        : (db.prepare("SELECT archived_at FROM todos WHERE id = ?").get(row.parent_id) as { archived_at: string | null } | undefined);
    const toTopLevel = row.parent_id !== null && (parent === undefined || parent.archived_at !== null);

    const status = fromRow(row).status;
    db.prepare(
      `UPDATE todos SET status = 'todo', done = 0, done_at = NULL, done_on = NULL, rolled_from_week = NULL, updated_at = ?
       ${toTopLevel ? ", parent_id = NULL" : ""} WHERE id = ?`,
    ).run(now.toISOString(), id);
    if (status !== "todo") logEvent(db, id, "status_changed", now, { fromStatus: status, toStatus: "todo" });

    for (const todoId of restoring) {
      db.prepare("UPDATE todos SET archived_at = NULL, archive_week = NULL, archive_reason = NULL WHERE id = ?").run(todoId);
      logEvent(db, todoId, "restored", now);
    }
    return { toTopLevel };
  })();
}

/**
 * What `deleteTodoTree` would erase: how many items (the item and everything under it, archived or not), and which
 * reports mention any of their titles, so the owner can edit them first: a report is a note, and deleting an item
 * does not change it (docs/todo-archival-plan.md, T13). A report is a note with a recorded link; one whose note has been
 * deleted is not listed. A title is looked for exactly as written. Newest first, each report once.
 */
export function previewDelete(id: number): TodoDeletePreview {
  const db = getDb();
  const titles = (db.prepare(`${SUBTREE} SELECT title FROM todos WHERE id IN (SELECT id FROM subtree)`).all(id) as { title: string }[]).map((row) => row.title);
  if (titles.length === 0) return { items: 0, reports: [] };
  const notes = db
    .prepare(
      `SELECT n.id AS id, n.title AS title, n.content AS content, MAX(r.generated_at) AS generated_at
       FROM todo_reports r JOIN notes n ON n.id = r.note_id GROUP BY n.id ORDER BY generated_at DESC, n.id DESC`,
    )
    .all() as { id: number; title: string; content: string }[];
  const mentioning = notes.filter((note) => titles.some((title) => title !== "" && note.content.includes(title)));
  return { items: titles.length, reports: mentioning.map((note) => ({ noteId: note.id, title: note.title })) };
}

/**
 * Deletes the item and every item under it, archived or not, for good, and erases their rows in the activity log, so
 * nothing is left in the history. Reports already written are notes, and are not touched.
 */
export function deleteTodoTree(id: number): void {
  const db = getDb();
  db.transaction(() => {
    // The events go first: once the items are gone there is no subtree left to find them by.
    db.prepare(`${SUBTREE} DELETE FROM todo_events WHERE todo_id IN (SELECT id FROM subtree)`).run(id);
    db.prepare(`${SUBTREE} DELETE FROM todos WHERE id IN (SELECT id FROM subtree)`).run(id);
  })();
}
