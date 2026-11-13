// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodoLook } from "@/lib/composition/todoLook";
import type { Todo, TodoStatus } from "@/lib/composition/todosApi";
import { memoryTodosBackend } from "@/lib/composition/todosMemoryBackend";
import { createTodosStore } from "@/lib/composition/todosStore";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { KINDS, type TodoPanelState } from "./kinds";
import { TodoPanel } from "./TodoPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const item = (id: number, parentId: number | null, title: string, done = false, status: TodoStatus = done ? "done" : "todo"): Todo => ({
  id,
  parentId,
  title,
  status,
  done,
  createdAt: "",
  updatedAt: "",
});

/** An item waiting in Rolled over, from the week of 18 October. */
const rolled = (id: number, parentId: number | null, title: string, rollCount = 1): Todo => ({
  ...item(id, parentId, title),
  rolledFromWeek: "2026-10-18",
  rollCount,
});

const LIST: TodoPanelState = { collapsed: [], view: "list", foldedSections: [] };
const BOARD: TodoPanelState = { collapsed: [], view: "board", foldedSections: [] };
const ARCHIVE: TodoPanelState = { collapsed: [], view: "archive", foldedSections: [] };
const REPORTS: TodoPanelState = { collapsed: [], view: "reports", foldedSections: [] };

/** The panel, with a workspace that has only what it uses: the to-do items and the panel's saved state. */
function setup(
  initial: Todo[] = [],
  start: TodoPanelState = LIST,
  options: Omit<NonNullable<Parameters<typeof memoryTodosBackend>[0]>, "todos"> = {},
) {
  const todos = createTodosStore(memoryTodosBackend({ todos: initial, ...options }));
  let state: TodoPanelState = start;
  const setPanelState = vi.fn((_id: string, next: unknown) => {
    state = next as TodoPanelState;
    view.rerender(<TodoPanel store={store} panelId="p1" state={state} />);
  });
  const openNoteBeside = vi.fn();
  const store = { todos, setPanelState, openNoteBeside } as unknown as WorkspaceStore;
  const view = render(<TodoPanel store={store} panelId="p1" state={state} />);
  return { todos, setPanelState, openNoteBeside };
}

