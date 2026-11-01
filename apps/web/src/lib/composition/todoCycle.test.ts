import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The weekly cycle end to end on a real temporary database: the first run, closing weeks (several at once after a break),
 * the plugin being off, and the once-a-day purge. The clock is passed in and the time zone pinned to New York. Weeks
 * here run Sunday to Saturday unless a test says otherwise; 25 October 2026 is a Sunday.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todo-cycle-"));
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

const local = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour, 0);

async function load() {
  const cycle = await import("./todoCycle");
  const repo = await import("./todosRepo");
  const settings = await import("./webSettings");
  const setSettings = (change: Partial<import("./webSettings").WebSettings>) =>
    settings.saveWebSettings({ ...settings.loadWebSettings(), ...change });
  return { cycle, repo, setSettings, settings };
}

/** Items as an older version left them: a done one, with no log and no completion date, only when it was last changed. */
async function legacyDoneItem(title: string, updatedAt: string) {
  const { getDb } = await import("./db");
  const info = getDb()
    .prepare("INSERT INTO todos (title, done, status, created_at, updated_at) VALUES (?, 1, 'done', '2026-09-01T16:00:00.000Z', ?)")
    .run(title, updatedAt);
  return Number(info.lastInsertRowid);
}

describe("a first run", () => {
  it("starts the cycle from the week that has just closed, touching no item", async () => {
    const { cycle, repo } = await load();
    const open = repo.addTodo("Write Q4 plan", null, local(10, 20));

    const result = cycle.runCycle(local(10, 28)); // a Wednesday

    expect(result).toEqual({ awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] });
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-24");
    expect(repo.listTodos().find((t) => t.id === open.id)?.rolledFromWeek).toBeUndefined();
  });

  it("waits to be asked, changing nothing, while there are completed items to offer to archive", async () => {
    const { cycle, repo } = await load();
    await legacyDoneItem("Reply to vendor", "2026-10-08T15:30:00.000Z");

    const result = cycle.runCycle(local(10, 28));

    expect(result).toEqual({ awaitingSetup: true, closedWeeks: 0, purged: 0, reportNotes: [] });
    expect(repo.lastClosedWeekEnd()).toBeNull();
    expect(repo.listTodos()).toHaveLength(1);
  });

  it("says how many completed items it would offer to archive, and only until it has started", async () => {
    const { cycle } = await load();
    await legacyDoneItem("Reply to vendor", "2026-10-08T15:30:00.000Z");
    await legacyDoneItem("Send invoice", "2026-10-09T15:30:00.000Z");

    expect(cycle.loadSetup(local(10, 28))).toEqual({ pending: true, completed: 2 });

    cycle.finishSetup(false, local(10, 28));

    expect(cycle.loadSetup(local(10, 29))).toEqual({ pending: false, completed: 0 });
  });

  it("with a yes, archives the completed items backdated, then carries on from the week that has just closed", async () => {
    const { cycle, repo } = await load();
    const reply = await legacyDoneItem("Reply to vendor", "2026-10-08T15:30:00.000Z");

    expect(cycle.finishSetup(true, local(10, 28))).toBe(1);

    expect(repo.listTodos()).toEqual([]);
    expect(repo.listArchivedTodos()).toEqual([
      expect.objectContaining({ id: reply, archiveReason: "done", archiveWeek: "2026-10-04", doneAt: "2026-10-08T15:30:00.000Z" }),
    ]);
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-24");
    expect(cycle.runCycle(local(10, 29))).toEqual({ awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] });
  });

  it("with a no, archives nothing now; they go at the first close, with no date, so no report counts them", async () => {
    const { cycle, repo } = await load();
    const reply = await legacyDoneItem("Reply to vendor", "2026-10-08T15:30:00.000Z");

    expect(cycle.finishSetup(false, local(10, 28))).toBe(0);
    expect(repo.listTodos().map((t) => t.id)).toEqual([reply]);

    expect(cycle.runCycle(local(11, 2)).closedWeeks).toBe(1);

    const [archived] = repo.listArchivedTodos();
    expect(archived).toMatchObject({ id: reply, archiveReason: "done", archiveWeek: "2026-10-25" });
    expect(archived.doneAt).toBeUndefined();
    expect(repo.listTodoEvents().filter((e) => e.todoId === reply && e.kind === "status_changed")).toEqual([]);
  });

  it("does nothing when it is told again after it has started, as when two windows both answer", async () => {
    const { cycle, repo } = await load();
    await legacyDoneItem("Reply to vendor", "2026-10-08T15:30:00.000Z");
    cycle.finishSetup(false, local(10, 28));
    await legacyDoneItem("Send invoice", "2026-10-09T15:30:00.000Z");

    expect(cycle.finishSetup(true, local(10, 29))).toBe(0);

    expect(repo.listArchivedTodos()).toEqual([]);
  });
});

