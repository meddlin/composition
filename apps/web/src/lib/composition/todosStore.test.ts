import { describe, expect, it, vi, type Mock } from "vitest";
import type { Todo, TodosApi } from "./todosApi";
import { memoryTodosBackend } from "./todosMemoryBackend";
import { createTodosStore } from "./todosStore";

const make = (id: number, parentId: number | null, title: string, done = false): Todo => ({ id, parentId, title, status: done ? "done" : "todo", done, createdAt: "", updatedAt: "" });

/** The in-memory backend (todosMemoryBackend.ts) with every method a spy, so a test can see what was asked and make one fail. */
function fakeBackend(initial: Todo[] = [], options: Omit<Parameters<typeof memoryTodosBackend>[0] & object, "todos"> = {}) {
  const memory = memoryTodosBackend({ todos: initial, ...options });
  return Object.fromEntries(
    Object.entries(memory).map(([method, call]) => [method, vi.fn(call as (...args: never[]) => unknown)]),
  ) as unknown as { [K in keyof TodosApi]: Mock<TodosApi[K]> };
}

describe("the to-do store", () => {
  it("starts idle, and loads the items once", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    expect(store.getSnapshot().status).toBe("idle");

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", todos: [{ id: 1, title: "a" }], error: null });
    expect(api.listTodos).toHaveBeenCalledTimes(1);
  });

  it("reports a failed load, and tries again on the next", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    api.listTodos.mockRejectedValueOnce(new Error("disk is full"));
    const store = createTodosStore(api);

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "disk is full" });

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", error: null });
  });

  it("adds an item, and a sub-item under it, trimming the title", async () => {
    const store = createTodosStore(fakeBackend());
    await store.load();

    expect(await store.add("  Plan trip ", null)).toEqual({});
    const parent = store.getSnapshot().todos[0];
    await store.add("Book flights", parent.id);

    expect(store.getSnapshot().todos.map((t) => [t.title, t.parentId])).toEqual([
      ["Plan trip", null],
      ["Book flights", parent.id],
    ]);
  });

  it("adds an item straight to the backlog when asked to, and shows it there from the start", async () => {
    const api = fakeBackend();
    const store = createTodosStore(api);
    await store.load();

    expect(await store.add("Someday", null, "backlog")).toEqual({});

    expect(store.getSnapshot().todos).toEqual([expect.objectContaining({ title: "Someday", status: "backlog", done: false })]);
    expect(api.setTodoStatus).toHaveBeenCalledWith(expect.any(Number), "backlog");
  });

  it("refuses an empty title without asking the backend", async () => {
    const api = fakeBackend();
    const store = createTodosStore(api);
    await store.load();

    expect(await store.add("   ", null)).toEqual({ error: expect.any(String) });
    expect(await store.rename(1, "")).toEqual({ error: expect.any(String) });
    expect(api.createTodo).not.toHaveBeenCalled();
    expect(api.renameTodo).not.toHaveBeenCalled();
  });

  it("shows a rename and a tick before the backend has answered", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const setTodoDone = api.setTodoDone.getMockImplementation()!;
    api.setTodoDone.mockImplementationOnce(async (id, done) => {
      await held;
      return setTodoDone(id, done);
    });
    const store = createTodosStore(api);
    await store.load();

    const pending = store.setDone(1, true);
    expect(store.getSnapshot().todos[0].done).toBe(true);
    release();
    await pending;
    await store.rename(1, "b");

    expect(store.getSnapshot().todos[0]).toMatchObject({ title: "b", done: true });
  });

  it("removes an item with everything under it, to the archive and not for good", async () => {
    const api = fakeBackend([make(1, null, "a"), make(2, 1, "b"), make(3, 2, "c"), make(4, null, "d")]);
    const store = createTodosStore(api);
    await store.load();

    expect(await store.remove(1)).toEqual({});

    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([4]);
    expect(api.removeTodo).toHaveBeenCalledWith(1);
    expect(api.deleteTodo).not.toHaveBeenCalled();
  });

  it("takes a removal back, with what was under the item", async () => {
    const api = fakeBackend([make(1, null, "a"), make(2, 1, "b"), make(4, null, "d")]);
    const store = createTodosStore(api);
    await store.load();
    await store.remove(1);

    expect(await store.restore(1)).toEqual({ toTopLevel: false });

    expect(store.getSnapshot().todos.map((t) => [t.id, t.parentId, t.status])).toEqual([
      [1, null, "todo"],
      [2, 1, "todo"],
      [4, null, "todo"],
    ]);
  });

  it("puts back what is stored when a removal or a restore is refused", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    await store.load();

    expect(await store.restore(1)).toEqual({ error: "That to-do is not in the archive." });
    api.removeTodo.mockRejectedValueOnce(new Error("That to-do no longer exists."));
    expect(await store.remove(1)).toEqual({ error: "That to-do no longer exists." });

    expect(store.getSnapshot()).toMatchObject({ todos: [{ id: 1 }], error: "That to-do no longer exists." });
  });

  it("puts back what is stored when the backend refuses a change", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    api.setTodoDone.mockRejectedValueOnce(new Error("That to-do no longer exists."));
    const store = createTodosStore(api);
    await store.load();

    const result = await store.setDone(1, true);

    expect(result).toEqual({ error: "That to-do no longer exists." });
    expect(store.getSnapshot()).toMatchObject({ todos: [{ id: 1, done: false }], error: "That to-do no longer exists." });
  });

  it("loads how the to-do panels look along with the items", async () => {
    const api = fakeBackend();
    await api.saveTodoLook({ background: "dots", color: "#14202b" });
    const store = createTodosStore(api);

    expect(store.getSnapshot().look).toEqual({ background: "notes", color: null });
    await store.load();

    expect(store.getSnapshot().look).toEqual({ background: "dots", color: "#14202b" });
  });

  it("shows a new look at once and saves it", async () => {
    const api = fakeBackend();
    const store = createTodosStore(api);
    await store.load();

    const pending = store.setLook({ background: "grid", color: null });
    expect(store.getSnapshot().look.background).toBe("grid");

    expect(await pending).toEqual({});
    expect(api.saveTodoLook).toHaveBeenCalledWith({ background: "grid", color: null });
  });

  it("puts the old look back when it cannot be saved", async () => {
    const api = fakeBackend();
    api.saveTodoLook.mockRejectedValueOnce(new Error("disk is full"));
    const store = createTodosStore(api);
    await store.load();

    expect(await store.setLook({ background: "grid", color: null })).toEqual({ error: "disk is full" });
    expect(store.getSnapshot()).toMatchObject({ look: { background: "notes", color: null }, error: "disk is full" });
  });

  it("tells its listeners about each change", async () => {
    const store = createTodosStore(fakeBackend());
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    await store.load();
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    stop();
    await store.add("x", null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("moves an item to a status at once, and keeps done in step", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    await store.load();

    const moving = store.setStatus(1, "in_progress");
    expect(store.getSnapshot().todos[0]).toMatchObject({ status: "in_progress", done: false });
    await moving;

    await store.setStatus(1, "done");
    expect(store.getSnapshot().todos[0]).toMatchObject({ status: "done", done: true });
    expect(api.setTodoStatus).toHaveBeenLastCalledWith(1, "done");
  });

  it("puts the stored status back when the backend refuses a move", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    api.setTodoStatus.mockRejectedValueOnce(new Error("no disk"));
    const store = createTodosStore(api);
    await store.load();

    const result = await store.setStatus(1, "backlog");

    expect(result.error).toBe("no disk");
    expect(store.getSnapshot()).toMatchObject({ todos: [{ status: "todo" }], error: "no disk" });
  });
});