/** Clicks an item's Remove and says yes to the question it asks. */
async function removeItem(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Remove ${title}` }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
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

  it("adds an item with the Add button as well as with Enter, and clears the box for the next", async () => {
    setup();
    await screen.findByText("Nothing to do yet.");
    const box = screen.getByRole("textbox", { name: "New to-do" }) as HTMLInputElement;

    fireEvent.change(box, { target: { value: "Buy milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to-do" }));

    expect(await screen.findByText("Buy milk")).toBeTruthy();
    expect(box.value).toBe("");
    // The cursor goes back to the box, so the next one can be typed straight away.
    expect(document.activeElement).toBe(box);
  });

  it("has the Add button off while the box is empty or only spaces", async () => {
    setup();
    await screen.findByText("Nothing to do yet.");
    const add = screen.getByRole("button", { name: "Add to-do" }) as HTMLButtonElement;
    const box = screen.getByRole("textbox", { name: "New to-do" });
    expect(add.disabled).toBe(true);

    fireEvent.change(box, { target: { value: "   " } });
    expect(add.disabled).toBe(true);

    fireEvent.change(box, { target: { value: "Buy milk" } });
    expect(add.disabled).toBe(false);

    fireEvent.click(add);
    await screen.findByText("Buy milk");
    expect(add.disabled).toBe(true);
  });

  it("has an Add button for the backlog's own box too, which adds to the backlog", async () => {
    setup([item(2, null, "Buy milk")]);
    await screen.findByRole("region", { name: "Backlog" });

    fireEvent.change(screen.getByRole("textbox", { name: "New backlog item" }), { target: { value: "Learn Spanish" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));

    await waitFor(() => expect(within(screen.getByRole("region", { name: "Backlog" })).getByText("Learn Spanish")).toBeTruthy());
    expect(within(screen.getByRole("region", { name: "This week" })).queryByText("Learn Spanish")).toBeNull();
  });

  it("has no Add button on the box for a sub-item or a rename, which are for one item and close when done", async () => {
    setup([item(1, null, "Plan trip")]);
    fireEvent.click(await screen.findByRole("button", { name: "Add a sub-item to Plan trip" }));

    expect(screen.getByRole("textbox", { name: "New sub-item of Plan trip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add sub-item" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Add (to-do|to backlog)$/ })).toHaveLength(2);
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

  it("asks before removing an item, and leaves it be on Cancel", async () => {
    const { todos } = setup([item(1, null, "Buy milk"), item(2, null, "Walk dog")]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Buy milk" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove this to-do?");
    expect(dialog.textContent).toContain("“Buy milk” will be taken off the list and kept in the archive");
    // Cancel holds the focus, so an Enter pressed by accident backs out.
    expect(document.activeElement?.textContent).toBe("Cancel");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(todos.getSnapshot().todos.map((t) => t.id)).toEqual([1, 2]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("removes an item on a yes, and says so with an Undo", async () => {
    setup([item(1, null, "Buy milk"), item(2, null, "Walk dog")]);

    await removeItem("Buy milk");

    await waitFor(() => expect(screen.queryByText("Buy milk", { selector: "span.break-words" })).toBeNull());
    expect(screen.getByText("Walk dog")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toContain("Removed “Buy milk”.");
  });

  it("brings a removed item back with Undo", async () => {
    setup([item(1, null, "Buy milk"), item(2, null, "Walk dog")]);
    await removeItem("Buy milk");

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Buy milk")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("says in the question how many sub-items go with an item, and after it how many went; Undo brings them all back", async () => {
    setup([item(1, null, "Plan trip"), item(2, 1, "Book flights"), item(3, null, "Walk dog")]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Plan trip" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("“Plan trip” and its 1 sub-item will be taken off the list");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect((await screen.findByRole("status")).textContent).toContain("Removed “Plan trip” and 1 sub-item.");
    expect(screen.queryByText("Book flights")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Book flights")).toBeTruthy();
    expect(screen.getByText("Plan trip")).toBeTruthy();
  });

  it("stops offering the Undo after a while", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setup([item(1, null, "Buy milk")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Buy milk" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("status")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("folds an item's sub-items away and saves that in the panel's state", async () => {
    const { setPanelState } = setup([item(1, null, "Plan trip"), item(2, 1, "Book flights")]);
    fireEvent.click(await screen.findByRole("button", { name: "Hide the sub-items of Plan trip" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [1], view: "list", foldedSections: [] });
    expect(screen.queryByText("Book flights")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show the sub-items of Plan trip" }));
    expect(await screen.findByText("Book flights")).toBeTruthy();
  });

  it("offers to try again when the items cannot be loaded", async () => {
    const todos = createTodosStore({ ...memoryTodosBackend(), listTodos: vi.fn().mockRejectedValueOnce(new Error("no disk")).mockResolvedValue([]) });
    const store = { todos, setPanelState: vi.fn() } as unknown as WorkspaceStore;
    render(<TodoPanel store={store} panelId="p1" state={LIST} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Nothing to do yet.")).toBeTruthy();
  });
});

describe("the to-do board", () => {
  const items = [
    item(1, null, "Plan trip", false, "backlog"),
    item(2, null, "Buy milk"),
    item(3, null, "Write report", false, "in_progress"),
    item(4, 3, "Draft intro"),
    item(5, null, "Walk dog", true),
  ];
  const column = (name: string) => screen.getByRole("region", { name });
  const cardsIn = (name: string) => within(column(name)).queryAllByRole("listitem").map((li) => li.getAttribute("aria-label"));

  /** The panel on the board view; a click on the view buttons is saved into the state like in the real workspace. */
  function onBoard(initial: Todo[] = items) {
    return setup(initial, BOARD);
  }

  it("puts each item in the column of its status", async () => {
    onBoard();
    await screen.findByRole("group", { name: "To-do board" });

    expect(cardsIn("Backlog")).toEqual(["Plan trip"]);
    expect(cardsIn("To-do")).toEqual(["Buy milk", "Draft intro"]);
    expect(cardsIn("In progress")).toEqual(["Write report"]);
    expect(cardsIn("Done")).toEqual(["Walk dog"]);
    expect(within(column("To-do")).getByText("in Write report")).toBeTruthy();
  });

  it("moves an item along with the arrows on its card", async () => {
    onBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Move Buy milk to In progress" }));

    await waitFor(() => expect(cardsIn("In progress")).toEqual(["Buy milk", "Write report"]));
    expect(cardsIn("To-do")).toEqual(["Draft intro"]);

    fireEvent.click(screen.getByRole("button", { name: "Move Buy milk to Done" }));
    await waitFor(() => expect(cardsIn("Done")).toEqual(["Buy milk", "Walk dog"]));
    expect(within(column("Done")).getByText("Buy milk").className).toContain("line-through");

    fireEvent.click(screen.getByRole("button", { name: "Move Plan trip to To-do" }));
    await waitFor(() => expect(cardsIn("To-do")).toEqual(["Plan trip", "Draft intro"]));
  });

  it("has no arrow past the first and last column", async () => {
    onBoard();
    await screen.findByRole("group", { name: "To-do board" });

    expect((screen.getByRole("button", { name: "Move Plan trip back" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Walk dog forward" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves an item dragged to another column", async () => {
    onBoard();
    const card = (await screen.findByRole("listitem", { name: "Plan trip" })) as HTMLElement;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(column("Done"), { dataTransfer });
    fireEvent.drop(column("Done"), { dataTransfer });

    await waitFor(() => expect(cardsIn("Done")).toEqual(["Plan trip", "Walk dog"]));
    expect(cardsIn("Backlog")).toEqual([]);
  });

  it("removes a card, with an Undo, whether or not it has sub-items", async () => {
    onBoard();
    await removeItem("Plan trip");
    await waitFor(() => expect(cardsIn("Backlog")).toEqual([]));

    await removeItem("Write report");
    await waitFor(() => expect(cardsIn("In progress")).toEqual([]));
    expect(cardsIn("To-do")).toEqual(["Buy milk"]);

    // An item that comes back from the archive is a to-do again, whatever it was; what was under it comes back as it was.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(cardsIn("To-do")).toEqual(["Buy milk", "Write report", "Draft intro"]));
    expect(cardsIn("In progress")).toEqual([]);
  });

  it("switches between the list and the board, saving the choice in the panel's state", async () => {
    const { setPanelState } = setup([item(2, null, "Buy milk")]);
    expect(await screen.findByRole("list", { name: "To-dos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Board view" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [], view: "board", foldedSections: [] });
    expect(await screen.findByRole("group", { name: "To-do board" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "To-dos" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(await screen.findByRole("list", { name: "To-dos" })).toBeTruthy();
  });

  it("shows a move made on the board as a tick in the list", async () => {
    setup([item(2, null, "Buy milk")], BOARD);
    fireEvent.click(await screen.findByRole("button", { name: "Move Buy milk to In progress" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move Buy milk to Done" }));
    fireEvent.click(screen.getByRole("button", { name: "List view" }));

    const box = await screen.findByRole("checkbox", { name: "Buy milk: done" });
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});

describe("the to-do kind", () => {
  it("starts with nothing folded", () => {
    expect(KINDS.todo.initialState()).toEqual({ collapsed: [], view: "list", foldedSections: [] });
  });

  it("restores what it saved, and drops what is not an id", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    expect(KINDS.todo.restore({ collapsed: [1, "x", 2.5, 3] }, context)).toEqual({ collapsed: [1, 3], view: "list", foldedSections: [] });
  });

  it("restores the view it saved, and shows the list for a panel saved before there were views", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    expect(KINDS.todo.restore({ collapsed: [], view: "board" }, context)).toEqual(BOARD);
    expect(KINDS.todo.restore({ collapsed: [], view: "gantt" }, context)).toEqual(LIST);
  });

  it("restores which sections were folded, shows them all open for a panel saved before there were sections, and drops what is not one", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    expect(KINDS.todo.restore({ collapsed: [], view: "list", foldedSections: ["backlog", "rolled-over"] }, context)).toEqual({
      collapsed: [],
      view: "list",
      foldedSections: ["backlog", "rolled-over"],
    });
    expect(KINDS.todo.restore({ collapsed: [], view: "list" }, context)).toEqual(LIST);
    expect(KINDS.todo.restore({ collapsed: [], view: "list", foldedSections: ["archive", 3, "backlog", "backlog"] }, context)).toEqual({
      collapsed: [],
      view: "list",
      foldedSections: ["backlog"],
    });
  });

  it("restores the Archive view, and a saved view it does not know is the list", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    expect(KINDS.todo.restore({ collapsed: [], view: "archive" }, context)).toEqual(ARCHIVE);
    expect(KINDS.todo.restore({ collapsed: [], view: "reports" }, context)).toEqual(REPORTS);
    expect(KINDS.todo.restore({ collapsed: [], view: "gantt" }, context)).toEqual(LIST);
  });

  it("cannot restore anything else, so the panel comes back empty", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };
    for (const saved of [null, "todo", { collapsed: "1" }, {}]) expect(KINDS.todo.restore(saved, context)).toBeNull();
  });
});

describe("the to-do background", () => {
  /** The panel, with a workspace whose to-do store is given the look to start from. */
  function withLook(look: TodoLook) {
    const todos = createTodosStore(memoryTodosBackend({ look }));
    const store = { todos, setPanelState: vi.fn() } as unknown as WorkspaceStore;
    render(<TodoPanel store={store} panelId="p1" state={LIST} />);
    return { todos, body: () => screen.getByLabelText("New to-do").closest("div.flex-col") as HTMLElement };
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

describe("the sections of the list", () => {
  const items = [
    rolled(1, null, "Write Q4 plan", 1),
    item(2, null, "Buy milk"),
    item(3, null, "Someday trip", false, "backlog"),
    item(4, null, "Walk dog", true),
  ];
  const section = (name: string) => screen.getByRole("region", { name });

  it("shows what is rolled over, this week and the backlog, each in its own section", async () => {
    setup(items);
    await screen.findByRole("region", { name: "This week" });

    expect(within(section("Rolled over")).getByText("Write Q4 plan")).toBeTruthy();
    expect(within(section("This week")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Buy milk"), expect.stringContaining("Walk dog")]),
    );
    expect(within(section("This week")).queryByText("Someday trip")).toBeNull();
    expect(within(section("Backlog")).getByText("Someday trip")).toBeTruthy();
  });

  it("puts This week first, then Rolled over, then the Backlog, so the list you work from is at the top", async () => {
    setup(items);
    await screen.findByRole("region", { name: "This week" });

    const order = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-label"))
      .filter((name) => ["Rolled over", "This week", "Backlog"].includes(name ?? ""));

    expect(order).toEqual(["This week", "Rolled over", "Backlog"]);
  });

  it("has no Rolled over section when nothing is waiting there", async () => {
    setup([item(2, null, "Buy milk")]);
    await screen.findByRole("region", { name: "This week" });

    expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull();
    expect(screen.getByRole("region", { name: "Backlog" })).toBeTruthy();
  });

  it("says which week a rolled-over item came from, and how long it has waited", async () => {
    setup([rolled(1, null, "Write Q4 plan", 1), rolled(2, null, "Call the bank", 2)]);
    await screen.findByRole("region", { name: "Rolled over" });

    const plan = within(section("Rolled over")).getByText("Write Q4 plan").closest("li")!;
    const bank = within(section("Rolled over")).getByText("Call the bank").closest("li")!;
    expect(plan.textContent).toMatch(/From the week of .*18/);
    expect(plan.textContent).not.toMatch(/waiting/);
    expect(bank.textContent).toMatch(/waiting 2 weeks/);
  });

  it("adds a gentle nudge once an item has rolled over three times, and not before", async () => {
    setup([rolled(1, null, "Write Q4 plan", 2), rolled(2, null, "Call the bank", 3)]);
    await screen.findByRole("region", { name: "Rolled over" });

    expect(within(section("Rolled over")).getAllByText(/Rolled over \d+ times/)).toHaveLength(1);
    expect(within(within(section("Rolled over")).getByText("Call the bank").closest("li")!).getByText(/Rolled over 3 times/)).toBeTruthy();
  });

  it("adds a rolled-over item to this week", async () => {
    setup([rolled(1, null, "Write Q4 plan"), item(2, null, "Buy milk")]);

    fireEvent.click(await screen.findByRole("button", { name: "Add Write Q4 plan to this week" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull());
    expect(within(section("This week")).getByText("Write Q4 plan")).toBeTruthy();
  });

  it("moves a rolled-over item to the backlog", async () => {
    setup([rolled(1, null, "Write Q4 plan")]);

    fireEvent.click(await screen.findByRole("button", { name: "Move Write Q4 plan to the backlog" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull());
    expect(within(section("Backlog")).getByText("Write Q4 plan")).toBeTruthy();
  });

  it("drops a rolled-over item", async () => {
    setup([rolled(1, null, "Write Q4 plan"), item(2, null, "Buy milk")]);

    fireEvent.click(await screen.findByRole("button", { name: "Drop Write Q4 plan" }));

    await waitFor(() => expect(screen.queryByText("Write Q4 plan")).toBeNull());
    expect(screen.getByText("Buy milk")).toBeTruthy();
  });

  it("treats a rolled branch as one: its sub-items show under it, and go with it", async () => {
    setup([rolled(1, null, "Plan trip"), rolled(2, 1, "Book flights"), item(3, null, "Buy milk")]);
    await screen.findByRole("region", { name: "Rolled over" });
    expect(within(section("Rolled over")).getByText("Book flights")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add Plan trip to this week" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull());
    const trip = within(section("This week")).getByText("Plan trip").closest("li")!;
    expect(within(trip).getByText("Book flights")).toBeTruthy();
  });

  it("says what a rolled sub-item is under, when it was rolled without its parent", async () => {
    setup([item(1, null, "Plan trip", true), rolled(2, 1, "Book flights")]);
    await screen.findByRole("region", { name: "Rolled over" });

    expect(within(section("Rolled over")).getByText("in Plan trip")).toBeTruthy();
  });

  it("adds an item straight to the backlog from the backlog's own box", async () => {
    setup([item(2, null, "Buy milk")]);
    await screen.findByRole("region", { name: "Backlog" });

    typeInto("New backlog item", "Learn Spanish");

    await waitFor(() => expect(within(section("Backlog")).getByText("Learn Spanish")).toBeTruthy());
    expect(within(section("This week")).queryByText("Learn Spanish")).toBeNull();
  });

  it("folds a section away and saves that in the panel's state", async () => {
    const { setPanelState } = setup([item(2, null, "Buy milk"), item(3, null, "Someday trip", false, "backlog")]);
    fireEvent.click(await screen.findByRole("button", { name: "Hide the Backlog section" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [], view: "list", foldedSections: ["backlog"] });
    expect(screen.queryByText("Someday trip")).toBeNull();
    expect(screen.getByText("Buy milk")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show the Backlog section" }));
    expect(await screen.findByText("Someday trip")).toBeTruthy();
  });

  it("shows a section folded when the panel was saved that way", async () => {
    setup([item(2, null, "Buy milk"), item(3, null, "Someday trip", false, "backlog")], { ...LIST, foldedSections: ["backlog"] });
    await screen.findByText("Buy milk");

    expect(screen.queryByText("Someday trip")).toBeNull();
    expect(screen.getByRole("button", { name: "Show the Backlog section" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Rolled over on the board", () => {
  const items = [rolled(1, null, "Write Q4 plan", 2), item(2, null, "Buy milk"), rolled(3, null, "Plan trip"), rolled(4, 3, "Book flights")];
  const strip = () => screen.getByRole("region", { name: "Rolled over" });

  it("shows what is rolled over in a strip above the columns, and keeps it out of them", async () => {
    setup(items, BOARD);
    await screen.findByRole("group", { name: "To-do board" });

    expect(within(strip()).getByText("Write Q4 plan")).toBeTruthy();
    expect(within(strip()).getByText("Plan trip")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "To-do" })).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Buy milk"]);
    expect(screen.queryByRole("listitem", { name: "Book flights" })).toBeNull();
  });

  it("has no strip when nothing is rolled over", async () => {
    setup([item(2, null, "Buy milk")], BOARD);
    await screen.findByRole("group", { name: "To-do board" });

    expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull();
  });

  it("adds an item to this week, or to the backlog, or drops it, from the strip", async () => {
    setup(items, BOARD);
    fireEvent.click(await screen.findByRole("button", { name: "Add Write Q4 plan to this week" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "To-do" })).getByLabelText("Write Q4 plan")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Move Plan trip to the backlog" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Backlog" })).getByLabelText("Plan trip")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull();
  });

  it("drops an item from the strip", async () => {
    setup(items, BOARD);

    fireEvent.click(await screen.findByRole("button", { name: "Drop Write Q4 plan" }));

    await waitFor(() => expect(screen.queryByText("Write Q4 plan")).toBeNull());
    expect(within(strip()).getByText("Plan trip")).toBeTruthy();
  });
});

describe("the first-run question", () => {
  const completed = [item(1, null, "Reply to vendor", true), item(2, null, "Send invoice", true), item(3, null, "Write plan")];

  it("asks whether to archive the items already completed, and says what leaving them means", async () => {
    setup(completed, LIST, { setup: { pending: true, completed: 2 } });

    const question = await screen.findByRole("region", { name: "Archive completed items" });

    expect(question.textContent).toContain("Archive 2 items you've already completed?");
    expect(question.textContent).toContain("filed under the weeks they were last changed");
    expect(question.textContent).toMatch(/without a date/);
  });

  it("archives them on a yes, and stops asking", async () => {
    setup(completed, LIST, { setup: { pending: true, completed: 2 } });

    fireEvent.click(await screen.findByRole("button", { name: "Yes, archive them" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Archive completed items" })).toBeNull());
    expect(screen.queryByText("Reply to vendor")).toBeNull();
    expect(screen.getByText("Write plan")).toBeTruthy();
  });

  it("leaves them on a no, and stops asking", async () => {
    setup(completed, LIST, { setup: { pending: true, completed: 2 } });

    fireEvent.click(await screen.findByRole("button", { name: "No, leave them" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Archive completed items" })).toBeNull());
    expect(screen.getByText("Reply to vendor")).toBeTruthy();
  });

  it("says it in the singular for one item, and does not ask when there is nothing to ask about", async () => {
    setup([item(1, null, "Reply to vendor", true)], LIST, { setup: { pending: true, completed: 1 } });
    const question = await screen.findByRole("region", { name: "Archive completed items" });
    expect(question.textContent).toContain("Archive 1 item you've already completed?");
    expect(screen.getByRole("button", { name: "Yes, archive it" })).toBeTruthy();
    cleanup();

    setup(completed);
    await screen.findByRole("region", { name: "This week" });
    expect(screen.queryByRole("region", { name: "Archive completed items" })).toBeNull();
  });
});

describe("the Archive view", () => {
  const archivedItems = [
    { todo: item(10, null, "Plan trip"), reason: "removed" as const, week: "2026-10-25", action: 1 },
    { todo: item(11, 10, "Book flights"), reason: "removed" as const, week: "2026-10-25", action: 1 },
    { todo: { ...item(12, null, "Reply to vendor", true), doneAt: "2026-10-13T15:30:00.000Z" }, reason: "done" as const, week: "2026-10-11" },
    { todo: rolled(13, null, "Old idea"), reason: "dropped" as const, week: "2026-10-11" },
  ];
  const week = (iso: string) => screen.getByRole("region", { name: `Archived in the week of ${iso}` });
  const entry = (title: string) => screen.getByText(title).closest("li")!;

  async function onArchive(initial: Todo[] = [item(1, null, "Buy milk")], options: Parameters<typeof setup>[2] = { archived: archivedItems }) {
    const result = setup(initial, ARCHIVE, options);
    await screen.findAllByRole("region", { name: /^Archived in the week of/ });
    return result;
  }

  it("lists what was archived by the week it happened in, newest week first, each marked done, removed or dropped", async () => {
    await onArchive();

    expect(screen.getAllByRole("region", { name: /^Archived in the week of/ }).map((r) => r.getAttribute("aria-label"))).toEqual([
      "Archived in the week of 2026-10-25",
      "Archived in the week of 2026-10-11",
    ]);
    expect(entry("Plan trip").textContent).toMatch(/Removed/);
    expect(entry("Reply to vendor").textContent).toMatch(/Done/);
    expect(entry("Old idea").textContent).toMatch(/Dropped/);
    expect(within(week("2026-10-11")).getByText("Reply to vendor")).toBeTruthy();
  });

  it("shows a branch archived together as one entry, with its sub-items under it", async () => {
    await onArchive();

    expect(within(entry("Plan trip")).getByText("Book flights")).toBeTruthy();
    expect(within(week("2026-10-25")).getAllByRole("listitem").filter((li) => li.parentElement?.getAttribute("aria-label") === "Archived items")).toHaveLength(1);
  });

  it("has a search box in place of the add box, and shows only what matches", async () => {
    await onArchive();
    expect(screen.queryByRole("textbox", { name: "New to-do" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the archive" }), { target: { value: "VENDOR" } });

    expect(screen.getByText("Reply to vendor")).toBeTruthy();
    expect(screen.queryByText("Plan trip")).toBeNull();
    expect(screen.queryByRole("region", { name: "Archived in the week of 2026-10-25" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the archive" }), { target: { value: "zzz" } });
    expect(screen.getByText(/Nothing in the archive matches/)).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search the archive" }), { target: { value: "" } });
    expect(screen.getByText("Plan trip")).toBeTruthy();
  });

  it("says so when nothing has been archived", async () => {
    setup([], ARCHIVE);

    expect(await screen.findByText("Nothing has been archived yet.")).toBeTruthy();
  });

  it("restores an entry with what was archived with it, and says so", async () => {
    const { todos } = await onArchive();

    fireEvent.click(screen.getByRole("button", { name: "Restore Plan trip" }));

    expect((await screen.findByRole("status")).textContent).toContain("Restored “Plan trip”.");
    await waitFor(() => expect(screen.queryByText("Plan trip", { selector: "span.break-words" })).toBeNull());
    expect(todos.getSnapshot().todos.map((t) => [t.id, t.parentId])).toEqual([[1, null], [10, null], [11, 10]]);
    expect(screen.queryByRole("region", { name: "Archived in the week of 2026-10-25" })).toBeNull();
  });

  it("says when something came back at the top level because what it was under is still archived", async () => {
    const { todos } = await onArchive();

    fireEvent.click(screen.getByRole("button", { name: "Restore Book flights" }));

    expect((await screen.findByRole("status")).textContent).toContain("at the top level");
    expect(todos.getSnapshot().todos.find((t) => t.id === 11)?.parentId).toBeNull();
  });

  it("asks before deleting for good, says how much goes, and lists the reports that mention it with links to open them", async () => {
    const { openNoteBeside } = await onArchive([item(1, null, "Buy milk")], {
      archived: archivedItems,
      reports: { 10: [{ noteId: 7, title: "Weekly 2026-10-25" }, { noteId: 5, title: "Monthly 2026-10" }] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Plan trip permanently" }));

    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByText(/These reports mention it/)).toBeTruthy());
    expect(dialog.textContent).toContain("“Plan trip” and its 1 sub-item will be erased for good");
    expect(dialog.textContent).toMatch(/backup files you made earlier may still contain/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Open Weekly 2026-10-25" }));

    expect(openNoteBeside).toHaveBeenCalledWith(7);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("Plan trip")).toBeTruthy();
  });

  it("deletes for good when confirmed, and says so", async () => {
    const { todos } = await onArchive();

    fireEvent.click(screen.getByRole("button", { name: "Delete Plan trip permanently" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByText("No report mentions it.")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    expect((await screen.findByRole("status")).textContent).toContain("Deleted “Plan trip” permanently.");
    await waitFor(() => expect(screen.queryByText("Book flights")).toBeNull());
    expect(todos.getSnapshot().archive?.map((t) => t.id)).toEqual([12, 13]);
  });

  it("leaves everything alone when the deletion is cancelled", async () => {
    const { todos } = await onArchive();

    fireEvent.click(screen.getByRole("button", { name: "Delete Plan trip permanently" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(todos.getSnapshot().archive).toHaveLength(4);
  });

  it("does not let the deletion be confirmed before the reports have been checked", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const backend = memoryTodosBackend({ archived: archivedItems });
    const preview = backend.previewTodoDelete;
    const todos = createTodosStore({
      ...backend,
      previewTodoDelete: async (id) => {
        await held;
        return preview(id);
      },
    });
    const store = { todos, setPanelState: vi.fn(), openNoteBeside: vi.fn() } as unknown as WorkspaceStore;
    render(<TodoPanel store={store} panelId="p1" state={ARCHIVE} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Plan trip permanently" }));
    const dialog = await screen.findByRole("alertdialog");

    expect((within(dialog).getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Checking the reports…")).toBeTruthy();

    release();
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("switches to the Archive view, saving the choice in the panel's state", async () => {
    const { setPanelState } = setup([item(1, null, "Buy milk")], LIST, { archived: archivedItems });
    await screen.findByRole("region", { name: "This week" });

    fireEvent.click(screen.getByRole("button", { name: "Archive view" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [], view: "archive", foldedSections: [] });
    expect(await screen.findByRole("region", { name: "Archived in the week of 2026-10-25" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive view" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Delete permanently beside Remove", () => {
  const openMenu = (title: string) => fireEvent.pointerDown(screen.getByRole("button", { name: `Actions for ${title}` }), { button: 0, ctrlKey: false });

  it("sits in a small menu on a row of the list, and asks before erasing the item and what is under it", async () => {
    const { todos } = setup([item(1, null, "Plan trip"), item(2, 1, "Book flights"), item(3, null, "Buy milk")]);
    await screen.findByText("Plan trip");

    openMenu("Plan trip");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete permanently…" }));

    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByText("No report mentions it.")).toBeTruthy());
    expect(dialog.textContent).toContain("“Plan trip” and its 1 sub-item will be erased for good");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(screen.queryByText("Plan trip", { selector: "span.break-words" })).toBeNull());
    expect(todos.getSnapshot().todos.map((t) => t.id)).toEqual([3]);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("is on a card of the board too", async () => {
    setup([item(2, null, "Buy milk")], BOARD);
    await screen.findByRole("group", { name: "To-do board" });

    openMenu("Buy milk");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete permanently…" }));

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("keeps Remove a separate, gentler question", async () => {
    setup([item(2, null, "Buy milk")]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Buy milk" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove this to-do?");
    expect(dialog.textContent).not.toContain("erased for good");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Removed “Buy milk”."));
  });
});

describe("the Reports view", () => {
  const report = (noteId: number, kind: "weekly" | "monthly" | "quarterly", periodStart: string, label: string, generated: string) => ({
    noteId,
    title: `${{ weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" }[kind]} ${label} · generated ${generated}`,
    kind,
    periodStart,
    periodEnd: periodStart,
    label,
    generatedAt: `${generated.slice(0, 10)}T${generated.slice(11)}:00.000Z`,
  });
  const data = {
    reports: [
      report(5, "weekly", "2026-10-11", "2026-10-11 → 2026-10-17", "2026-10-19 09:00"),
      report(7, "weekly", "2026-10-18", "2026-10-18 → 2026-10-24", "2026-10-26 09:00"),
      report(9, "monthly", "2026-09-01", "2026-09", "2026-10-02 09:00"),
    ],
    missing: [
      { kind: "weekly" as const, periodStart: "2026-10-04", periodEnd: "2026-10-10", label: "2026-10-04 → 2026-10-10" },
      { kind: "monthly" as const, periodStart: "2026-08-01", periodEnd: "2026-08-31", label: "2026-08" },
    ],
  };
  const sectionOf = (name: string) => screen.getByRole("region", { name });
  const titlesIn = (name: string) => within(sectionOf(name)).queryAllByRole("listitem").map((li) => li.getAttribute("aria-label"));

  async function onReports(options: Parameters<typeof setup>[2] = { todoReports: data }) {
    const result = setup([], REPORTS, options);
    await screen.findByRole("region", { name: "Weekly reports" });
    return result;
  }

  it("lists the reports by Weeks, Months and Quarters, newest period first, each section saying when it has none", async () => {
    await onReports();

    expect(titlesIn("Weekly reports")).toEqual([
      "Weekly 2026-10-18 → 2026-10-24 · generated 2026-10-26 09:00",
      "Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-19 09:00",
    ]);
    expect(titlesIn("Monthly reports")).toEqual(["Monthly 2026-09 · generated 2026-10-02 09:00"]);
    expect(within(sectionOf("Quarterly reports")).getByText("No quarterly reports yet.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "New to-do" })).toBeNull();
  });

  it("opens a report in a note panel beside the to-do panel", async () => {
    const { openNoteBeside } = await onReports();

    fireEvent.click(screen.getByRole("button", { name: "Open Weekly 2026-10-18 → 2026-10-24 · generated 2026-10-26 09:00" }));

    expect(openNoteBeside).toHaveBeenCalledWith(7);
  });

  it("makes another report for the same period with Regenerate, listed first among its copies, and says so", async () => {
    await onReports();

    fireEvent.click(screen.getByRole("button", { name: "Regenerate Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-19 09:00" }));

    await waitFor(() => expect(titlesIn("Weekly reports")).toHaveLength(3));
    expect(titlesIn("Weekly reports")[0]).toBe("Weekly 2026-10-18 → 2026-10-24 · generated 2026-10-26 09:00");
    expect(titlesIn("Weekly reports").filter((t) => t?.includes("2026-10-11 → 2026-10-17"))).toHaveLength(2);
    expect((await screen.findByRole("status")).textContent).toMatch(/^Made a new report for 2026-10-11 → 2026-10-17/);
  });

  it("makes a report for a period that has none from a picker in its section, which then no longer offers it", async () => {
    await onReports();
    const picker = within(sectionOf("Weekly reports")).getByLabelText("Make a weekly report for") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["2026-10-04 → 2026-10-10"]);

    fireEvent.click(within(sectionOf("Weekly reports")).getByRole("button", { name: "Generate a weekly report" }));

    await waitFor(() => expect(titlesIn("Weekly reports")).toHaveLength(3));
    expect(within(sectionOf("Weekly reports")).queryByLabelText("Make a weekly report for")).toBeNull();
    expect(within(sectionOf("Monthly reports")).getByLabelText("Make a monthly report for")).toBeTruthy();
  });

  it("lets the period to make a report for be chosen, newest first", async () => {
    await onReports({
      todoReports: {
        reports: [],
        missing: [
          { kind: "weekly", periodStart: "2026-10-04", periodEnd: "2026-10-10", label: "2026-10-04 → 2026-10-10" },
          { kind: "weekly", periodStart: "2026-10-18", periodEnd: "2026-10-24", label: "2026-10-18 → 2026-10-24" },
        ],
      },
    });
    const picker = within(sectionOf("Weekly reports")).getByLabelText("Make a weekly report for") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["2026-10-18 → 2026-10-24", "2026-10-04 → 2026-10-10"]);

    fireEvent.change(picker, { target: { value: "2026-10-04" } });
    fireEvent.click(within(sectionOf("Weekly reports")).getByRole("button", { name: "Generate a weekly report" }));

    await waitFor(() => expect(titlesIn("Weekly reports")).toHaveLength(1));
    expect(titlesIn("Weekly reports")[0]).toContain("2026-10-04 → 2026-10-10");
  });

  it("switches to the Reports view, saving the choice in the panel's state", async () => {
    const { setPanelState } = setup([item(1, null, "Buy milk")], LIST, { todoReports: data });
    await screen.findByRole("region", { name: "This week" });

    fireEvent.click(screen.getByRole("button", { name: "Reports view" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { collapsed: [], view: "reports", foldedSections: [] });
    expect(await screen.findByRole("region", { name: "Weekly reports" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reports view" }).getAttribute("aria-pressed")).toBe("true");
  });
});

const section = (name: string) => screen.getByRole("region", { name });
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "", types: ["application/x-composition-todo"] });
const rowIn = (region: string, title: string) => within(section(region)).getByText(title).closest("li") as HTMLElement;

async function openList(start: Todo[]) {
  const result = setup(start);
  await screen.findByRole("region", { name: "This week" });
  return result;
}

describe("dragging into This week", () => {
  const items = [
    rolled(1, null, "Plan trip"),
    rolled(2, 1, "Book flights"),
    item(3, null, "Buy milk"),
    item(4, null, "Someday trip", false, "backlog"),
    item(5, 4, "Check visas"),
  ];
  const inList = (start: Todo[] = items) => openList(start);

  it("moves a backlog item to This week when it is dropped there", async () => {
    const { todos } = await inList();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });
    fireEvent.dragOver(section("This week"), { dataTransfer: transfer });
    fireEvent.drop(section("This week"), { dataTransfer: transfer });

    await waitFor(() => expect(within(section("This week")).getByText("Someday trip")).toBeTruthy());
    expect(within(section("Backlog")).queryByText("Someday trip")).toBeNull();
    expect(todos.getSnapshot().todos.find((t) => t.id === 4)).toMatchObject({ status: "todo" });
    // What was under it comes along, as it does everywhere.
    expect(within(rowIn("This week", "Someday trip")).getByText("Check visas")).toBeTruthy();
  });

  it("places a rolled-over entry, with what is rolled under it, when it is dropped on This week", async () => {
    const { todos } = await inList();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("Rolled over", "Plan trip"), { dataTransfer: transfer });
    fireEvent.dragOver(section("This week"), { dataTransfer: transfer });
    fireEvent.drop(section("This week"), { dataTransfer: transfer });

    await waitFor(() => expect(screen.queryByRole("region", { name: "Rolled over" })).toBeNull());
    expect(within(rowIn("This week", "Plan trip")).getByText("Book flights")).toBeTruthy();
    expect(todos.getSnapshot().todos.every((t) => t.rolledFromWeek === undefined)).toBe(true);
  });

  it("shows where it can be dropped while something is dragged, and more so when it is over it", async () => {
    await inList();
    const transfer = dataTransfer();
    expect(section("This week").getAttribute("data-drop-target")).toBeNull();

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });
    expect(section("This week").getAttribute("data-drop-target")).toBe("ready");

    fireEvent.dragOver(section("This week"), { dataTransfer: transfer });
    expect(section("This week").getAttribute("data-drop-target")).toBe("over");

    fireEvent.dragLeave(section("This week"), { dataTransfer: transfer });
    expect(section("This week").getAttribute("data-drop-target")).toBe("ready");

    fireEvent.dragEnd(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });
    expect(section("This week").getAttribute("data-drop-target")).toBeNull();
  });

  it("changes nothing when it is dropped anywhere else, or the drag is given up", async () => {
    const { todos } = await inList();
    const transfer = dataTransfer();
    const before = todos.getSnapshot().todos;

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });
    fireEvent.dragOver(section("Rolled over"), { dataTransfer: transfer });
    fireEvent.drop(section("Rolled over"), { dataTransfer: transfer });
    fireEvent.drop(section("Backlog"), { dataTransfer: transfer });
    fireEvent.dragEnd(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });

    expect(todos.getSnapshot().todos).toEqual(before);
    expect(within(section("Backlog")).getByText("Someday trip")).toBeTruthy();
  });

  it("makes a top-level backlog item and a rolled-over entry draggable, and what is under them too, to rearrange it", async () => {
    await inList();

    expect(rowIn("Backlog", "Someday trip").getAttribute("draggable")).toBe("true");
    expect(rowIn("Rolled over", "Plan trip").getAttribute("draggable")).toBe("true");
    expect(rowIn("Backlog", "Check visas").getAttribute("draggable")).toBe("true");
    expect(rowIn("Rolled over", "Book flights").getAttribute("draggable")).toBe("true");
  });

  it("does not offer This week as a place to drop what is under an item", async () => {
    await inList();

    fireEvent.dragStart(rowIn("Backlog", "Check visas"), { dataTransfer: dataTransfer() });

    expect(section("This week").getAttribute("data-drop-target")).toBeNull();
  });

  it("leaves a drag of something else alone, so a note or a panel dropped on it still goes where it should", async () => {
    await inList();

    const accepted = fireEvent.dragOver(section("This week"), { dataTransfer: { types: ["application/x-composition-note"], dropEffect: "" } });

    expect(accepted).toBe(true); // not cancelled
    expect(section("This week").getAttribute("data-drop-target")).toBeNull();
  });

  it("does not put an item's id in plain text, which a note's editor would take as text to insert", async () => {
    await inList();
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });

    expect(transfer.setData).toHaveBeenCalledWith("application/x-composition-todo", "4");
    expect(transfer.setData).not.toHaveBeenCalledWith("text/plain", expect.anything());
  });
});