describe("closing weeks", () => {
  it("archives what was done and rolls what was open when a week has ended, filed under that week", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 28));
    const done = repo.addTodo("Reply to vendor", null, local(10, 26));
    repo.updateTodo(done.id, { done: true }, local(10, 27));
    const open = repo.addTodo("Write Q4 plan", null, local(10, 26));
    const backlog = repo.addTodo("Someday", null, local(10, 26));
    repo.updateTodo(backlog.id, { status: "backlog" }, local(10, 26));

    const result = cycle.runCycle(local(11, 2));

    expect(result).toEqual({ awaitingSetup: false, closedWeeks: 1, purged: 0, reportNotes: expect.any(Array) });
    expect(repo.listArchivedTodos()).toEqual([expect.objectContaining({ id: done.id, archiveReason: "done", archiveWeek: "2026-10-25" })]);
    expect(repo.listTodos().find((t) => t.id === open.id)).toMatchObject({ rolledFromWeek: "2026-10-25", rollCount: 1 });
    expect(repo.listTodos().find((t) => t.id === backlog.id)?.rolledFromWeek).toBeUndefined();
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
  });

  it("closes every week missed, oldest first, so an item keeps the week it first rolled from", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 14)); // closed through Saturday 10 October
    const open = repo.addTodo("Write Q4 plan", null, local(10, 12));
    const doneInSecond = repo.addTodo("Reply to vendor", null, local(10, 12));
    repo.updateTodo(doneInSecond.id, { done: true }, local(10, 20));

    const result = cycle.runCycle(local(11, 4)); // three weeks have ended: from the 11th, the 18th and the 25th

    expect(result.closedWeeks).toBe(3);
    expect(repo.listTodos().find((t) => t.id === open.id)).toMatchObject({ rolledFromWeek: "2026-10-11", rollCount: 3 });
    expect(repo.listArchivedTodos()).toEqual([expect.objectContaining({ id: doneInSecond.id, archiveWeek: "2026-10-18" })]);
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
  });

  it("does nothing the second time on the same day", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 28));
    repo.addTodo("Write Q4 plan", null, local(10, 26));
    cycle.runCycle(local(11, 2));
    const events = repo.listTodoEvents().length;

    expect(cycle.runCycle(local(11, 2, 18))).toEqual({ awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] });

    expect(repo.listTodoEvents()).toHaveLength(events);
    expect(repo.listTodos()[0].rollCount).toBe(1);
  });

  it("closes a week only once its last day is over", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 28));

    expect(cycle.runCycle(local(10, 31, 23)).closedWeeks).toBe(0); // Saturday evening: the week is still on
    expect(cycle.runCycle(local(11, 1, 0)).closedWeeks).toBe(1); // just after midnight
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
  });

  it("follows the day weeks start on", async () => {
    const { cycle, repo, setSettings } = await load();
    setSettings({ todos: { weekStartsOn: 1, retentionMonths: 60, fiscalYearStartMonth: 1 } });
    cycle.runCycle(local(10, 28)); // the Monday week of the 19th to the 25th has just closed
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-25");

    expect(cycle.runCycle(local(11, 1)).closedWeeks).toBe(0); // the week of the 26th ends today
    expect(cycle.runCycle(local(11, 2)).closedWeeks).toBe(1);
    expect(repo.lastClosedWeekEnd()).toBe("2026-11-01");
  });
});