describe("the to-do store's weekly cycle", () => {
  const rolled = (id: number, parentId: number | null, title: string, rollCount = 2): Todo => ({
    ...make(id, parentId, title),
    rolledFromWeek: "2026-10-18",
    rollCount,
  });
  const branch = () => [rolled(1, null, "Plan trip", 3), rolled(2, 1, "Book flights"), make(3, 1, "Pack"), rolled(4, null, "Write plan", 1), make(5, null, "Reply")];

  it("adds a rolled branch to this week at once, keeping each count, and nothing beside it", async () => {
    const api = fakeBackend(branch());
    const store = createTodosStore(api);
    await store.load();

    const pending = store.acceptRolled(1);
    expect(store.getSnapshot().todos.filter((t) => t.rolledFromWeek !== undefined).map((t) => t.id)).toEqual([4]);
    expect(await pending).toEqual({});

    expect(api.acceptRolledTodo).toHaveBeenCalledWith(1);
    expect(store.getSnapshot().todos.find((t) => t.id === 1)).toMatchObject({ rollCount: 3 });
    expect(store.getSnapshot().todos.find((t) => t.id === 4)).toMatchObject({ rolledFromWeek: "2026-10-18" });
  });

  it("moves a rolled branch to the backlog at once: the top item goes there, the whole branch starts clean", async () => {
    const api = fakeBackend(branch());
    const store = createTodosStore(api);
    await store.load();

    const pending = store.moveRolledToBacklog(1);
    const [top, child, placed] = store.getSnapshot().todos;
    expect(top).toMatchObject({ id: 1, status: "backlog" });
    expect([top.rolledFromWeek, top.rollCount, child.rolledFromWeek, child.rollCount]).toEqual([undefined, undefined, undefined, undefined]);
    expect([child.status, placed.status]).toEqual(["todo", "todo"]);
    expect(await pending).toEqual({});

    expect(api.moveRolledTodoToBacklog).toHaveBeenCalledWith(1);
  });

  it("drops a rolled branch at once, to the archive", async () => {
    const api = fakeBackend(branch());
    const store = createTodosStore(api);
    await store.load();

    expect(await store.drop(1)).toEqual({});

    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([4, 5]);
    expect(api.dropTodo).toHaveBeenCalledWith(1);
  });

  it("puts back what is stored when one of these is refused", async () => {
    const api = fakeBackend(branch());
    api.dropTodo.mockRejectedValueOnce(new Error("That to-do is not waiting in Rolled over."));
    const store = createTodosStore(api);
    await store.load();

    expect(await store.drop(1)).toEqual({ error: "That to-do is not waiting in Rolled over." });

    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads the list again when it was changed behind its back, and not before it has been loaded", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);

    await store.reload();
    expect(api.listTodos).not.toHaveBeenCalled();

    await store.load();
    await api.createTodo("made elsewhere", null);
    await store.reload();

    expect(store.getSnapshot().todos.map((t) => t.title)).toEqual(["a", "made elsewhere"]);
  });

  it("keeps the list it has, and says why, when it cannot read it again", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    await store.load();
    api.listTodos.mockRejectedValueOnce(new Error("database is locked"));

    await store.reload();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", todos: [{ id: 1 }], error: "database is locked" });
  });

  it("loads the first-run question with the items, and shows none when it cannot be asked", async () => {
    const asked = createTodosStore(fakeBackend([make(1, null, "a", true)], { setup: { pending: true, completed: 1 } }));
    expect(asked.getSnapshot().setup).toBeNull();
    await asked.load();
    expect(asked.getSnapshot().setup).toEqual({ pending: true, completed: 1 });

    const api = fakeBackend([make(1, null, "a")]);
    api.loadTodoSetup.mockRejectedValueOnce(new Error("no"));
    const unasked = createTodosStore(api);
    await unasked.load();
    expect(unasked.getSnapshot()).toMatchObject({ status: "ready", setup: null, todos: [{ id: 1 }] });
  });

  it("answers the first-run question: a yes archives the completed items and the question goes away", async () => {
    const api = fakeBackend([make(1, null, "done one", true), make(2, null, "open one")], { setup: { pending: true, completed: 1 } });
    const store = createTodosStore(api);
    await store.load();

    expect(await store.finishSetup(true)).toEqual({});

    expect(api.finishTodoSetup).toHaveBeenCalledWith(true);
    expect(store.getSnapshot().setup).toEqual({ pending: false, completed: 0 });
    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([2]);
  });

  it("answers no without archiving anything, and keeps the question if the answer cannot be saved", async () => {
    const api = fakeBackend([make(1, null, "done one", true)], { setup: { pending: true, completed: 1 } });
    api.finishTodoSetup.mockRejectedValueOnce(new Error("disk is full"));
    const store = createTodosStore(api);
    await store.load();

    expect(await store.finishSetup(false)).toEqual({ error: "disk is full" });
    expect(store.getSnapshot().setup).toEqual({ pending: true, completed: 1 });

    expect(await store.finishSetup(false)).toEqual({});
    expect(store.getSnapshot()).toMatchObject({ setup: { pending: false, completed: 0 }, todos: [{ id: 1 }] });
  });
});

