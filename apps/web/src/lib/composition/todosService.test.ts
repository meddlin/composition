import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todos-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
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
