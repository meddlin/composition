import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The to-do repo against a real temporary database: what it writes to the activity log, and how archiving, restoring,
 * deleting and purging behave. The clock is passed in, and the time zone is pinned (New York, UTC-4 until 1 Nov 2026,
 * UTC-5 after), so the local dates and zone offsets in the log can be asserted as literals.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todos-repo-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("TZ", "America/New_York");
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

/** A local moment in New York, built from local parts. */
const local = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute);

describe("archiving", () => {
  it("takes an item and everything under it out of the list and files it in the archive with a reason", async () => {
    const { addTodo, archiveTodoTree, listTodos, listArchivedTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    const other = addTodo("Reply to vendor", null, local(10, 26));

    archiveTodoTree(parent.id, "removed", 0, local(10, 28, 14, 5)); // a Wednesday, Sunday-start week

    expect(listTodos().map((t) => t.id)).toEqual([other.id]);
    expect(listArchivedTodos()).toEqual([
      expect.objectContaining({ id: parent.id, title: "Plan trip", archiveReason: "removed", archiveWeek: "2026-10-25", archivedAt: "2026-10-28T18:05:00.000Z" }),
      expect.objectContaining({ id: child.id, parentId: parent.id, archiveReason: "removed", archiveWeek: "2026-10-25" }),
    ]);
  });

  it("files it under the week the weeks start day makes it", async () => {
    const { addTodo, archiveTodoTree, listArchivedTodos } = await import("./todosRepo");
    const todo = addTodo("Plan trip", null, local(10, 26));

    archiveTodoTree(todo.id, "dropped", 1, local(10, 28)); // weeks start on Monday

    expect(listArchivedTodos()[0]).toMatchObject({ archiveReason: "dropped", archiveWeek: "2026-10-26" });
  });

  it("logs one archived event for each item, with the reason and the week", async () => {
    const { addTodo, archiveTodoTree, listTodoEvents } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));

    archiveTodoTree(parent.id, "dropped", 0, local(10, 28));

    expect(listTodoEvents().filter((e) => e.kind === "archived")).toEqual([
      expect.objectContaining({ todoId: parent.id, on: "2026-10-28", reason: "dropped", weekStart: "2026-10-25" }),
      expect.objectContaining({ todoId: child.id, on: "2026-10-28", reason: "dropped", weekStart: "2026-10-25" }),
    ]);
  });

  it("leaves a sub-item that was already archived with the reason it has", async () => {
    const { addTodo, archiveTodoTree, listArchivedTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    archiveTodoTree(child.id, "dropped", 0, local(10, 27));

    archiveTodoTree(parent.id, "removed", 0, local(10, 28));

    const byId = new Map(listArchivedTodos().map((t) => [t.id, t]));
    expect(byId.get(child.id)).toMatchObject({ archiveReason: "dropped", archiveWeek: "2026-10-25" });
    expect(byId.get(parent.id)?.archiveReason).toBe("removed");
  });

  it("does nothing for an item that is not there", async () => {
    const { archiveTodoTree, listTodoEvents } = await import("./todosRepo");

    expect(() => archiveTodoTree(99, "removed", 0, local(10, 28))).not.toThrow();
    expect(listTodoEvents()).toEqual([]);
  });
});

