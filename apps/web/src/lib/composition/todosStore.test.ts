import { describe, expect, it, vi } from "vitest";
import type { Todo, TodosApi } from "./todosApi";
import type { TodoLook } from "./todoLook";
import { createTodosStore } from "./todosStore";

const make = (id: number, parentId: number | null, title: string, done = false): Todo => ({ id, parentId, title, done, createdAt: "", updatedAt: "" });

/** A backend that keeps its items in memory, like the real one does in a database. */
function fakeBackend(initial: Todo[] = []) {
  let items = [...initial];
  let nextId = 100;
  let look: TodoLook = { background: "notes", color: null };
  const api = {
    loadTodoLook: vi.fn(async () => look),
    saveTodoLook: vi.fn(async (next: TodoLook) => {
      look = next;
    }),
    listTodos: vi.fn(async () => items),
    createTodo: vi.fn(async (title: string, parentId: number | null) => {
      const created = make(nextId++, parentId, title);
      items = [...items, created];
      return created;
    }),
    renameTodo: vi.fn(async (id: number, title: string) => {
      items = items.map((t) => (t.id === id ? { ...t, title } : t));
      return items.find((t) => t.id === id)!;
    }),
    setTodoDone: vi.fn(async (id: number, done: boolean) => {
      items = items.map((t) => (t.id === id ? { ...t, done } : t));
      return items.find((t) => t.id === id)!;
    }),
    deleteTodo: vi.fn(async (id: number) => {
      items = items.filter((t) => t.id !== id && t.parentId !== id);
    }),
  } satisfies TodosApi;
  return api;
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

  it("deletes an item with everything under it", async () => {
    const api = fakeBackend([make(1, null, "a"), make(2, 1, "b"), make(3, 2, "c"), make(4, null, "d")]);
    const store = createTodosStore(api);
    await store.load();

    await store.remove(1);

    expect(store.getSnapshot().todos.map((t) => t.id)).toEqual([4]);
    expect(api.deleteTodo).toHaveBeenCalledWith(1);
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
});
