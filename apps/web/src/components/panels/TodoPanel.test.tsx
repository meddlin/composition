// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodoLook } from "@/lib/composition/todoLook";
import type { Todo, TodosApi } from "@/lib/composition/todosApi";
import { createTodosStore } from "@/lib/composition/todosStore";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { KINDS, type TodoPanelState } from "./kinds";
import { TodoPanel } from "./TodoPanel";

afterEach(cleanup);

const item = (id: number, parentId: number | null, title: string, done = false): Todo => ({ id, parentId, title, done, createdAt: "", updatedAt: "" });

/** A backend that keeps its items in memory. */
function backend(initial: Todo[] = [], look: TodoLook = { background: "notes", color: null }): TodosApi {
  let items = [...initial];
  let next = 100;
  return {
    loadTodoLook: async () => look,
    saveTodoLook: async (saved) => {
      look = saved;
    },
    listTodos: async () => items,
    createTodo: async (title, parentId) => {
      const created = item(next++, parentId, title);
      items = [...items, created];
      return created;
    },
    renameTodo: async (id, title) => {
      items = items.map((t) => (t.id === id ? { ...t, title } : t));
      return items.find((t) => t.id === id)!;
    },
    setTodoDone: async (id, done) => {
      items = items.map((t) => (t.id === id ? { ...t, done } : t));
      return items.find((t) => t.id === id)!;
    },
    deleteTodo: async (id) => {
      const gone = new Set([id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const t of items) {
          if (t.parentId !== null && gone.has(t.parentId) && !gone.has(t.id)) {
            gone.add(t.id);
            grew = true;
          }
        }
      }
      items = items.filter((t) => !gone.has(t.id));
    },
  };
}

/** The panel, with a workspace that has only what it uses: the to-do items and the panel's saved state. */
function setup(initial: Todo[] = []) {
  const todos = createTodosStore(backend(initial));
  let state: TodoPanelState = { collapsed: [] };
  const setPanelState = vi.fn((_id: string, next: unknown) => {
    state = next as TodoPanelState;
    view.rerender(<TodoPanel store={store} panelId="p1" state={state} />);
  });
  const store = { todos, setPanelState } as unknown as WorkspaceStore;
  const view = render(<TodoPanel store={store} panelId="p1" state={state} />);
  return { todos, setPanelState };
}