describe("the to-do store's archive", () => {
  const archived = (todo: Todo, week = "2026-10-18", reason: "done" | "removed" | "dropped" = "removed") => ({ todo, reason, week });

  it("has no archive until it is asked for, and then lists it", async () => {
    const api = fakeBackend([make(1, null, "live")], { archived: [archived(make(2, null, "old")), archived(make(3, 2, "older"), "2026-10-11", "done")] });
    const store = createTodosStore(api);
    await store.load();

    expect(store.getSnapshot().archive).toBeNull();
    expect(api.listArchivedTodos).not.toHaveBeenCalled();

    await store.loadArchive();

    expect(store.getSnapshot().archive?.map((t) => [t.id, t.archiveReason, t.archiveWeek])).toEqual([
      [2, "removed", "2026-10-18"],
      [3, "done", "2026-10-11"],
    ]);
  });

  it("says why the archive could not be read, and leaves the list alone", async () => {
    const api = fakeBackend([make(1, null, "live")]);
    api.listArchivedTodos.mockRejectedValueOnce(new Error("database is locked"));
    const store = createTodosStore(api);
    await store.load();

    expect(await store.loadArchive()).toEqual({ error: "database is locked" });

    expect(store.getSnapshot()).toMatchObject({ archive: null, todos: [{ id: 1 }], error: "database is locked" });
  });

  it("keeps a loaded archive up to date: what is removed appears in it, and what is restored leaves it", async () => {
    const api = fakeBackend([make(1, null, "a"), make(2, 1, "b"), make(3, null, "c")]);
    const store = createTodosStore(api);
    await store.load();
    await store.loadArchive();

    await store.remove(1);
    expect(store.getSnapshot().archive?.map((t) => t.id)).toEqual([1, 2]);

    await store.restore(1);
    expect(store.getSnapshot().archive).toEqual([]);
    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("does not read the archive for a change while nobody has asked to see it", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    await store.load();

    await store.remove(1);

    expect(api.listArchivedTodos).not.toHaveBeenCalled();
  });

  it("reads a loaded archive again when the list was changed behind its back", async () => {
    const api = fakeBackend([make(1, null, "a")]);
    const store = createTodosStore(api);
    await store.load();
    await store.loadArchive();
    await api.removeTodo(1); // as the weekly cycle would

    await store.reload();

    expect(store.getSnapshot().archive?.map((t) => t.id)).toEqual([1]);
    expect(store.getSnapshot().todos).toEqual([]);
  });

  it("deletes an archived item for good, with what is under it, from the archive at once", async () => {
    const api = fakeBackend([make(9, null, "live")], { archived: [archived(make(1, null, "trip")), archived(make(2, 1, "flights")), archived(make(3, null, "other"))] });
    const store = createTodosStore(api);
    await store.load();
    await store.loadArchive();

    const pending = store.deleteForGood(1);
    expect(store.getSnapshot().archive?.map((t) => t.id)).toEqual([3]);
    expect(await pending).toEqual({});

    expect(api.deleteTodo).toHaveBeenCalledWith(1);
    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([9]);
  });

  it("deletes an item on the list for good too, and the sub-items it has in the archive", async () => {
    const api = fakeBackend([make(1, null, "trip"), make(4, null, "other")], { archived: [archived(make(2, 1, "flights", true), "2026-10-18", "done")] });
    const store = createTodosStore(api);
    await store.load();
    await store.loadArchive();

    await store.deleteForGood(1);

    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([4]);
    expect(store.getSnapshot().archive).toEqual([]);
  });

  it("puts back what is stored when a permanent delete is refused", async () => {
    const api = fakeBackend([], { archived: [archived(make(1, null, "trip"))] });
    api.deleteTodo.mockRejectedValueOnce(new Error("database is locked"));
    const store = createTodosStore(api);
    await store.load();
    await store.loadArchive();

    expect(await store.deleteForGood(1)).toEqual({ error: "database is locked" });

    expect(store.getSnapshot().archive?.map((t) => t.id)).toEqual([1]);
  });

  it("says what a permanent delete would erase and which reports mention it, deleting nothing", async () => {
    const api = fakeBackend([make(1, null, "trip"), make(2, 1, "flights")], { reports: { 1: [{ noteId: 7, title: "Weekly 2026-10-25" }] } });
    const store = createTodosStore(api);
    await store.load();

    expect(await store.previewDelete(1)).toEqual({ preview: { items: 2, reports: [{ noteId: 7, title: "Weekly 2026-10-25" }] } });
    expect(api.deleteTodo).not.toHaveBeenCalled();

    api.previewTodoDelete.mockRejectedValueOnce(new Error("database is locked"));
    expect(await store.previewDelete(1)).toEqual({ error: "database is locked" });
  });
});

describe("the to-do store's reports", () => {
  const week = (noteId: number, periodStart: string): import("./todosApi").TodoReportEntry => ({
    noteId,
    title: `Weekly ${periodStart} #${noteId}`,
    kind: "weekly",
    periodStart,
    periodEnd: periodStart,
    label: periodStart,
    generatedAt: "2026-10-26T09:00:00.000Z",
  });
  const none = (periodStart: string) => ({ kind: "weekly" as const, periodStart, periodEnd: periodStart, label: periodStart });
  const reports = { reports: [week(7, "2026-10-18")], missing: [none("2026-10-11")] };

  it("has no reports until they are asked for, and then lists them", async () => {
    const api = fakeBackend([], { todoReports: reports });
    const store = createTodosStore(api);
    await store.load();

    expect(store.getSnapshot().reports).toBeNull();
    expect(api.loadTodoReports).not.toHaveBeenCalled();

    expect(await store.loadReports()).toEqual({});

    expect(store.getSnapshot().reports).toEqual(reports);
  });

  it("says why the reports could not be read, and leaves the list alone", async () => {
    const api = fakeBackend([make(1, null, "live")]);
    api.loadTodoReports.mockRejectedValueOnce(new Error("database is locked"));
    const store = createTodosStore(api);
    await store.load();

    expect(await store.loadReports()).toEqual({ error: "database is locked" });

    expect(store.getSnapshot()).toMatchObject({ reports: null, todos: [{ id: 1 }], error: "database is locked" });
  });

  it("makes a report for a period, which appears newest among its copies, and returns it", async () => {
    const api = fakeBackend([], { todoReports: reports });
    const store = createTodosStore(api);
    await store.load();
    await store.loadReports();

    const result = await store.generateReport("weekly", "2026-10-11");

    expect(result).toEqual({ report: expect.objectContaining({ kind: "weekly", periodStart: "2026-10-11" }) });
    expect(api.generateTodoReport).toHaveBeenCalledWith("weekly", "2026-10-11");
    expect(store.getSnapshot().reports?.reports.map((r) => r.periodStart)).toEqual(["2026-10-18", "2026-10-11"]);
    expect(store.getSnapshot().reports?.missing).toEqual([]);
  });

  it("says why a report could not be made, and shows what is stored", async () => {
    const api = fakeBackend([], { todoReports: reports });
    const store = createTodosStore(api);
    await store.load();
    await store.loadReports();

    expect(await store.generateReport("weekly", "2026-10-25")).toEqual({ error: "That period has not closed, so there is nothing to report on yet." });

    expect(store.getSnapshot()).toMatchObject({ reports: reports, error: "That period has not closed, so there is nothing to report on yet." });
  });

  it("reads loaded reports again when the cycle changed things behind its back", async () => {
    const api = fakeBackend([], { todoReports: reports });
    const store = createTodosStore(api);
    await store.load();
    await store.loadReports();
    await api.generateTodoReport("weekly", "2026-10-11"); // as the weekly cycle, or another window, would

    await store.reload();

    expect(store.getSnapshot().reports?.reports.map((r) => r.periodStart)).toEqual(["2026-10-18", "2026-10-11"]);
  });
});