describe("purging what has outlived the retention window", () => {
  const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12);
  const now = local(10, 28);

  it("counts and deletes an archived item whose last activity is older than the window, and its log rows", async () => {
    const repo = await import("./todosRepo");
    const old = repo.addTodo("Old", null, at(2025, 1, 10));
    repo.archiveTodoTree(old.id, "removed", 0, at(2025, 1, 15));
    const recent = repo.addTodo("Recent", null, at(2026, 9, 1));
    repo.archiveTodoTree(recent.id, "removed", 0, at(2026, 9, 2));

    expect(repo.previewPurge(12, now)).toBe(1);
    expect(repo.purgeExpired(12, now)).toBe(1);

    expect(repo.listArchivedTodos().map((t) => t.id)).toEqual([recent.id]);
    expect(repo.listTodoEvents().map((e) => e.todoId)).not.toContain(old.id);
  });

  it("keeps everything while the window is long enough, and when it is set to keep forever", async () => {
    const repo = await import("./todosRepo");
    const old = repo.addTodo("Old", null, at(2025, 1, 10));
    repo.archiveTodoTree(old.id, "removed", 0, at(2025, 1, 15));

    expect(repo.previewPurge(60, now)).toBe(0);
    expect(repo.previewPurge(null, now)).toBe(0);
    expect(repo.purgeExpired(null, now)).toBe(0);
    expect(repo.listArchivedTodos()).toHaveLength(1);
  });

  it("never purges an item that is not archived, however old", async () => {
    const repo = await import("./todosRepo");
    repo.addTodo("Ancient but live", null, at(2020, 1, 1));

    expect(repo.purgeExpired(1, now)).toBe(0);
    expect(repo.listTodos()).toHaveLength(1);
  });

  it("goes by the latest activity, so an archived item touched recently stays", async () => {
    const repo = await import("./todosRepo");
    const todo = repo.addTodo("Old but touched", null, at(2024, 1, 10));
    repo.archiveTodoTree(todo.id, "removed", 0, at(2024, 1, 15));
    repo.updateTodo(todo.id, { title: "Old, renamed" }, at(2026, 9, 1));

    expect(repo.purgeExpired(12, now)).toBe(0);
  });

  it("purges a branch only when all of it is archived and old", async () => {
    const repo = await import("./todosRepo");
    const parent = repo.addTodo("Parent", null, at(2024, 1, 10));
    const touched = repo.addTodo("Touched since", parent.id, at(2024, 1, 10));
    const untouched = repo.addTodo("Left alone", parent.id, at(2024, 1, 10));
    repo.archiveTodoTree(parent.id, "removed", 0, at(2024, 1, 15));
    repo.updateTodo(touched.id, { title: "Touched, renamed" }, at(2026, 9, 1));

    expect(repo.previewPurge(12, now)).toBe(1);
    repo.purgeExpired(12, now);

    expect(repo.listArchivedTodos().map((t) => t.id)).toEqual([parent.id, touched.id]);
    expect([parent.id, touched.id]).not.toContain(untouched.id);
  });

  it("keeps an old archived parent while an item under it is still live", async () => {
    const repo = await import("./todosRepo");
    const parent = repo.addTodo("Parent", null, at(2024, 1, 10));
    repo.archiveTodoTree(parent.id, "removed", 0, at(2024, 1, 15));
    const child = repo.addTodo("Live child", parent.id, at(2024, 2, 1));

    expect(repo.purgeExpired(12, now)).toBe(0);
    expect(repo.listArchivedTodos().map((t) => t.id)).toEqual([parent.id]);
    expect(repo.listTodos().map((t) => t.id)).toEqual([child.id]);
  });
});