describe("dragging back to the Backlog", () => {
  const items = [
    item(1, null, "Buy milk"),
    item(2, 1, "Oat milk"),
    item(3, null, "Plan trip", false, "in_progress"),
    item(4, null, "Pay rent", true),
    item(5, null, "Someday trip", false, "backlog"),
    rolled(6, null, "Old chore"),
  ];

  it("moves a to-do from This week to the Backlog when it is dropped there, and what is under it goes along", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    fireEvent.drop(section("Backlog"), { dataTransfer: transfer });

    await waitFor(() => expect(within(section("Backlog")).getByText("Buy milk")).toBeTruthy());
    expect(within(rowIn("Backlog", "Buy milk")).getByText("Oat milk")).toBeTruthy();
    expect(within(section("This week")).queryByText("Buy milk")).toBeNull();
    expect(todos.getSnapshot().todos.find((t) => t.id === 1)).toMatchObject({ status: "backlog" });
  });

  it("takes one that is in progress too", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Plan trip"), { dataTransfer: transfer });
    fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    fireEvent.drop(section("Backlog"), { dataTransfer: transfer });

    await waitFor(() => expect(within(section("Backlog")).getByText("Plan trip")).toBeTruthy());
    expect(todos.getSnapshot().todos.find((t) => t.id === 3)).toMatchObject({ status: "backlog" });
  });

  it("makes every to-do draggable, to rearrange it, but only a top-level one that is not done a thing to drop on the Backlog", async () => {
    await openList(items);
    const transfer = dataTransfer();

    for (const title of ["Buy milk", "Plan trip", "Oat milk", "Pay rent"]) {
      expect(rowIn("This week", title).getAttribute("draggable")).toBe("true");
    }
    fireEvent.dragStart(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBe("ready");
    fireEvent.dragEnd(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    for (const title of ["Oat milk", "Pay rent"]) {
      fireEvent.dragStart(rowIn("This week", title), { dataTransfer: transfer });
      expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
      fireEvent.dragEnd(rowIn("This week", title), { dataTransfer: transfer });
    }
  });

  it("shows the Backlog as the place to drop a to-do, and This week as nothing, since it is already there", async () => {
    await openList(items);
    const transfer = dataTransfer();
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();

    fireEvent.dragStart(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBe("ready");
    expect(section("This week").getAttribute("data-drop-target")).toBeNull();

    fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBe("over");

    fireEvent.dragLeave(section("Backlog"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBe("ready");

    fireEvent.dragEnd(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
  });

  it("offers each section only what belongs there: the Backlog takes nothing dragged from the Backlog or from Rolled over", async () => {
    await openList(items);

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: dataTransfer() });
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
    expect(section("This week").getAttribute("data-drop-target")).toBe("ready");
    fireEvent.dragEnd(rowIn("Backlog", "Someday trip"));

    fireEvent.dragStart(rowIn("Rolled over", "Old chore"), { dataTransfer: dataTransfer() });
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
  });

  it("changes nothing when a to-do is dropped back on This week or on Rolled over, or the drag is given up", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();
    const before = todos.getSnapshot().todos;

    fireEvent.dragStart(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    const accepted = fireEvent.dragOver(section("This week"), { dataTransfer: transfer });
    fireEvent.drop(section("This week"), { dataTransfer: transfer });
    fireEvent.drop(section("Rolled over"), { dataTransfer: transfer });
    fireEvent.dragEnd(rowIn("This week", "Buy milk"), { dataTransfer: transfer });

    expect(accepted).toBe(true); // not offered, so not cancelled
    expect(todos.getSnapshot().todos).toEqual(before);
    expect(within(section("This week")).getByText("Buy milk")).toBeTruthy();
  });

  it("does not let an item be dropped on the Backlog that was dragged from the Backlog", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();
    const before = todos.getSnapshot().todos;

    fireEvent.dragStart(rowIn("Backlog", "Someday trip"), { dataTransfer: transfer });
    const accepted = fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    fireEvent.drop(section("Backlog"), { dataTransfer: transfer });

    expect(accepted).toBe(true);
    expect(todos.getSnapshot().todos).toEqual(before);
  });
});

describe("rearranging the list", () => {
  const items = [item(1, null, "Plan trip"), item(2, null, "Buy milk"), item(3, null, "Call mum"), item(4, 1, "Book flights"), item(5, 1, "Pack bags")];
  const titlesIn = (region: string) =>
    within(within(section(region)).getByRole("list", { name: region === "Backlog" ? "Backlog items" : "To-dos" }))
      .getAllByRole("checkbox")
      .map((box) => (box.getAttribute("aria-label") ?? "").replace(": done", ""));
  /** The top-level titles only: the sub-items are listed in the row of their item. */
  const topLevel = (region: string) => titlesIn(region).filter((title) => !["Book flights", "Pack bags"].includes(title));
  /** Where the pointer is, in a row: its box has no size in jsdom, so above its top is the upper half and below it the lower half. */
  const aimed = (type: "dragOver" | "drop", target: Element, transfer: ReturnType<typeof dataTransfer>, clientY: number) => {
    const event = createEvent[type](target, { dataTransfer: transfer });
    // jsdom has no DragEvent, so the position is put on the event by hand.
    Object.defineProperty(event, "clientY", { value: clientY });
    fireEvent(target, event);
  };

  it("moves an item down and up with its buttons, and keeps the order", async () => {
    const { todos } = await openList(items);

    fireEvent.click(screen.getByRole("button", { name: "Move Plan trip down" }));
    await waitFor(() => expect(topLevel("This week")).toEqual(["Buy milk", "Plan trip", "Call mum"]));
    fireEvent.click(screen.getByRole("button", { name: "Move Call mum up" }));

    await waitFor(() => expect(topLevel("This week")).toEqual(["Buy milk", "Call mum", "Plan trip"]));
    expect(todos.getSnapshot().todos.filter((t) => t.parentId === null).map((t) => t.title)).toEqual(["Buy milk", "Call mum", "Plan trip"]);
  });

  it("cannot move the first item up or the last item down", async () => {
    await openList(items);

    expect((screen.getByRole("button", { name: "Move Plan trip up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Call mum down" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Book flights up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Pack bags down" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves a sub-item among the sub-items of its item", async () => {
    const { todos } = await openList(items);

    fireEvent.click(screen.getByRole("button", { name: "Move Book flights down" }));

    await waitFor(() => expect(todos.getSnapshot().todos.filter((t) => t.parentId === 1).map((t) => t.title)).toEqual(["Pack bags", "Book flights"]));
    expect(topLevel("This week")).toEqual(["Plan trip", "Buy milk", "Call mum"]);
  });

  it("puts an item dragged onto the upper half of another before it, and onto the lower half after it", async () => {
    await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("dragOver", rowIn("This week", "Plan trip").firstElementChild!, transfer, -1);
    expect(rowIn("This week", "Plan trip").firstElementChild!.getAttribute("data-drop")).toBe("before");
    aimed("drop", rowIn("This week", "Plan trip").firstElementChild!, transfer, -1);
    await waitFor(() => expect(topLevel("This week")).toEqual(["Call mum", "Plan trip", "Buy milk"]));

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("dragOver", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);
    expect(rowIn("This week", "Buy milk").firstElementChild!.getAttribute("data-drop")).toBe("after");
    aimed("drop", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);
    await waitFor(() => expect(topLevel("This week")).toEqual(["Plan trip", "Buy milk", "Call mum"]));
    expect(rowIn("This week", "Buy milk").firstElementChild!.getAttribute("data-drop")).toBeNull();
  });

  it("reorders sub-items by dragging, without dragging their item along or moving anything between sections", async () => {
    const { todos } = await openList([...items, item(6, null, "Someday", false, "backlog")]);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Pack bags"), { dataTransfer: transfer });
    aimed("dragOver", rowIn("This week", "Book flights").firstElementChild!, transfer, -1);
    // A sub-item is not something to drop on a section.
    fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
    aimed("drop", rowIn("This week", "Book flights").firstElementChild!, transfer, -1);

    await waitFor(() => expect(todos.getSnapshot().todos.filter((t) => t.parentId === 1).map((t) => t.title)).toEqual(["Pack bags", "Book flights"]));
    expect(todos.getSnapshot().todos.find((t) => t.id === 1)).toMatchObject({ status: "todo" });
  });

  it("does not reorder an item dropped on a row under another parent, and does not mistake it for a drop on a section", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();
    const before = todos.getSnapshot().todos;

    fireEvent.dragStart(rowIn("This week", "Pack bags"), { dataTransfer: transfer });
    aimed("dragOver", rowIn("This week", "Buy milk").firstElementChild!, transfer, -1);
    aimed("drop", rowIn("This week", "Buy milk").firstElementChild!, transfer, -1);

    expect(todos.getSnapshot().todos).toEqual(before);
  });

  it("keeps a dragged item's status when it is dropped among the other items of This week", async () => {
    const { todos } = await openList([item(1, null, "Plan trip", false, "in_progress"), item(2, null, "Buy milk")]);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Plan trip"), { dataTransfer: transfer });
    aimed("dragOver", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);
    aimed("drop", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);

    await waitFor(() => expect(topLevel("This week")).toEqual(["Buy milk", "Plan trip"]));
    expect(todos.getSnapshot().todos.find((t) => t.id === 1)).toMatchObject({ status: "in_progress" });
  });

  it("lets a done item be rearranged, but not dropped on the Backlog, which would untick it", async () => {
    const { todos } = await openList([item(1, null, "Plan trip", true), item(2, null, "Buy milk"), item(3, null, "Someday", false, "backlog")]);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Plan trip"), { dataTransfer: transfer });
    expect(section("Backlog").getAttribute("data-drop-target")).toBeNull();
    fireEvent.dragOver(section("Backlog"), { dataTransfer: transfer });
    fireEvent.drop(section("Backlog"), { dataTransfer: transfer });
    expect(todos.getSnapshot().todos.find((t) => t.id === 1)).toMatchObject({ status: "done" });

    aimed("dragOver", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);
    aimed("drop", rowIn("This week", "Buy milk").firstElementChild!, transfer, 10);
    await waitFor(() => expect(topLevel("This week")).toEqual(["Buy milk", "Plan trip"]));
  });
});

describe("dragging an item onto another to make it a sub-item", () => {
  const items = [item(1, null, "Plan trip"), item(2, null, "Buy milk"), item(3, null, "Call mum"), item(4, 1, "Book flights"), item(6, null, "Someday", false, "backlog")];
  /** The line of a row, given a size, since jsdom lays nothing out: 40px tall, from 0. */
  const line = (region: string, title: string) => {
    const element = rowIn(region, title).firstElementChild as HTMLElement;
    element.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) });
    return element;
  };
  const aimed = (type: "dragOver" | "drop", target: Element, transfer: ReturnType<typeof dataTransfer>, clientY: number) => {
    const event = createEvent[type](target, { dataTransfer: transfer });
    Object.defineProperty(event, "clientY", { value: clientY });
    return fireEvent(target, event);
  };
  const parentOf = (todos: { getSnapshot(): { todos: Todo[] } }, id: number) => todos.getSnapshot().todos.find((t) => t.id === id)?.parentId;

  it("makes a top-level item the last sub-item of the item it is dropped on the middle of, and says so", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("dragOver", line("This week", "Plan trip"), transfer, 20);
    expect(line("This week", "Plan trip").getAttribute("data-drop")).toBe("inside");
    aimed("drop", line("This week", "Plan trip"), transfer, 20);

    await waitFor(() => expect(parentOf(todos, 3)).toBe(1));
    expect(todos.getSnapshot().todos.filter((t) => t.parentId === 1).map((t) => t.title)).toEqual(["Book flights", "Call mum"]);
    expect(screen.getByRole("status").textContent).toContain("Moved “Call mum” under “Plan trip”.");
    expect(line("This week", "Plan trip").getAttribute("data-drop")).toBeNull();
  });

  it("still puts it before or after the row when it is dropped near the row's top or bottom edge", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("dragOver", line("This week", "Plan trip"), transfer, 5);
    expect(line("This week", "Plan trip").getAttribute("data-drop")).toBe("before");
    aimed("dragOver", line("This week", "Plan trip"), transfer, 35);
    expect(line("This week", "Plan trip").getAttribute("data-drop")).toBe("after");
    aimed("drop", line("This week", "Plan trip"), transfer, 35);

    await waitFor(() => expect(todos.getSnapshot().todos.filter((t) => t.parentId === null && t.status !== "backlog").map((t) => t.title)).toEqual(["Plan trip", "Call mum", "Buy milk"]));
    expect(parentOf(todos, 3)).toBeNull();
  });

  it("puts it back at the top level where it was with Undo", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Buy milk"), { dataTransfer: transfer });
    aimed("drop", line("This week", "Plan trip"), transfer, 20);
    await waitFor(() => expect(parentOf(todos, 2)).toBe(1));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(parentOf(todos, 2)).toBeNull());
    expect(todos.getSnapshot().todos.filter((t) => t.parentId === null && t.status !== "backlog").map((t) => t.title)).toEqual(["Plan trip", "Buy milk", "Call mum"]);
  });

  it("takes it anywhere on a sub-item's row, or a row in the other section, keeping its status", async () => {
    const { todos } = await openList(items);
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("dragOver", line("This week", "Book flights"), transfer, 2);
    expect(line("This week", "Book flights").getAttribute("data-drop")).toBe("inside");
    aimed("drop", line("This week", "Book flights"), transfer, 2);
    await waitFor(() => expect(parentOf(todos, 3)).toBe(4));

    fireEvent.dragStart(rowIn("Backlog", "Someday"), { dataTransfer: transfer });
    aimed("drop", line("This week", "Buy milk"), transfer, 20);
    await waitFor(() => expect(parentOf(todos, 6)).toBe(2));
    expect(todos.getSnapshot().todos.find((t) => t.id === 6)).toMatchObject({ status: "backlog" });
    expect(within(section("This week")).getByText("Someday")).toBeTruthy();
  });

  it("opens a folded item it is dropped on, so the new sub-item shows", async () => {
    const { setPanelState } = setup(items, { ...LIST, collapsed: [1] });
    await screen.findByRole("region", { name: "This week" });
    const transfer = dataTransfer();

    fireEvent.dragStart(rowIn("This week", "Call mum"), { dataTransfer: transfer });
    aimed("drop", line("This week", "Plan trip"), transfer, 20);

    expect(setPanelState).toHaveBeenCalledWith("p1", { ...LIST, collapsed: [] });
    await waitFor(() => expect(within(section("This week")).getByText("Call mum")).toBeTruthy());
  });

  it("does not take an item on itself or on what is under it, nor a sub-item, nor a rolled-over item", async () => {
    const { todos } = await openList([...items, rolled(7, null, "Old chore")]);
    const transfer = dataTransfer();
    const before = todos.getSnapshot().todos;

    fireEvent.dragStart(rowIn("This week", "Plan trip"), { dataTransfer: transfer });
    expect(aimed("dragOver", line("This week", "Book flights"), transfer, 20)).toBe(true); // not offered, so not cancelled
    aimed("drop", line("This week", "Book flights"), transfer, 20);
    expect(aimed("dragOver", line("This week", "Plan trip"), transfer, 20)).toBe(true);
    fireEvent.dragEnd(rowIn("This week", "Plan trip"));

    fireEvent.dragStart(rowIn("This week", "Book flights"), { dataTransfer: transfer });
    expect(aimed("dragOver", line("This week", "Buy milk"), transfer, 20)).toBe(true);
    aimed("drop", line("This week", "Buy milk"), transfer, 20);
    fireEvent.dragEnd(rowIn("This week", "Book flights"));

    fireEvent.dragStart(rowIn("Rolled over", "Old chore"), { dataTransfer: transfer });
    expect(aimed("dragOver", line("This week", "Buy milk"), transfer, 20)).toBe(false); // This week takes it, as before: to place it
    expect(line("This week", "Buy milk").getAttribute("data-drop")).toBeNull();
    fireEvent.dragEnd(rowIn("Rolled over", "Old chore"));

    expect(todos.getSnapshot().todos).toEqual(before);
  });
});

