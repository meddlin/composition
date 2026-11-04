import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  searchIsDisabled: () => false,
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todos-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  vi.useRealTimers();
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("the to-do service", () => {
  it("starts with no items", async () => {
    const { listTodos } = await import("./todosService");

    expect(await listTodos()).toEqual([]);
  });

  it("adds items and sub-items, and lists them oldest first", async () => {
    const { createTodo, listTodos } = await import("./todosService");

    const trip = await createTodo("  Plan  trip ", null);
    const flights = await createTodo("Book flights", trip.id);
    await createTodo("Pack", null);

    expect(trip).toMatchObject({ title: "Plan trip", parentId: null, done: false });
    expect((await listTodos()).map((t) => [t.title, t.parentId])).toEqual([
      ["Plan trip", null],
      ["Book flights", trip.id],
      ["Pack", null],
    ]);
    expect(flights.parentId).toBe(trip.id);
  });

  it("refuses an empty title, and a parent that is not there", async () => {
    const { createTodo, renameTodo } = await import("./todosService");
    const item = await createTodo("a", null);

    await expect(createTodo("   ", null)).rejects.toThrow(/title/);
    await expect(createTodo("x", 999)).rejects.toThrow(/no longer exists/);
    await expect(renameTodo(item.id, "")).rejects.toThrow(/title/);
    await expect(renameTodo(999, "x")).rejects.toThrow(/no longer exists/);
  });

  it("renames an item", async () => {
    const { createTodo, renameTodo, listTodos } = await import("./todosService");
    const item = await createTodo("Buy milk", null);

    expect((await renameTodo(item.id, "Buy oat milk")).title).toBe("Buy oat milk");
    expect((await listTodos())[0].title).toBe("Buy oat milk");
  });

  it("marks an item done and not done, leaving its sub-items alone", async () => {
    const { createTodo, setTodoDone, listTodos } = await import("./todosService");
    const parent = await createTodo("Plan trip", null);
    await createTodo("Book flights", parent.id);

    expect((await setTodoDone(parent.id, true)).done).toBe(true);
    expect((await listTodos()).map((t) => t.done)).toEqual([true, false]);

    expect((await setTodoDone(parent.id, false)).done).toBe(false);
    await expect(setTodoDone(999, true)).rejects.toThrow(/no longer exists/);
  });

  it("starts an item at to-do, and moves it between statuses", async () => {
    const { createTodo, setTodoStatus, setTodoDone, listTodos } = await import("./todosService");
    const item = await createTodo("Buy milk", null);
    expect(item).toMatchObject({ status: "todo", done: false });

    expect(await setTodoStatus(item.id, "backlog")).toMatchObject({ status: "backlog", done: false });
    expect(await setTodoStatus(item.id, "in_progress")).toMatchObject({ status: "in_progress", done: false });
    expect(await setTodoStatus(item.id, "done")).toMatchObject({ status: "done", done: true });
    // Unticking a done item puts it back to "todo"; ticking and unticking one that is in progress keeps nothing of it.
    expect(await setTodoDone(item.id, false)).toMatchObject({ status: "todo", done: false });
    expect(await setTodoDone(item.id, true)).toMatchObject({ status: "done", done: true });
    expect((await listTodos())[0]).toMatchObject({ status: "done", done: true });
  });

  it("refuses a status that is not one, and an item that is not there", async () => {
    const { createTodo, setTodoStatus } = await import("./todosService");
    const item = await createTodo("a", null);

    await expect(setTodoStatus(item.id, "later" as never)).rejects.toThrow(/not a to-do status/);
    await expect(setTodoStatus(999, "done")).rejects.toThrow(/no longer exists/);
  });

  it("keeps a status that was set, through a rename", async () => {
    const { createTodo, setTodoStatus, renameTodo } = await import("./todosService");
    const item = await createTodo("a", null);
    await setTodoStatus(item.id, "in_progress");

    expect(await renameTodo(item.id, "b")).toMatchObject({ title: "b", status: "in_progress" });
  });

  it("reads items from a database that had no statuses: ticked ones are done, the rest to-do", async () => {
    const { default: Database } = await import("better-sqlite3");
    const { resolvedDbPath, loadWebSettings } = await import("./webSettings");
    const dbPath = resolvedDbPath(loadWebSettings());
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const old = new Database(dbPath);
    old.exec(`CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO todos (title, done, created_at, updated_at) VALUES ('open', 0, '', ''), ('closed', 1, '', '')").run();
    old.close();

    const { listTodos } = await import("./todosService");

    expect((await listTodos()).map((t) => [t.title, t.status, t.done])).toEqual([
      ["open", "todo", false],
      ["closed", "done", true],
    ]);
  });

  it("deletes an item with everything under it, and nothing else", async () => {
    const { createTodo, deleteTodo, listTodos } = await import("./todosService");
    const a = await createTodo("a", null);
    const b = await createTodo("b", a.id);
    await createTodo("c", b.id);
    const d = await createTodo("d", null);

    await deleteTodo(a.id);

    expect((await listTodos()).map((t) => t.id)).toEqual([d.id]);
    await expect(deleteTodo(a.id)).resolves.toBeUndefined();
  });

  it("starts with the notes' background, and keeps the look it is given between runs", async () => {
    const first = await import("./todosService");
    expect(await first.loadTodoLook()).toEqual({ background: "notes", color: null });

    await first.saveTodoLook({ background: "dots", color: "#14202b" });
    const { closeDb } = await import("./db");
    closeDb();
    vi.resetModules();

    const { loadTodoLook } = await import("./todosService");
    expect(await loadTodoLook()).toEqual({ background: "dots", color: "#14202b" });
  });

  it("refuses a look that is not one, and saves the look without disturbing the other settings", async () => {
    const { saveTodoLook, loadTodoLook } = await import("./todosService");
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "forest" });

    await expect(saveTodoLook({ background: "paisley", color: null } as never)).rejects.toThrow(/not a to-do background/);
    await expect(saveTodoLook({ background: "grid", color: "red" } as never)).rejects.toThrow(/not a to-do background/);
    await saveTodoLook({ background: "grid", color: null });

    expect(await loadTodoLook()).toEqual({ background: "grid", color: null });
    expect(loadWebSettings().theme).toBe("forest");
  });

  it("starts with the default cycle settings, and keeps the ones it is given between runs", async () => {
    const first = await import("./todosService");
    expect(await first.loadTodoSettings()).toEqual({ weekStartsOn: 0, retentionMonths: 60, fiscalYearStartMonth: 1 });

    await first.saveTodoSettings({ weekStartsOn: 1, retentionMonths: null, fiscalYearStartMonth: 10 });
    const { closeDb } = await import("./db");
    closeDb();
    vi.resetModules();

    const { loadTodoSettings } = await import("./todosService");
    expect(await loadTodoSettings()).toEqual({ weekStartsOn: 1, retentionMonths: null, fiscalYearStartMonth: 10 });
  });

  it("refuses cycle settings that are not valid, saving nothing, and saves valid ones without disturbing the other settings", async () => {
    const { saveTodoSettings, loadTodoSettings, saveTodoLook } = await import("./todosService");
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "forest" });
    await saveTodoLook({ background: "grid", color: null });
    const good = { weekStartsOn: 2, retentionMonths: 24, fiscalYearStartMonth: 4 } as const;
    await saveTodoSettings(good);

    await expect(saveTodoSettings({ ...good, weekStartsOn: 9 } as never)).rejects.toThrow(/day the week starts on/);
    await expect(saveTodoSettings({ ...good, retentionMonths: 0 } as never)).rejects.toThrow(/months from 1 to 600/);
    await expect(saveTodoSettings({ ...good, fiscalYearStartMonth: 13 } as never)).rejects.toThrow(/fiscal year starts in/);
    await expect(saveTodoSettings("nonsense" as never)).rejects.toThrow();

    expect(await loadTodoSettings()).toEqual(good);
    expect(loadWebSettings()).toMatchObject({ theme: "forest", todoLook: { background: "grid", color: null } });
  });

  it("counts the archived items a shorter window would delete, without deleting any", async () => {
    const { createTodo, previewTodoPurge } = await import("./todosService");
    const repo = await import("./todosRepo");
    const long = new Date(2020, 0, 15);
    const old = repo.addTodo("Old and removed", null, long);
    repo.archiveTodoTree(old.id, "removed", 0, long);
    const recent = repo.addTodo("Removed this week", null);
    repo.archiveTodoTree(recent.id, "removed", 0);
    await createTodo("Still live", null);

    expect(await previewTodoPurge(12)).toBe(1);
    expect(await previewTodoPurge(120)).toBe(0);
    expect(await previewTodoPurge(null)).toBe(0);
    expect(repo.listArchivedTodos().map((t) => t.title).sort()).toEqual(["Old and removed", "Removed this week"]);
  });

  it("refuses to preview a window that is not one", async () => {
    const { previewTodoPurge } = await import("./todosService");

    for (const months of [0, -1, 2.5, 601, "12", undefined]) {
      await expect(previewTodoPurge(months as never)).rejects.toThrow(/months from 1 to 600/);
    }
  });

  it("keeps the items between runs", async () => {
    const first = await import("./todosService");
    await first.createTodo("Remember me", null);
    const { closeDb } = await import("./db");
    closeDb();
    vi.resetModules();

    const { listTodos } = await import("./todosService");

    expect((await listTodos()).map((t) => t.title)).toEqual(["Remember me"]);
  });
});

/** Wednesday 28 October 2026: in the week of Sunday the 25th, or of Monday the 26th when weeks start on Monday. */
const WEDNESDAY = new Date(2026, 9, 28, 12, 0);

function pinTheClock(now: Date = WEDNESDAY) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

describe("the to-do archive", () => {
  it("removes an item with its sub-items to the archive, filed under the week the setting makes", async () => {
    pinTheClock();
    const { createTodo, removeTodo, listTodos, listArchivedTodos, saveTodoSettings, loadTodoSettings } = await import("./todosService");
    const trip = await createTodo("Plan trip", null);
    const flights = await createTodo("Book flights", trip.id);
    const pack = await createTodo("Pack", null);

    await removeTodo(trip.id);

    expect((await listTodos()).map((t) => t.id)).toEqual([pack.id]);
    expect(await listArchivedTodos()).toEqual([
      expect.objectContaining({ id: trip.id, title: "Plan trip", archiveReason: "removed", archiveWeek: "2026-10-25" }),
      expect.objectContaining({ id: flights.id, parentId: trip.id, archiveReason: "removed", archiveWeek: "2026-10-25" }),
    ]);

    await saveTodoSettings({ ...(await loadTodoSettings()), weekStartsOn: 1 });
    await removeTodo(pack.id);
    expect((await listArchivedTodos()).find((t) => t.id === pack.id)).toMatchObject({ archiveWeek: "2026-10-26" });
  });

  it("refuses to remove an item that is gone, and leaves one that is already archived as it is", async () => {
    pinTheClock();
    const { createTodo, removeTodo, listArchivedTodos } = await import("./todosService");
    const item = await createTodo("Once", null);
    await removeTodo(item.id);
    const [archived] = await listArchivedTodos();

    pinTheClock(new Date(2026, 10, 3, 9, 0));
    await expect(removeTodo(item.id)).resolves.toBeUndefined();
    await expect(removeTodo(999)).rejects.toThrow(/no longer exists/);

    expect(await listArchivedTodos()).toEqual([archived]);
  });

  it("restores an item as a to-do, with the sub-items archived with it as they were", async () => {
    pinTheClock();
    const { createTodo, removeTodo, restoreTodo, listTodos, listArchivedTodos, setTodoStatus } = await import("./todosService");
    const trip = await createTodo("Plan trip", null);
    const flights = await createTodo("Book flights", trip.id);
    await setTodoStatus(flights.id, "in_progress");
    await removeTodo(trip.id);

    expect(await restoreTodo(trip.id)).toEqual({ toTopLevel: false });

    expect((await listTodos()).map((t) => [t.id, t.parentId, t.status])).toEqual([
      [trip.id, null, "todo"],
      [flights.id, trip.id, "in_progress"],
    ]);
    expect(await listArchivedTodos()).toEqual([]);
  });

  it("says when a restored item came back at the top level because its parent is still archived", async () => {
    pinTheClock();
    const { createTodo, removeTodo, restoreTodo, listTodos } = await import("./todosService");
    const trip = await createTodo("Plan trip", null);
    const flights = await createTodo("Book flights", trip.id);
    await removeTodo(trip.id);

    expect(await restoreTodo(flights.id)).toEqual({ toTopLevel: true });

    expect((await listTodos()).map((t) => [t.id, t.parentId])).toEqual([[flights.id, null]]);
  });

  it("refuses to restore an item that is not in the archive", async () => {
    const { createTodo, restoreTodo } = await import("./todosService");
    const live = await createTodo("Live", null);

    await expect(restoreTodo(live.id)).rejects.toThrow(/not in the archive/);
    await expect(restoreTodo(999)).rejects.toThrow(/not in the archive/);
  });

  it("drops an item that is waiting in Rolled over, and only such an item", async () => {
    pinTheClock();
    const { createTodo, dropTodo, listTodos, listArchivedTodos } = await import("./todosService");
    const repo = await import("./todosRepo");
    const rolled = await createTodo("Carried", null);
    const placed = await createTodo("Placed", null);
    repo.closeWeek({ week: { start: "2026-10-18", end: "2026-10-24" }, archive: [], roll: [{ id: rolled.id, rolledFromWeek: "2026-10-18", rollCount: 1 }] });

    await expect(dropTodo(placed.id)).rejects.toThrow(/not waiting in Rolled over/);
    await expect(dropTodo(999)).rejects.toThrow(/not waiting in Rolled over/);
    await dropTodo(rolled.id);

    expect((await listTodos()).map((t) => t.id)).toEqual([placed.id]);
    expect(await listArchivedTodos()).toEqual([expect.objectContaining({ id: rolled.id, archiveReason: "dropped", archiveWeek: "2026-10-25" })]);
  });

  it("adds a rolled-over item to this week, keeping how many weeks it has rolled", async () => {
    const { createTodo, acceptRolledTodo, listTodos } = await import("./todosService");
    const repo = await import("./todosRepo");
    const rolled = await createTodo("Carried", null);
    repo.closeWeek({ week: { start: "2026-10-18", end: "2026-10-24" }, archive: [], roll: [{ id: rolled.id, rolledFromWeek: "2026-10-18", rollCount: 2 }] });
    expect((await listTodos())[0]).toMatchObject({ rolledFromWeek: "2026-10-18", rollCount: 2 });

    const accepted = await acceptRolledTodo(rolled.id);

    expect(accepted).toMatchObject({ id: rolled.id, rollCount: 2 });
    expect(accepted.rolledFromWeek).toBeUndefined();
    expect((await listTodos())[0].rolledFromWeek).toBeUndefined();
  });

  it("returns an item that is not in Rolled over unchanged, and refuses one that is gone", async () => {
    const { createTodo, acceptRolledTodo } = await import("./todosService");
    const item = await createTodo("Placed", null);

    expect(await acceptRolledTodo(item.id)).toEqual(item);
    await expect(acceptRolledTodo(999)).rejects.toThrow(/no longer exists/);
  });

  it("moves a rolled-over branch to the backlog, and only a branch that is waiting in Rolled over", async () => {
    pinTheClock();
    const { createTodo, moveRolledTodoToBacklog, listTodos } = await import("./todosService");
    const repo = await import("./todosRepo");
    const parent = await createTodo("Plan trip", null);
    const child = await createTodo("Book flights", parent.id);
    const placed = await createTodo("Placed", null);
    repo.closeWeek({
      week: { start: "2026-10-18", end: "2026-10-24" },
      archive: [],
      roll: [
        { id: parent.id, rolledFromWeek: "2026-10-18", rollCount: 2 },
        { id: child.id, rolledFromWeek: "2026-10-18", rollCount: 2 },
      ],
    });

    await expect(moveRolledTodoToBacklog(placed.id)).rejects.toThrow(/not waiting in Rolled over/);
    await expect(moveRolledTodoToBacklog(999)).rejects.toThrow(/not waiting in Rolled over/);
    const moved = await moveRolledTodoToBacklog(parent.id);

    expect(moved).toMatchObject({ id: parent.id, status: "backlog" });
    expect(moved.rolledFromWeek).toBeUndefined();
    expect((await listTodos()).find((t) => t.id === child.id)).toMatchObject({ status: "todo" });
    expect((await listTodos()).find((t) => t.id === child.id)?.rolledFromWeek).toBeUndefined();
  });

  it("says what deleting an item for good would erase, and which reports mention it", async () => {
    pinTheClock();
    const { createTodo, removeTodo, previewTodoDelete, listArchivedTodos } = await import("./todosService");
    const { getDb } = await import("./db");
    const trip = await createTodo("Plan trip", null);
    const flights = await createTodo("Book flights", trip.id);
    await removeTodo(flights.id);
    const db = getDb();
    const noteId = Number(db.prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES ('Weekly 2026-10-25', '- Book flights', '', '')").run().lastInsertRowid);
    db.prepare("INSERT INTO todo_reports (kind, period_start, period_end, note_id, generated_at) VALUES ('week', '2026-10-25', '2026-10-31', ?, '2026-11-01T14:03:00.000Z')").run(noteId);

    expect(await previewTodoDelete(trip.id)).toEqual({ items: 2, reports: [{ noteId, title: "Weekly 2026-10-25" }] });
    expect(await previewTodoDelete(999)).toEqual({ items: 0, reports: [] });
    expect(await listArchivedTodos()).toHaveLength(1); // looking deletes nothing
  });

  it("deletes an archived item for good, with its sub-items and its history", async () => {
    pinTheClock();
    const { createTodo, removeTodo, deleteTodo, listArchivedTodos } = await import("./todosService");
    const repo = await import("./todosRepo");
    const trip = await createTodo("Plan trip", null);
    const flights = await createTodo("Book flights", trip.id);
    await removeTodo(trip.id);
    expect(repo.listTodoEvents().some((e) => e.todoId === flights.id)).toBe(true);

    await deleteTodo(trip.id);

    expect(await listArchivedTodos()).toEqual([]);
    expect(repo.listTodoEvents()).toEqual([]);
  });
});

describe("the reports", () => {
  it("lists none, and no closed period to make one for, on a database that has not begun", async () => {
    const { loadTodoReports } = await import("./todosService");

    expect(await loadTodoReports()).toEqual({ reports: [], missing: [] });
  });

  it("makes a report for a closed period by hand, as a note that the search is told about, and lists it", async () => {
    pinTheClock();
    const { generateTodoReport, loadTodoReports } = await import("./todosService");
    const repo = await import("./todosRepo");
    const index = await import("./searchIndex");
    repo.markWeekClosed({ start: "2026-10-18", end: "2026-10-24" });
    expect((await loadTodoReports()).missing).toEqual([{ kind: "weekly", periodStart: "2026-10-18", periodEnd: "2026-10-24", label: "2026-10-18 → 2026-10-24" }]);

    const made = await generateTodoReport("weekly", "2026-10-18");

    expect(made).toMatchObject({ kind: "weekly", periodStart: "2026-10-18", title: expect.stringMatching(/^Weekly 2026-10-18 → 2026-10-24 · generated /) });
    expect(index.indexNote).toHaveBeenCalledWith(expect.objectContaining({ id: made.noteId }));
    expect(await loadTodoReports()).toEqual({ reports: [made], missing: [] });
  });

  it("refuses a kind or a date that is not one, and a period that has not closed", async () => {
    const { generateTodoReport } = await import("./todosService");

    await expect(generateTodoReport("yearly" as never, "2026-10-18")).rejects.toThrow(/kind of report/);
    await expect(generateTodoReport("weekly", "last week")).rejects.toThrow(/date/);
    await expect(generateTodoReport("weekly", "2026-02-30")).rejects.toThrow(/date/);
    await expect(generateTodoReport("weekly", "2026-10-18")).rejects.toThrow(/not closed/);
  });
});

describe("the first-run question", () => {
  async function legacyDone(title: string, updatedAt: string) {
    const { getDb } = await import("./db");
    getDb()
      .prepare("INSERT INTO todos (title, done, status, created_at, updated_at) VALUES (?, 1, 'done', '2026-09-01T16:00:00.000Z', ?)")
      .run(title, updatedAt);
  }

  it("says there is a question while completed items are waiting, and archives them backdated on a yes", async () => {
    pinTheClock();
    const { loadTodoSetup, finishTodoSetup, listTodos, listArchivedTodos } = await import("./todosService");
    await legacyDone("Reply to vendor", "2026-10-08T15:30:00.000Z");
    await legacyDone("Send invoice", "2026-10-09T15:30:00.000Z");

    expect(await loadTodoSetup()).toEqual({ pending: true, completed: 2 });

    await finishTodoSetup(true);

    expect(await loadTodoSetup()).toEqual({ pending: false, completed: 0 });
    expect(await listTodos()).toEqual([]);
    expect(await listArchivedTodos()).toEqual([
      expect.objectContaining({ title: "Reply to vendor", archiveWeek: "2026-10-04" }),
      expect.objectContaining({ title: "Send invoice", archiveWeek: "2026-10-04" }),
    ]);
  });

  it("leaves the completed items alone on a no, and does not ask again", async () => {
    pinTheClock();
    const { loadTodoSetup, finishTodoSetup, listTodos } = await import("./todosService");
    await legacyDone("Reply to vendor", "2026-10-08T15:30:00.000Z");

    await finishTodoSetup(false);

    expect(await loadTodoSetup()).toEqual({ pending: false, completed: 0 });
    expect(await listTodos()).toHaveLength(1);
  });

  it("refuses an answer that is not a yes or a no", async () => {
    const { finishTodoSetup } = await import("./todosService");

    await expect(finishTodoSetup("yes" as never)).rejects.toThrow(/yes or no/);
    await expect(finishTodoSetup(undefined as never)).rejects.toThrow(/yes or no/);
  });
});

describe("arranging the to-do service's items", () => {
  it("moves an item before another and keeps the order, and refuses an item that is gone", async () => {
    const { createTodo, moveTodo, listTodos } = await import("./todosService");
    const a = await createTodo("a", null);
    await createTodo("b", null);
    const c = await createTodo("c", null);

    await moveTodo(c.id, a.id);

    expect((await listTodos()).map((t) => t.title)).toEqual(["c", "a", "b"]);
    await expect(moveTodo(999, null)).rejects.toThrow(/no longer exists/);
  });

  it("moves the done items to the bottom", async () => {
    const { createTodo, setTodoDone, sortDoneTodosLast, listTodos } = await import("./todosService");
    const a = await createTodo("a", null);
    await createTodo("b", null);
    await setTodoDone(a.id, true);

    await sortDoneTodosLast();

    expect((await listTodos()).map((t) => t.title)).toEqual(["b", "a"]);
  });
});