const typeInto = (name: string, value: string) => {
  const box = screen.getByRole("textbox", { name });
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("the to-do panel", () => {
  it("says so when there is nothing to do yet", async () => {
    setup();

    expect(await screen.findByText("Nothing to do yet.")).toBeTruthy();
  });

  it("adds an item, and clears the box for the next", async () => {
    setup();
    await screen.findByText("Nothing to do yet.");

    typeInto("New to-do", "Buy milk");

    expect(await screen.findByText("Buy milk")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "New to-do" }) as HTMLInputElement).value).toBe("");
  });

  it("adds a sub-item under an item, shown beneath it", async () => {
    setup([item(1, null, "Plan trip")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add a sub-item to Plan trip" }));

    typeInto("New sub-item of Plan trip", "Book flights");

    const list = await screen.findByRole("list", { name: "To-dos" });
    const parent = within(list).getByText("Plan trip").closest("li")!;
    expect(within(parent).getByText("Book flights")).toBeTruthy();
  });

  it("renames an item", async () => {
    setup([item(1, null, "Buy milk")]);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Buy milk" }));

    typeInto("Rename Buy milk", "Buy oat milk");

    expect(await screen.findByText("Buy oat milk")).toBeTruthy();
    expect(screen.queryByText("Buy milk")).toBeNull();
  });

  it("leaves a title alone when the rename is cancelled with Escape", async () => {
    setup([item(1, null, "Buy milk")]);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Buy milk" }));
    const box = screen.getByRole("textbox", { name: "Rename Buy milk" });

    fireEvent.change(box, { target: { value: "Something else" } });
    fireEvent.keyDown(box, { key: "Escape" });

    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.queryByText("Something else")).toBeNull();
  });

  it("strikes a done item through, and takes it off again when unticked", async () => {
    setup([item(1, null, "Buy milk")]);
    const box = await screen.findByRole("checkbox", { name: "Buy milk: done" });
    const title = screen.getByText("Buy milk");
    expect(title.className).not.toContain("line-through");

    fireEvent.click(box);
    await waitFor(() => expect(screen.getByText("Buy milk").className).toContain("line-through"));

    fireEvent.click(screen.getByRole("checkbox", { name: "Buy milk: done" }));
    await waitFor(() => expect(screen.getByText("Buy milk").className).not.toContain("line-through"));
  });

  it("deletes an item with no sub-items at once", async () => {
    setup([item(1, null, "Buy milk"), item(2, null, "Walk dog")]);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Buy milk" }));

    await waitFor(() => expect(screen.queryByText("Buy milk")).toBeNull());
    expect(screen.getByText("Walk dog")).toBeTruthy();
  });

  it("asks before deleting an item with sub-items, and deletes them with it", async () => {
    setup([item(1, null, "Plan trip"), item(2, 1, "Book flights"), item(3, null, "Walk dog")]);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Plan trip" }));
    expect(screen.getByText(/will be deleted for good/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Plan trip")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Plan trip" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Plan trip")).toBeNull());
    expect(screen.queryByText("Book flights")).toBeNull();
    expect(screen.getByText("Walk dog")).toBeTruthy();
  });

  it("folds an item's sub-items away and saves that in the panel's state", async () => {
    const { setPanelState } = setup([item(1, null, "Plan trip"), item(2, 1, "Book flights")]);
    fireEvent.click(await screen.findByRole("button", { name: "Hide the sub-items of Plan trip" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [1] });
    expect(screen.queryByText("Book flights")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show the sub-items of Plan trip" }));
    expect(await screen.findByText("Book flights")).toBeTruthy();
  });

  it("offers to try again when the items cannot be loaded", async () => {
    const todos = createTodosStore({ ...backend(), listTodos: vi.fn().mockRejectedValueOnce(new Error("no disk")).mockResolvedValue([]) });
    const store = { todos, setPanelState: vi.fn() } as unknown as WorkspaceStore;
    render(<TodoPanel store={store} panelId="p1" state={{ collapsed: [] }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Nothing to do yet.")).toBeTruthy();
  });
});

describe("the to-do kind", () => {
  it("starts with nothing folded", () => {
    expect(KINDS.todo.initialState()).toEqual({ collapsed: [] });
  });

  it("restores what it saved, and drops what is not an id", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    expect(KINDS.todo.restore({ collapsed: [1, "x", 2.5, 3] }, context)).toEqual({ collapsed: [1, 3] });
  });

  it("cannot restore anything else, so the panel comes back empty", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    for (const saved of [null, "todo", { collapsed: "1" }, {}]) expect(KINDS.todo.restore(saved, context)).toBeNull();
  });
});

describe("the to-do background", () => {
  /** The panel, with a workspace whose to-do store is given the look to start from. */
  function withLook(look: TodoLook) {
    const todos = createTodosStore(backend([], look));
    const store = { todos, setPanelState: vi.fn() } as unknown as WorkspaceStore;
    render(<TodoPanel store={store} panelId="p1" state={{ collapsed: [] }} />);
    return { todos, body: () => screen.getByLabelText("New to-do").parentElement as HTMLElement };
  }

  it("follows the notes' background unless the setting says otherwise", async () => {
    const { body } = withLook({ background: "notes", color: null });
    await screen.findByText("Nothing to do yet.");

    expect(body().className).toContain("note-surface");
  });

  it("draws the pattern and color chosen in Settings, with text that reads on it", async () => {
    const { body } = withLook({ background: "dots", color: "#14202b" });
    await screen.findByText("Nothing to do yet.");

    expect(body().className).not.toContain("note-surface");
    expect(body().style.backgroundImage).toContain("radial-gradient");
    expect(body().style.backgroundColor).toBe("rgb(20, 32, 43)");
    expect(body().style.color).toBe("rgb(242, 242, 242)");
  });

  it("changes when Settings changes the look, without being remade", async () => {
    const { todos, body } = withLook({ background: "notes", color: null });
    await screen.findByText("Nothing to do yet.");

    await act(async () => {
      await todos.setLook({ background: "grid", color: "#fbf3d9" });
    });

    expect(body().className).not.toContain("note-surface");
    expect(body().style.backgroundColor).toBe("rgb(251, 243, 217)");
  });
});