describe("while the To-do plugin is off", () => {
  it("does nothing, and catches up week by week when it is turned back on", async () => {
    const { cycle, repo, setSettings } = await load();
    cycle.runCycle(local(10, 14));
    const open = repo.addTodo("Write Q4 plan", null, local(10, 12));
    setSettings({ plugins: { todo: false } });

    expect(cycle.runCycle(local(11, 4))).toEqual({ awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] });
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-10");

    setSettings({ plugins: { todo: true } });
    expect(cycle.runCycle(local(11, 4)).closedWeeks).toBe(3);
    expect(repo.listTodos().find((t) => t.id === open.id)).toMatchObject({ rolledFromWeek: "2026-10-11", rollCount: 3 });
  });

  it("does not even start the cycle on a first run", async () => {
    const { cycle, repo, setSettings } = await load();
    setSettings({ plugins: { todo: false } });

    cycle.runCycle(local(10, 28));

    expect(repo.lastClosedWeekEnd()).toBeNull();
  });
});

describe("purging what has outlived the retention window", () => {
  /** An item removed years ago. */
  async function oldRemoved(title: string) {
    const { repo } = await load();
    const item = repo.addTodo(title, null, new Date(2020, 0, 15));
    repo.archiveTodoTree(item.id, "removed", 0, new Date(2020, 0, 15));
    return item;
  }

  it("deletes expired archived items at the first run of the day and not again until the next day", async () => {
    const { cycle, repo, setSettings } = await load();
    setSettings({ todos: { weekStartsOn: 0, retentionMonths: 12, fiscalYearStartMonth: 1 } });
    await oldRemoved("First");

    // A first run purges as well: expired archived items are not waiting on anything.
    expect(cycle.runCycle(local(10, 28, 9)).purged).toBe(1);
    expect(repo.listArchivedTodos()).toEqual([]);

    await oldRemoved("Second");
    expect(cycle.runCycle(local(10, 28, 17)).purged).toBe(0);
    expect(repo.listArchivedTodos()).toHaveLength(1);

    expect(cycle.runCycle(local(10, 29, 9)).purged).toBe(1);
    expect(repo.listArchivedTodos()).toEqual([]);
  });

  it("never deletes while archived items are kept forever", async () => {
    const { cycle, repo, setSettings } = await load();
    setSettings({ todos: { weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 } });
    await oldRemoved("First");

    expect(cycle.runCycle(local(10, 28)).purged).toBe(0);
    expect(repo.listArchivedTodos()).toHaveLength(1);
  });

  it("keeps an archived item inside the window", async () => {
    const { cycle, repo } = await load();
    const item = repo.addTodo("Recent", null, local(10, 1));
    repo.archiveTodoTree(item.id, "removed", 0, local(10, 2));

    expect(cycle.runCycle(local(10, 28)).purged).toBe(0); // the default window is 5 years
    expect(repo.listArchivedTodos()).toHaveLength(1);
  });
});