describe("moving the completed to the bottom", () => {
  const titles = (region: string) => within(section(region)).getAllByRole("checkbox").map((box) => (box.getAttribute("aria-label") ?? "").replace(": done", ""));

  it("moves the done items below the open ones, at every level, and keeps the order otherwise", async () => {
    const { todos } = await openList([
      item(1, null, "Plan trip", true),
      item(2, null, "Buy milk"),
      item(3, null, "Call mum", true),
      item(4, null, "Write report"),
      item(5, 4, "Outline", true),
      item(6, 4, "Draft"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Completed to bottom/ }));

    await waitFor(() => expect(titles("This week")).toEqual(["Buy milk", "Write report", "Draft", "Outline", "Plan trip", "Call mum"]));
    expect(todos.getSnapshot().todos.filter((t) => t.parentId === null).map((t) => t.title)).toEqual(["Buy milk", "Write report", "Plan trip", "Call mum"]);
  });

  it("is off while the done items are already last, and on once ticking an item leaves one above an open one", async () => {
    await openList([item(1, null, "Buy milk"), item(2, null, "Call mum"), item(3, null, "Plan trip", true)]);
    expect((screen.getByRole("button", { name: /Completed to bottom/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Buy milk: done" }));

    await waitFor(() => expect((screen.getByRole("button", { name: /Completed to bottom/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("is not shown while there is nothing this week", async () => {
    await openList([]);

    expect(screen.queryByRole("button", { name: /Completed to bottom/ })).toBeNull();
  });
});

describe("priorities", () => {
  const titles = (region: string) => within(section(region)).getAllByRole("checkbox").map((box) => (box.getAttribute("aria-label") ?? "").replace(": done", ""));
  const openPriority = (name: string) => fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false });

  it("sets a priority from the menu on a row, and shows it as a badge", async () => {
    const { todos } = await openList([item(1, null, "Buy milk")]);

    openPriority("Set the priority of Buy milk");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "P2 – High" }));

    await waitFor(() => expect(todos.getSnapshot().todos[0].priority).toBe(2));
    expect(await screen.findByLabelText("Priority P2, High")).toBeTruthy();
  });

  it("changes and clears a priority from its badge", async () => {
    const { todos } = await openList([{ ...item(1, null, "Buy milk"), priority: 3 }]);

    openPriority("Change the priority of Buy milk (now P3, Medium)");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "P1 – Critical" }));
    await waitFor(() => expect(todos.getSnapshot().todos[0].priority).toBe(1));

    openPriority("Change the priority of Buy milk (now P1, Critical)");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "No priority" }));
    await waitFor(() => expect(todos.getSnapshot().todos[0].priority).toBeUndefined());
    expect(screen.queryByLabelText(/^Priority P/)).toBeNull();
  });

  it("offers all five priorities by name", async () => {
    await openList([item(1, null, "Buy milk")]);

    openPriority("Set the priority of Buy milk");

    for (const name of ["P1 – Critical", "P2 – High", "P3 – Medium", "P4 – Low", "P5 – Nice to have"]) {
      expect(await screen.findByRole("menuitemradio", { name })).toBeTruthy();
    }
  });

  it("sorts this week by priority, P1 first and those with none last, and the backlog too", async () => {
    const { todos } = await openList([
      item(1, null, "None"),
      { ...item(2, null, "Low"), priority: 4 },
      { ...item(3, null, "Critical"), priority: 1 },
      { ...item(4, null, "Later low"), priority: 5, status: "backlog" },
      { ...item(5, null, "Later high"), priority: 2, status: "backlog" },
    ]);

    fireEvent.click(within(section("This week")).getByRole("button", { name: /Sort by priority/ }));

    await waitFor(() => expect(titles("This week")).toEqual(["Critical", "Low", "None"]));
    expect(todos.getSnapshot().todos.filter((t) => t.status === "backlog").map((t) => t.title)).toEqual(["Later high", "Later low"]);
    expect(titles("Backlog")).toEqual(["Later high", "Later low"]);
  });

  it("is off while the list is already in priority order", async () => {
    await openList([{ ...item(1, null, "Critical"), priority: 1 }, item(2, null, "None")]);
    const button = () => within(section("This week")).getByRole("button", { name: /Sort by priority/ }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    openPriority("Set the priority of None");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "P1 – Critical" }));
    openPriority("Change the priority of Critical (now P1, Critical)");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "P5 – Nice to have" }));

    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