describe("closing a week", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };

  /** A finished item and an open one, and the plan a sweep would make for them. */
  async function setUp() {
    const repo = await import("./todosRepo");
    const finished = repo.addTodo("Reply to vendor", null, local(10, 26));
    repo.updateTodo(finished.id, { done: true }, local(10, 27));
    const open = repo.addTodo("Write Q4 plan", null, local(10, 26));
    const plan = { week, archive: [finished.id], roll: [{ id: open.id, rolledFromWeek: "2026-10-25", rollCount: 1 }] };
    return { repo, finished, open, plan };
  }

  it("archives what the plan says is done and rolls what it says is open", async () => {
    const { repo, finished, open, plan } = await setUp();

    expect(repo.closeWeek(plan, local(11, 1, 0, 5))).toBe(true);

    expect(repo.listTodos()).toEqual([expect.objectContaining({ id: open.id, rolledFromWeek: "2026-10-25", rollCount: 1 })]);
    expect(repo.listArchivedTodos()).toEqual([
      expect.objectContaining({ id: finished.id, archiveReason: "done", archiveWeek: "2026-10-25" }),
    ]);
  });

  it("logs the archive and the roll against the week that closed, whenever the sweep ran", async () => {
    const { repo, finished, open, plan } = await setUp();

    repo.closeWeek(plan, local(11, 2, 8, 30)); // closed on the Monday

    expect(repo.listTodoEvents().filter((e) => e.kind === "archived" || e.kind === "rolled")).toEqual([
      expect.objectContaining({ todoId: finished.id, kind: "archived", reason: "done", weekStart: "2026-10-25", on: "2026-11-02" }),
      expect.objectContaining({ todoId: open.id, kind: "rolled", weekStart: "2026-10-25", rollCount: 1, on: "2026-11-02" }),
    ]);
  });

  it("does nothing the second time, so running the sweep twice cannot count a week twice", async () => {
    const { repo, open, plan } = await setUp();
    repo.closeWeek(plan, local(11, 1));

    expect(repo.closeWeek(plan, local(11, 2))).toBe(false);

    expect(repo.listTodos().find((t) => t.id === open.id)?.rollCount).toBe(1);
    expect(repo.listTodoEvents().filter((e) => e.kind === "rolled")).toHaveLength(1);
  });

  it("skips an item that was deleted after the plan was made, without logging anything for it", async () => {
    const repo = await import("./todosRepo");

    repo.closeWeek({ week, archive: [99], roll: [{ id: 98, rolledFromWeek: "2026-10-25", rollCount: 1 }] }, local(11, 1));

    expect(repo.listTodoEvents()).toEqual([]);
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
  });

  it("remembers the last week that was closed", async () => {
    const { repo, plan } = await setUp();
    expect(repo.lastClosedWeekEnd()).toBeNull();

    repo.closeWeek(plan, local(11, 1));

    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
  });

  it("can mark a week closed without touching any item, which is how a first run starts", async () => {
    const { repo, open } = await setUp();

    repo.markWeekClosed(week, local(11, 1));

    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
    expect(repo.listTodos().find((t) => t.id === open.id)?.rolledFromWeek).toBeUndefined();
  });
});

describe("Rolled over", () => {
  async function rolledItem() {
    const repo = await import("./todosRepo");
    const todo = repo.addTodo("Write Q4 plan", null, local(10, 26));
    repo.closeWeek({ week: { start: "2026-10-25", end: "2026-10-31" }, archive: [], roll: [{ id: todo.id, rolledFromWeek: "2026-10-25", rollCount: 2 }] }, local(11, 1));
    return { repo, todo };
  }

  it("adding an item to this week takes it out of Rolled over and keeps how often it rolled", async () => {
    const { repo, todo } = await rolledItem();

    repo.acceptRolledTodo(todo.id, local(11, 2));

    expect(repo.listTodos()[0]).toMatchObject({ id: todo.id, status: "todo", rollCount: 2 });
    expect(repo.listTodos()[0].rolledFromWeek).toBeUndefined();
  });

  it("moving an item to the backlog clears both, so it starts clean when it comes back", async () => {
    const { repo, todo } = await rolledItem();

    repo.updateTodo(todo.id, { status: "backlog" }, local(11, 2));

    const item = repo.listTodos()[0];
    expect(item.status).toBe("backlog");
    expect(item.rolledFromWeek).toBeUndefined();
    expect(item.rollCount).toBeUndefined();
  });
});