describe("the reports the cycle makes", () => {
  /** What the reports notebook holds, read back the way the notes screen would. */
  async function notebook() {
    const notebooks = await import("./notebooksRepo");
    const groups = await import("./groupsRepo");
    const notes = await import("./notesRepo");
    const book = notebooks.listNotebooks().find((n) => n.name === "To-do reports");
    const inBook = groups.listGroups().filter((g) => g.notebookId === book?.id);
    return { book, groups: inBook, notes: notes.listNotes().filter((n) => n.notebookId === book?.id), notesRepo: notes };
  }

  /** Items made and finished on the given days (month, day), in a New York week. */
  async function work(repo: typeof import("./todosRepo"), title: string, made: [number, number], done?: [number, number]) {
    const item = repo.addTodo(title, null, local(made[0], made[1], 9));
    if (done) repo.updateTodo(item.id, { done: true }, local(done[0], done[1], 15));
    return item;
  }

  it("makes a weekly report for a week that had something in it: a note in the To-do reports notebook, in its Weekly group", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 14)); // closed through Saturday 10 October
    await work(repo, "Reply to vendor", [10, 12], [10, 13]);

    const result = cycle.runCycle(local(10, 19)); // the week of 11 to 17 October has ended; the month has not

    expect(result.reportNotes).toHaveLength(1);
    const { book, groups, notes } = await notebook();
    expect(book).toBeDefined();
    expect(groups.map((g) => g.name).sort()).toEqual(["Monthly", "Quarterly", "Weekly"]);
    const [note] = notes;
    expect(note.id).toBe(result.reportNotes[0]);
    expect(note.title).toBe("Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-19 12:00");
    expect(note.groupId).toBe(groups.find((g) => g.name === "Weekly")!.id);
    expect(note.content).toContain("Reply to vendor");
    expect(note.content).toMatch(/^---\n/);
    expect(note.tags).toBe("todo-report,weekly");
  });

  it("makes none for a week in which nothing happened, and does not make the notebook for it", async () => {
    const { cycle } = await load();
    cycle.runCycle(local(10, 28));

    expect(cycle.runCycle(local(11, 2)).reportNotes).toEqual([]);

    expect((await notebook()).book).toBeUndefined();
  });

  it("makes the monthly and quarterly reports when a month and a quarter have ended, after the weekly one", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(9, 20)); // closed through Saturday 19 September
    await work(repo, "Reply to vendor", [9, 21], [9, 22]);

    const result = cycle.runCycle(local(10, 2)); // the week of the 20th has ended; September and the third quarter have too

    const { notes } = await notebook();
    expect(result.reportNotes).toHaveLength(3);
    expect(result.reportNotes.map((id) => notes.find((n) => n.id === id)!.title)).toEqual([
      "Weekly 2026-09-20 → 2026-09-26 · generated 2026-10-02 12:00",
      "Monthly 2026-09 · generated 2026-10-02 12:00",
      "Quarterly 2026 Q3 · generated 2026-10-02 12:00",
    ]);
    expect(notes.find((n) => n.title.startsWith("Monthly"))!.content).toContain("Reply to vendor");
  });

  it("closes a month that ends in the middle of a week, counting what was done in the week that is still open", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(11, 3)); // closed through Saturday 31 October, and the month of October
    await work(repo, "Ship it", [11, 24], [11, 30]); // done on Monday 30 November, in the week of the 29th

    const result = cycle.runCycle(local(12, 1, 9)); // November has ended; the week of 29 November to 5 December has not

    const { notes } = await notebook();
    const titles = result.reportNotes.map((id) => notes.find((n) => n.id === id)!.title.split(" · ")[0]);
    expect(titles).toEqual(["Weekly 2026-11-22 → 2026-11-28", "Monthly 2026-11"]);
    const monthly = notes.find((n) => n.title.startsWith("Monthly 2026-11"))!;
    expect(monthly.content).toContain("Ship it");
    expect(monthly.content).toMatch(/partial week/i);
  });

  it("carries what was written under My notes in a weekly report up into the month", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 14));
    await work(repo, "Reply to vendor", [10, 12], [10, 13]);
    cycle.runCycle(local(10, 19)); // the week of 11 to 17 October closes, and is reported
    const { notes, notesRepo } = await notebook();
    const weekly = notes.find((n) => n.title.startsWith("Weekly 2026-10-11"))!;
    notesRepo.updateNoteContent(weekly.id, weekly.content.replace(/## My notes\s*$/m, "## My notes\n\nShipped the migration to the new database."));

    cycle.runCycle(local(11, 2)); // October ends

    const monthly = (await notebook()).notes.find((n) => n.title.startsWith("Monthly 2026-10"))!;
    expect(monthly.content).toContain("Shipped the migration to the new database.");
  });

  it("does not make a report again that the owner deleted", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 28));
    await work(repo, "Reply to vendor", [10, 26], [10, 27]);
    cycle.runCycle(local(11, 2));
    const { getDb } = await import("./db");
    getDb().prepare("DELETE FROM notes WHERE title LIKE 'Weekly %'").run();

    expect(cycle.runCycle(local(11, 2, 18)).reportNotes).toEqual([]);
    expect(cycle.runCycle(local(11, 3)).reportNotes).toEqual([]);

    expect((await notebook()).notes.filter((n) => n.title.startsWith("Weekly"))).toEqual([]);
  });

  it("makes the notebook and its groups again when the owner has deleted them, and keeps using them when only renamed", async () => {
    const { cycle, repo } = await load();
    cycle.runCycle(local(10, 28));
    await work(repo, "Reply to vendor", [10, 26], [10, 27]);
    cycle.runCycle(local(11, 2));
    const first = await notebook();
    const { getDb } = await import("./db");
    const notebooks = await import("./notebooksRepo");
    notebooks.renameNotebook(first.book!.id, "My reports");
    await work(repo, "Send invoice", [11, 3], [11, 4]);
    cycle.runCycle(local(11, 9));
    expect(notebooks.listNotebooks().filter((n) => n.name === "To-do reports")).toEqual([]);
    expect(notebooks.getNotebook(first.book!.id)!.name).toBe("My reports");

    // Everything of it deleted, as the owner could after emptying the notebook.
    const db = getDb();
    db.prepare("DELETE FROM notes WHERE notebook_id = ?").run(first.book!.id);
    db.prepare("DELETE FROM groups WHERE notebook_id = ?").run(first.book!.id);
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(first.book!.id);
    await work(repo, "Pay the bill", [11, 10], [11, 11]);
    cycle.runCycle(local(11, 16));

    const again = await notebook();
    expect(again.book).toBeDefined();
    expect(again.book!.id).not.toBe(first.book!.id);
    expect(again.groups.map((g) => g.name).sort()).toEqual(["Monthly", "Quarterly", "Weekly"]);
    expect(again.notes).toHaveLength(1);
  });

  it("makes no report for what happened before the cycle began, on a first run", async () => {
    const { cycle, repo } = await load();
    await work(repo, "Reply to vendor", [10, 12]); // open, so no question is asked

    expect(cycle.runCycle(local(11, 2)).reportNotes).toEqual([]);

    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");
    expect(repo.lastClosedPeriodEnd("month")).toBe("2026-10-31");
    expect(repo.lastClosedPeriodEnd("quarter")).toBe("2026-09-30");
    expect(cycle.runCycle(local(11, 3)).reportNotes).toEqual([]);
  });

  it("starts the month and quarter markers, with no backfill, for a database whose weeks were already being closed", async () => {
    const { cycle, repo } = await load();
    repo.markWeekClosed({ start: "2026-10-18", end: "2026-10-24" }, local(10, 25));
    await work(repo, "Reply to vendor", [10, 20], [10, 21]);

    cycle.runCycle(local(10, 26));

    expect(repo.lastClosedPeriodEnd("month")).toBe("2026-09-30");
    expect((await notebook()).notes).toEqual([]);
  });

  it("makes the weekly reports of every week that had something in it after a break, oldest first, and none for the quiet one", async () => {
    const { cycle, repo, setSettings } = await load();
    cycle.runCycle(local(10, 14));
    setSettings({ plugins: { todo: false } });
    await work(repo, "First", [10, 12], [10, 13]); // the week of the 11th
    await work(repo, "Third", [10, 27], [10, 28]); // the week of the 25th; the week of the 18th is quiet
    expect(cycle.runCycle(local(11, 4)).reportNotes).toEqual([]);

    setSettings({ plugins: { todo: true } });
    const result = cycle.runCycle(local(11, 4));

    const { notes } = await notebook();
    const weekly = result.reportNotes.map((id) => notes.find((n) => n.id === id)!.title.split(" · ")[0]).filter((t) => t.startsWith("Weekly"));
    expect(weekly).toEqual(["Weekly 2026-10-11 → 2026-10-17", "Weekly 2026-10-25 → 2026-10-31"]);
  });

  it("makes no monthly or quarterly report for a month or quarter in which nothing happened", async () => {
    const { cycle } = await load();
    cycle.runCycle(local(1, 14));

    const result = cycle.runCycle(local(10, 14));

    expect(result.reportNotes).toEqual([]);
    expect((await notebook()).book).toBeUndefined();
  });

  it("makes nothing while the To-do plugin is off", async () => {
    const { cycle, repo, setSettings } = await load();
    cycle.runCycle(local(10, 28));
    await work(repo, "Reply to vendor", [10, 26], [10, 27]);
    setSettings({ plugins: { todo: false } });

    expect(cycle.runCycle(local(11, 2)).reportNotes).toEqual([]);
    expect((await notebook()).book).toBeUndefined();
  });
});