describe("Rolled over, as a branch", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };

  /** A rolled parent with a rolled sub-item and a placed one, and a rolled item of its own beside them. */
  async function rolledBranch() {
    const repo = await import("./todosRepo");
    const parent = repo.addTodo("Plan trip", null, local(10, 26));
    const rolledChild = repo.addTodo("Book flights", parent.id, local(10, 26));
    const placedChild = repo.addTodo("Pack", parent.id, local(10, 26));
    const other = repo.addTodo("Write Q4 plan", null, local(10, 26));
    repo.closeWeek(
      {
        week,
        archive: [],
        roll: [
          { id: parent.id, rolledFromWeek: "2026-10-18", rollCount: 3 },
          { id: rolledChild.id, rolledFromWeek: "2026-10-18", rollCount: 2 },
          { id: other.id, rolledFromWeek: "2026-10-25", rollCount: 1 },
        ],
      },
      local(11, 1),
    );
    return { repo, parent, rolledChild, placedChild, other };
  }

  const byId = <T extends { id: number }>(todos: T[], id: number): T => todos.find((t) => t.id === id)!;

  it("adding an item to this week takes the whole rolled branch out of Rolled over, keeping each count, and nothing beside it", async () => {
    const { repo, parent, rolledChild, placedChild, other } = await rolledBranch();

    repo.acceptRolledTodo(parent.id, local(11, 2));

    const todos = repo.listTodos();
    expect(byId(todos, parent.id)).toMatchObject({ rollCount: 3 });
    expect(byId(todos, parent.id).rolledFromWeek).toBeUndefined();
    expect(byId(todos, rolledChild.id)).toMatchObject({ rollCount: 2 });
    expect(byId(todos, rolledChild.id).rolledFromWeek).toBeUndefined();
    expect(byId(todos, placedChild.id).rolledFromWeek).toBeUndefined();
    expect(byId(todos, other.id)).toMatchObject({ rolledFromWeek: "2026-10-25", rollCount: 1 });
  });

  it("moving a rolled branch to the backlog sends its top item there and clears the marks of the whole branch", async () => {
    const { repo, parent, rolledChild, placedChild, other } = await rolledBranch();

    repo.moveRolledToBacklog(parent.id, local(11, 2));

    const todos = repo.listTodos();
    expect(byId(todos, parent.id).status).toBe("backlog");
    expect(byId(todos, parent.id).rolledFromWeek).toBeUndefined();
    expect(byId(todos, parent.id).rollCount).toBeUndefined();
    // The sub-items keep their own status; only their rolled marks go.
    expect(byId(todos, rolledChild.id).status).toBe("todo");
    expect(byId(todos, rolledChild.id).rolledFromWeek).toBeUndefined();
    expect(byId(todos, rolledChild.id).rollCount).toBeUndefined();
    expect(byId(todos, placedChild.id).status).toBe("todo");
    expect(byId(todos, other.id)).toMatchObject({ rolledFromWeek: "2026-10-25", rollCount: 1 });
  });

  it("logs the move to the backlog for the top item only", async () => {
    const { repo, parent } = await rolledBranch();

    repo.moveRolledToBacklog(parent.id, local(11, 2));

    expect(repo.listTodoEvents().filter((e) => e.kind === "status_changed")).toEqual([
      expect.objectContaining({ todoId: parent.id, fromStatus: "todo", toStatus: "backlog", on: "2026-11-02" }),
    ]);
  });

  it("does nothing for an item that is not there", async () => {
    const { repo } = await rolledBranch();
    const before = repo.listTodoEvents().length;

    repo.moveRolledToBacklog(999, local(11, 2));

    expect(repo.listTodoEvents()).toHaveLength(before);
  });
});

describe("the items a sweep looks at", () => {
  it("lists every item, archived ones too, with the local date it was made on and where it stands in Rolled over", async () => {
    const repo = await import("./todosRepo");
    const kept = repo.addTodo("Kept", null, local(10, 26, 21, 30)); // 9:30 pm in New York: still the 26th, though 01:30 UTC the next day
    const gone = repo.addTodo("Gone", null, local(10, 27));
    repo.archiveTodoTree(gone.id, "removed", 0, local(10, 28));
    repo.closeWeek({ week: { start: "2026-10-25", end: "2026-10-31" }, archive: [], roll: [{ id: kept.id, rolledFromWeek: "2026-10-25", rollCount: 1 }] }, local(11, 1));

    expect(repo.listSweepItems()).toEqual([
      { id: kept.id, parentId: null, status: "todo", createdOn: "2026-10-26", archived: false, rolledFromWeek: "2026-10-25", rollCount: 1 },
      { id: gone.id, parentId: null, status: "todo", createdOn: "2026-10-27", archived: true, rolledFromWeek: null, rollCount: 0 },
    ]);
  });
});

describe("a first run's completed items", () => {
  /** Items as an older version left them: no log, no done_at, only when they were last changed. */
  async function legacyItems() {
    const repo = await import("./todosRepo");
    const { getDb } = await import("./db");
    const insert = getDb().prepare("INSERT INTO todos (parent_id, title, done, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
    const row = (parentId: number | null, title: string, status: string, updatedAt: string) =>
      Number(insert.run(parentId, title, status === "done" ? 1 : 0, status, "2026-09-01T16:00:00.000Z", updatedAt).lastInsertRowid);
    const reply = row(null, "Reply to vendor", "done", "2026-10-08T15:30:00.000Z"); // a Thursday, in the week of Sunday 4 October
    const open = row(null, "Write Q4 plan", "todo", "2026-10-09T15:30:00.000Z");
    const trip = row(null, "Plan trip", "done", "2026-10-14T15:30:00.000Z"); // done, with everything under it done
    const flights = row(trip, "Book flights", "done", "2026-10-13T15:30:00.000Z");
    const half = row(null, "Move house", "done", "2026-10-15T15:30:00.000Z"); // done, but something under it is not
    const boxes = row(half, "Pack boxes", "todo", "2026-10-15T15:30:00.000Z");
    return { repo, reply, open, trip, flights, half, boxes };
  }

  it("counts the done items that have only finished things under them", async () => {
    const { repo, reply, trip, flights } = await legacyItems();

    expect(repo.finishedTodoIds(local(10, 30))).toEqual([reply, trip, flights]);
  });

  it("archives them as done, backdated to when they were last changed, and no others", async () => {
    const { repo, reply, open, trip, flights, half, boxes } = await legacyItems();

    expect(repo.archiveFinishedTodos(0, local(10, 30))).toBe(3);

    expect(repo.listTodos().map((t) => t.id)).toEqual([open, half, boxes]);
    expect(repo.listArchivedTodos()).toEqual([
      expect.objectContaining({ id: reply, archiveReason: "done", archiveWeek: "2026-10-04", doneAt: "2026-10-08T15:30:00.000Z", archivedAt: local(10, 30).toISOString() }),
      expect.objectContaining({ id: trip, archiveReason: "done", archiveWeek: "2026-10-11", doneAt: "2026-10-14T15:30:00.000Z" }),
      expect.objectContaining({ id: flights, archiveReason: "done", archiveWeek: "2026-10-11", doneAt: "2026-10-13T15:30:00.000Z" }),
    ]);
  });

  it("files them under the week the weeks start day makes, and credits the day they were last changed in the log", async () => {
    const { repo, reply } = await legacyItems();

    repo.archiveFinishedTodos(1, local(10, 30)); // weeks start on Monday: Thursday 8 October is in the week of the 5th

    expect(repo.listArchivedTodos().find((t) => t.id === reply)).toMatchObject({ archiveWeek: "2026-10-05" });
    expect(repo.listTodoEvents().filter((e) => e.todoId === reply)).toEqual([
      expect.objectContaining({ kind: "status_changed", fromStatus: "todo", toStatus: "done", at: "2026-10-08T15:30:00.000Z", on: "2026-10-08" }),
      expect.objectContaining({ kind: "archived", reason: "done", weekStart: "2026-10-05", on: "2026-10-30" }),
    ]);
  });

  it("keeps the completion date an item already has, without logging it a second time", async () => {
    const repo = await import("./todosRepo");
    const item = repo.addTodo("Ticked since the update", null, local(10, 20));
    repo.updateTodo(item.id, { done: true }, local(10, 22));

    repo.archiveFinishedTodos(0, local(10, 30));

    expect(repo.listArchivedTodos()[0]).toMatchObject({ id: item.id, archiveWeek: "2026-10-18", doneAt: local(10, 22).toISOString() });
    expect(repo.listTodoEvents().filter((e) => e.kind === "status_changed")).toHaveLength(1);
  });
});

describe("the daily purge", () => {
  it("is claimed once for each local day, and only the latest day is kept", async () => {
    const { claimDailyPurge } = await import("./todosRepo");
    const { getDb } = await import("./db");

    expect(claimDailyPurge("2026-11-01", local(11, 1, 9))).toBe(true);
    expect(claimDailyPurge("2026-11-01", local(11, 1, 17))).toBe(false);
    expect(claimDailyPurge("2026-11-02", local(11, 2, 9))).toBe(true);
    expect(claimDailyPurge("2026-11-02", local(11, 2, 10))).toBe(false);

    expect((getDb().prepare("SELECT COUNT(*) AS n FROM todo_closed WHERE kind = 'purge'").get() as { n: number }).n).toBe(1);
  });

  it("is not mistaken for a closed week", async () => {
    const { claimDailyPurge, lastClosedWeekEnd } = await import("./todosRepo");

    claimDailyPurge("2026-11-01", local(11, 1));

    expect(lastClosedWeekEnd()).toBeNull();
  });
});

describe("what deleting an item for good would erase", () => {
  /** A report as the weekly cycle will make one: a note, with a link to it recorded. */
  async function report(title: string, content: string, generatedAt: string): Promise<number> {
    const { getDb } = await import("./db");
    const db = getDb();
    const noteId = Number(db.prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, '', '')").run(title, content).lastInsertRowid);
    db.prepare("INSERT INTO todo_reports (kind, period_start, period_end, note_id, generated_at) VALUES ('week', '2026-10-25', '2026-10-31', ?, ?)").run(noteId, generatedAt);
    return noteId;
  }

  it("counts the item and everything under it, archived or not", async () => {
    const repo = await import("./todosRepo");
    const trip = repo.addTodo("Plan trip", null, local(10, 26));
    const flights = repo.addTodo("Book flights", trip.id, local(10, 26));
    repo.addTodo("Pack", trip.id, local(10, 26));
    repo.updateTodo(flights.id, { done: true }, local(10, 27));
    repo.archiveTodoTree(flights.id, "removed", 0, local(10, 28));
    repo.addTodo("Reply to vendor", null, local(10, 26));

    expect(repo.previewDelete(trip.id).items).toBe(3);
    expect(repo.previewDelete(flights.id).items).toBe(1);
  });

  it("lists the reports whose text mentions the item or anything under it, newest first and each once", async () => {
    const repo = await import("./todosRepo");
    const trip = repo.addTodo("Plan trip", null, local(10, 26));
    repo.addTodo("Book flights", trip.id, local(10, 26));
    const older = await report("Weekly 2026-10-18", "# Week\n- **Plan trip**\n", "2026-10-25T14:03:00.000Z");
    const newer = await report("Weekly 2026-10-25", "# Week\n- Plan trip\n  - Book flights\n", "2026-11-01T14:03:00.000Z");
    const subItemOnly = await report("Monthly 2026-09", "Done: Book flights", "2026-10-02T09:00:00.000Z");
    await report("Weekly 2026-10-11", "# Week\n- Reply to vendor\n", "2026-10-18T14:03:00.000Z");
    // The same note linked twice (a Regenerate) is still one report.
    const { getDb } = await import("./db");
    getDb().prepare("INSERT INTO todo_reports (kind, period_start, period_end, note_id, generated_at) VALUES ('week', '2026-10-25', '2026-10-31', ?, ?)").run(newer, "2026-11-02T08:00:00.000Z");

    expect(repo.previewDelete(trip.id).reports).toEqual([
      { noteId: newer, title: "Weekly 2026-10-25" },
      { noteId: older, title: "Weekly 2026-10-18" },
      { noteId: subItemOnly, title: "Monthly 2026-09" },
    ]);
  });

  it("does not list a note that is not a report, or a report whose note has been deleted", async () => {
    const repo = await import("./todosRepo");
    const { getDb } = await import("./db");
    const trip = repo.addTodo("Plan trip", null, local(10, 26));
    getDb().prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES ('My notes', 'Plan trip ideas', '', '')").run();
    const gone = await report("Weekly 2026-10-25", "- Plan trip", "2026-11-01T14:03:00.000Z");
    getDb().prepare("DELETE FROM notes WHERE id = ?").run(gone);

    expect(repo.previewDelete(trip.id).reports).toEqual([]);
  });

  it("matches the title exactly as written, and reports nothing for an item that is not there", async () => {
    const repo = await import("./todosRepo");
    const trip = repo.addTodo("Plan trip", null, local(10, 26));
    await report("Weekly 2026-10-25", "- plan TRIP", "2026-11-01T14:03:00.000Z");

    expect(repo.previewDelete(trip.id).reports).toEqual([]);
    expect(repo.previewDelete(999)).toEqual({ items: 0, reports: [] });
  });

  it("deleting for good leaves the reports and their links as they were", async () => {
    const repo = await import("./todosRepo");
    const { getDb } = await import("./db");
    const trip = repo.addTodo("Plan trip", null, local(10, 26));
    const noteId = await report("Weekly 2026-10-25", "- Plan trip", "2026-11-01T14:03:00.000Z");

    repo.deleteTodoTree(trip.id);

    expect((getDb().prepare("SELECT content FROM notes WHERE id = ?").get(noteId) as { content: string }).content).toBe("- Plan trip");
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM todo_reports WHERE note_id = ?").get(noteId) as { n: number }).n).toBe(1);
  });
});

describe("deleting for good", () => {
  it("erases an item, everything under it (archived or not) and all their log rows, and nothing else", async () => {
    const { addTodo, archiveTodoTree, deleteTodoTree, listTodos, listArchivedTodos, listTodoEvents } = await import("./todosRepo");
    const parent = addTodo("Sensitive", null, local(10, 26));
    const live = addTodo("Under it, live", parent.id, local(10, 26));
    const archived = addTodo("Under it, archived", parent.id, local(10, 26));
    archiveTodoTree(archived.id, "removed", 0, local(10, 27));
    const keep = addTodo("Unrelated", null, local(10, 26));

    deleteTodoTree(parent.id);

    expect(listTodos().map((t) => t.id)).toEqual([keep.id]);
    expect(listArchivedTodos()).toEqual([]);
    expect(listTodoEvents().map((e) => e.todoId)).toEqual([keep.id]);
    expect([live.id, archived.id]).not.toContain(keep.id);
  });

  it("deleting an item that is already gone is not an error", async () => {
    const { deleteTodoTree } = await import("./todosRepo");

    expect(() => deleteTodoTree(99)).not.toThrow();
  });
});

describe("restoring", () => {
  it("brings back an item with the sub-items that were archived with it, as to-dos", async () => {
    const { addTodo, archiveTodoTree, restoreTodo, listTodos, listArchivedTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    archiveTodoTree(parent.id, "removed", 0, local(10, 28));

    const result = restoreTodo(parent.id, local(10, 29));

    expect(result).toEqual({ toTopLevel: false });
    expect(listTodos().map((t) => [t.id, t.parentId, t.status])).toEqual([
      [parent.id, null, "todo"],
      [child.id, parent.id, "todo"],
    ]);
    expect(listArchivedTodos()).toEqual([]);
  });

  it("reopens a finished item, keeps the completion in the log, and logs the restore", async () => {
    const { addTodo, updateTodo, archiveTodoTree, restoreTodo, listTodos, listTodoEvents } = await import("./todosRepo");
    const todo = addTodo("Write plan", null, local(10, 26));
    updateTodo(todo.id, { done: true }, local(10, 27));
    archiveTodoTree(todo.id, "removed", 0, local(10, 28));

    restoreTodo(todo.id, local(10, 29));

    expect(listTodos()[0]).toMatchObject({ status: "todo" });
    expect(listTodos()[0].doneAt).toBeUndefined();
    expect(listTodoEvents().map(({ kind, on, fromStatus, toStatus }) => [kind, on, fromStatus, toStatus])).toEqual([
      ["created", "2026-10-26", undefined, undefined],
      ["status_changed", "2026-10-27", "todo", "done"],
      ["archived", "2026-10-28", undefined, undefined],
      ["status_changed", "2026-10-29", "done", "todo"],
      ["restored", "2026-10-29", undefined, undefined],
    ]);
  });

  it("puts an item at the top level when its parent is still archived", async () => {
    const { addTodo, archiveTodoTree, restoreTodo, listTodos, listArchivedTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    archiveTodoTree(parent.id, "removed", 0, local(10, 28));

    const result = restoreTodo(child.id, local(10, 29));

    expect(result).toEqual({ toTopLevel: true });
    expect(listTodos().map((t) => [t.id, t.parentId])).toEqual([[child.id, null]]);
    expect(listArchivedTodos().map((t) => t.id)).toEqual([parent.id]);
  });

  it("keeps an item under its parent when the parent is not archived", async () => {
    const { addTodo, archiveTodoTree, restoreTodo, listTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    archiveTodoTree(child.id, "dropped", 0, local(10, 28));

    expect(restoreTodo(child.id, local(10, 29))).toEqual({ toTopLevel: false });
    expect(listTodos().map((t) => [t.id, t.parentId])).toEqual([[parent.id, null], [child.id, parent.id]]);
  });

  it("leaves archived what was archived in an earlier action", async () => {
    const { addTodo, archiveTodoTree, restoreTodo, listTodos, listArchivedTodos } = await import("./todosRepo");
    const parent = addTodo("Plan trip", null, local(10, 26));
    const child = addTodo("Book flights", parent.id, local(10, 26));
    archiveTodoTree(child.id, "dropped", 0, local(10, 27));
    archiveTodoTree(parent.id, "removed", 0, local(10, 28));

    restoreTodo(parent.id, local(10, 29));

    expect(listTodos().map((t) => t.id)).toEqual([parent.id]);
    expect(listArchivedTodos().map((t) => t.id)).toEqual([child.id]);
  });

  it("does nothing for an item that is not archived, or not there", async () => {
    const { addTodo, restoreTodo, listTodoEvents } = await import("./todosRepo");
    const live = addTodo("Plan trip", null, local(10, 26));

    expect(restoreTodo(live.id, local(10, 29))).toBeNull();
    expect(restoreTodo(99, local(10, 29))).toBeNull();
    expect(listTodoEvents().map((e) => e.kind)).toEqual(["created"]);
  });
});

describe("the activity log", () => {
  it("records an item being made, with the local date it happened on and the zone's offset", async () => {
    const { addTodo, listTodoEvents } = await import("./todosRepo");

    // 9:30 pm on the 27th in New York is already the 28th in UTC; the log must keep the 27th.
    const todo = addTodo("Write plan", null, local(10, 27, 21, 30));

    expect(listTodoEvents()).toEqual([
      { todoId: todo.id, kind: "created", at: "2026-10-28T01:30:00.000Z", on: "2026-10-27", utcOffset: -240 },
    ]);
    expect(todo.createdAt).toBe("2026-10-28T01:30:00.000Z");
  });

  it("records a rename", async () => {
    const { addTodo, updateTodo, listTodoEvents } = await import("./todosRepo");
    const todo = addTodo("Write plan", null, local(10, 26));

    updateTodo(todo.id, { title: "Write the Q4 plan" }, local(10, 28));

    expect(listTodoEvents().map(({ kind, on }) => [kind, on])).toEqual([
      ["created", "2026-10-26"],
      ["renamed", "2026-10-28"],
    ]);
  });

  it("records a move between statuses, with where the item was and where it went", async () => {
    const { addTodo, updateTodo, listTodoEvents } = await import("./todosRepo");
    const todo = addTodo("Write plan", null, local(10, 26));

    updateTodo(todo.id, { status: "in_progress" }, local(10, 27));

    expect(listTodoEvents()[1]).toMatchObject({ kind: "status_changed", on: "2026-10-27", fromStatus: "todo", toStatus: "in_progress" });
  });

  it("records ticking as a move to done and keeps when it was done, and unticking clears that", async () => {
    const { addTodo, updateTodo, listTodoEvents } = await import("./todosRepo");
    const todo = addTodo("Write plan", null, local(10, 26));

    const ticked = updateTodo(todo.id, { done: true }, local(10, 29, 21, 15));
    expect(ticked).toMatchObject({ status: "done", doneAt: "2026-10-30T01:15:00.000Z" });

    const unticked = updateTodo(todo.id, { done: false }, local(10, 30));
    expect(unticked?.status).toBe("todo");
    expect(unticked?.doneAt).toBeUndefined();

    expect(listTodoEvents().slice(1).map(({ kind, on, fromStatus, toStatus }) => [kind, on, fromStatus, toStatus])).toEqual([
      ["status_changed", "2026-10-29", "todo", "done"],
      ["status_changed", "2026-10-30", "done", "todo"],
    ]);
  });

  it("records nothing for a change that changes nothing", async () => {
    const { addTodo, updateTodo, listTodoEvents } = await import("./todosRepo");
    const todo = addTodo("Write plan", null, local(10, 26));

    updateTodo(todo.id, { title: "Write plan", status: "todo" }, local(10, 27));

    expect(listTodoEvents().map((e) => e.kind)).toEqual(["created"]);
  });
});
