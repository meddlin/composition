import { describe, expect, it } from "vitest";
import { archiveGroups, buildTodoTree, cleanTodoTitle, countDescendants, nestTodo, placeTodo, sortByPriority, sortDoneLast, subtreeIds, todoSections, withDone, withPriority, withStatus } from "./todos";
import type { ArchivedTodo, Todo, TodoPriority } from "./todosApi";

const todo = (id: number, parentId: number | null, title = `t${id}`): Todo => ({
  id,
  parentId,
  title,
  status: "todo",
  done: false,
  createdAt: "",
  updatedAt: "",
});

describe("buildTodoTree", () => {
  it("nests sub-items under their item, in order", () => {
    const tree = buildTodoTree([todo(1, null), todo(2, 1), todo(3, null), todo(4, 2), todo(5, 1)]);

    expect(tree.map((n) => n.todo.id)).toEqual([1, 3]);
    expect(tree[0].children.map((n) => n.todo.id)).toEqual([2, 5]);
    expect(tree[0].children[0].children.map((n) => n.todo.id)).toEqual([4]);
  });

  it("leaves out an item whose parent is missing", () => {
    expect(buildTodoTree([todo(2, 9)])).toEqual([]);
  });
});

describe("subtreeIds and countDescendants", () => {
  const todos = [todo(1, null), todo(2, 1), todo(3, 2), todo(4, null), todo(5, 1)];

  it("collect the item and everything under it, at any depth", () => {
    expect([...subtreeIds(todos, 1)].sort()).toEqual([1, 2, 3, 5]);
    expect(countDescendants(todos, 1)).toBe(3);
    expect(countDescendants(todos, 4)).toBe(0);
  });

  it("find sub-items listed before their parent", () => {
    expect(countDescendants([todo(3, 2), todo(2, 1), todo(1, null)], 1)).toBe(2);
  });
});

describe("cleanTodoTitle", () => {
  it("trims and puts the title on one line", () => {
    expect(cleanTodoTitle("  Buy \n  milk ")).toBe("Buy milk");
  });

  it("refuses an empty or over-long title", () => {
    expect(cleanTodoTitle("   ")).toBeNull();
    expect(cleanTodoTitle("x".repeat(501))).toBeNull();
    expect(cleanTodoTitle("x".repeat(500))).not.toBeNull();
  });
});

describe("withStatus and withDone", () => {
  it("keeps done in step with the status", () => {
    expect(withStatus(todo(1, null), "done")).toMatchObject({ status: "done", done: true });
    expect(withStatus({ ...todo(1, null), status: "done", done: true }, "in_progress")).toMatchObject({ status: "in_progress", done: false });
  });

  it("ticks an item to done, and unticks a done item back to to-do", () => {
    const ticked = withDone({ ...todo(1, null), status: "in_progress" }, true);
    expect(ticked).toMatchObject({ status: "done", done: true });
    expect(withDone(ticked, false)).toMatchObject({ status: "todo", done: false });
  });

  it("leaves an item that is not done where it is when unticked", () => {
    expect(withDone({ ...todo(1, null), status: "backlog" }, false)).toMatchObject({ status: "backlog", done: false });
  });
});

describe("todoSections", () => {
  const rolled = (id: number, parentId: number | null, rollCount = 1): Todo => ({ ...todo(id, parentId), rolledFromWeek: "2026-10-18", rollCount });
  const backlog = (id: number, parentId: number | null = null): Todo => ({ ...todo(id, parentId), status: "backlog" });
  const ids = (nodes: { todo: Todo; children: unknown[] }[]) => nodes.map((n) => n.todo.id);

  it("puts rolled-over items in Rolled over, the backlog in Backlog, and the rest in This week", () => {
    const { rolledOver, thisWeek, backlog: inBacklog } = todoSections([todo(1, null), rolled(2, null), backlog(3), todo(4, null), { ...todo(5, null), status: "done", done: true }]);

    expect(ids(rolledOver)).toEqual([2]);
    expect(ids(thisWeek)).toEqual([1, 4, 5]);
    expect(ids(inBacklog)).toEqual([3]);
  });

  it("keeps the sub-items of an item with it, whatever their own status", () => {
    const { thisWeek, backlog: inBacklog } = todoSections([todo(1, null), backlog(2, 1), backlog(3), todo(4, 3)]);

    expect(thisWeek[0].children.map((n) => n.todo.id)).toEqual([2]);
    expect(inBacklog[0].children.map((n) => n.todo.id)).toEqual([4]);
  });

  it("shows a rolled branch as one, with all that is under it", () => {
    const { rolledOver, thisWeek } = todoSections([rolled(1, null), rolled(2, 1), todo(3, 1), todo(4, null)]);

    expect(ids(rolledOver)).toEqual([1]);
    expect(rolledOver[0].children.map((n) => n.todo.id)).toEqual([2, 3]);
    expect(ids(thisWeek)).toEqual([4]);
  });

  it("lists a rolled sub-item of an item that was not rolled in Rolled over, and not twice", () => {
    const { rolledOver, thisWeek } = todoSections([{ ...todo(1, null), status: "done", done: true }, rolled(2, 1), { ...todo(3, 1), status: "done", done: true }]);

    expect(ids(rolledOver)).toEqual([2]);
    expect(ids(thisWeek)).toEqual([1]);
    expect(thisWeek[0].children.map((n) => n.todo.id)).toEqual([3]);
  });

  it("lists the rolled items in the order they were made, and leaves out an item whose parent is missing", () => {
    const { rolledOver, thisWeek, backlog: inBacklog } = todoSections([rolled(3, null), rolled(7, null), todo(9, 99)]);

    expect(ids(rolledOver)).toEqual([3, 7]);
    expect(thisWeek).toEqual([]);
    expect(inBacklog).toEqual([]);
  });

  it("lets the rolled mark win over the backlog status", () => {
    const { rolledOver, backlog: inBacklog } = todoSections([{ ...backlog(1), rolledFromWeek: "2026-10-18" }]);

    expect(ids(rolledOver)).toEqual([1]);
    expect(inBacklog).toEqual([]);
  });
});

describe("archiveGroups", () => {
  const archived = (
    id: number,
    parentId: number | null,
    title: string,
    week: string,
    reason: ArchivedTodo["archiveReason"] = "removed",
    archivedAt = "2026-10-28T12:00:00.000Z",
  ): ArchivedTodo => ({ id, parentId, title, status: "todo", createdAt: "", archivedAt, archiveWeek: week, archiveReason: reason });
  const titlesOf = (...items: ArchivedTodo[]) => new Map(items.map((t) => [t.id, t.title]));
  const names = (nodes: { todo: ArchivedTodo; children: unknown[] }[]) => nodes.map((n) => n.todo.title);

  it("groups by the week archived, newest week first", () => {
    const items = [archived(1, null, "a", "2026-10-11"), archived(2, null, "b", "2026-10-25"), archived(3, null, "c", "2026-10-18"), archived(4, null, "d", "2026-10-25")];

    const groups = archiveGroups(items, titlesOf(...items), "");

    expect(groups.map((g) => [g.week, names(g.entries)])).toEqual([
      ["2026-10-25", ["b", "d"]],
      ["2026-10-18", ["c"]],
      ["2026-10-11", ["a"]],
    ]);
  });

  it("keeps a branch archived together, as one entry with its sub-items under it", () => {
    const items = [archived(1, null, "Plan trip", "2026-10-25"), archived(2, 1, "Book flights", "2026-10-25"), archived(3, 2, "Aisle seat", "2026-10-25"), archived(4, null, "Reply", "2026-10-25")];

    const [group] = archiveGroups(items, titlesOf(...items), "");

    expect(names(group.entries)).toEqual(["Plan trip", "Reply"]);
    expect(names(group.entries[0].children)).toEqual(["Book flights"]);
    expect(names(group.entries[0].children[0].children)).toEqual(["Aisle seat"]);
  });

  it("files a sub-item archived on its own, in another week, under that week, and says what it was under", () => {
    const items = [archived(1, null, "Plan trip", "2026-10-25"), archived(2, 1, "Book flights", "2026-10-18", "done")];
    const titles = titlesOf(...items);

    const groups = archiveGroups(items, titles, "");

    expect(groups.map((g) => g.week)).toEqual(["2026-10-25", "2026-10-18"]);
    expect(groups[1].entries[0]).toMatchObject({ todo: { title: "Book flights" }, parentTitle: "Plan trip" });
    expect(groups[0].entries[0].parentTitle).toBeNull();
  });

  it("knows the title of a parent that is still on the list, or none when it cannot be found", () => {
    const items = [archived(2, 1, "Book flights", "2026-10-18", "done"), archived(3, 99, "Orphan", "2026-10-18")];
    const titles = new Map([[1, "Plan trip"], ...titlesOf(...items)]);

    const [group] = archiveGroups(items, titles, "");

    expect(group.entries.map((e) => e.parentTitle)).toEqual(["Plan trip", null]);
  });

  it("lists what was archived most recently first, and what went at the same moment in the order it was made", () => {
    const items = [
      archived(1, null, "swept a", "2026-10-25", "done", "2026-11-01T00:05:00.000Z"),
      archived(2, null, "removed late", "2026-10-25", "removed", "2026-10-30T09:00:00.000Z"),
      archived(3, null, "swept b", "2026-10-25", "done", "2026-11-01T00:05:00.000Z"),
    ];

    const [group] = archiveGroups(items, titlesOf(...items), "");

    expect(names(group.entries)).toEqual(["swept a", "swept b", "removed late"]);
  });

  it("filters by what is typed, ignoring case, leaving out weeks with nothing in them", () => {
    const items = [archived(1, null, "Plan trip", "2026-10-25"), archived(2, null, "Reply to vendor", "2026-10-18"), archived(3, null, "Book TRIP insurance", "2026-10-18")];

    const groups = archiveGroups(items, titlesOf(...items), "  trip ");

    expect(groups.map((g) => [g.week, names(g.entries)])).toEqual([
      ["2026-10-25", ["Plan trip"]],
      ["2026-10-18", ["Book TRIP insurance"]],
    ]);
    expect(archiveGroups(items, titlesOf(...items), "zzz")).toEqual([]);
  });

  it("shows a sub-item that matches without the parent that does not, as an entry of its own", () => {
    const items = [archived(1, null, "Plan trip", "2026-10-25"), archived(2, 1, "Book flights", "2026-10-25")];

    const [group] = archiveGroups(items, titlesOf(...items), "flights");

    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]).toMatchObject({ todo: { title: "Book flights" }, parentTitle: "Plan trip", children: [] });
  });

  it("is empty when nothing is archived", () => {
    expect(archiveGroups([], new Map(), "")).toEqual([]);
  });
});

describe("placeTodo", () => {
  const ids = (todos: Todo[]) => todos.map((t) => t.id);

  it("puts an item before another among its siblings, leaving everything else where it is", () => {
    const todos = [todo(1, null), todo(2, 1), todo(3, null), todo(4, 1), todo(5, null)];

    expect(ids(placeTodo(todos, 5, 3))).toEqual([1, 2, 5, 4, 3]);
    expect(ids(placeTodo(todos, 4, 2))).toEqual([1, 4, 3, 2, 5]);
  });

  it("puts it last among its siblings when there is nothing to go before, or that is not a sibling", () => {
    const todos = [todo(1, null), todo(2, 1), todo(3, null), todo(4, null)];

    expect(ids(placeTodo(todos, 1, null))).toEqual([3, 2, 4, 1]);
    expect(ids(placeTodo(todos, 1, 2))).toEqual([3, 2, 4, 1]);
    expect(ids(placeTodo(todos, 1, 99))).toEqual([3, 2, 4, 1]);
  });

  it("leaves the list as it is for an item dropped before itself, or one that is not there", () => {
    const todos = [todo(1, null), todo(2, null), todo(3, null)];

    expect(ids(placeTodo(todos, 2, 2))).toEqual([1, 2, 3]);
    expect(ids(placeTodo(todos, 9, 1))).toEqual([1, 2, 3]);
  });
});

describe("nestTodo", () => {
  const shape = (todos: Todo[]) => todos.map((t) => [t.id, t.parentId]);

  it("makes an item, with what is under it, the last sub-item of another, or puts it before one of them", () => {
    const todos = [todo(1, null), todo(2, 1), todo(3, null), todo(4, 3), todo(5, null)];

    expect(shape(nestTodo(todos, 3, 1, null))).toEqual([[1, null], [2, 1], [3, 1], [4, 3], [5, null]]);
    expect(shape(nestTodo(todos, 5, 1, 2))).toEqual([[1, null], [5, 1], [3, null], [4, 3], [2, 1]]);
  });

  it("brings a sub-item back to the top level, before the item given", () => {
    const todos = [todo(1, null), todo(2, 1), todo(3, null)];

    expect(shape(nestTodo(todos, 2, null, 3))).toEqual([[1, null], [2, null], [3, null]]);
    expect(nestTodo(todos, 2, null, 3).filter((t) => t.parentId === null).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("leaves the list as it is for an item put under itself or under one of its own sub-items, or one that is not there", () => {
    const todos = [todo(1, null), todo(2, 1), todo(3, 2)];

    expect(nestTodo(todos, 1, 1, null)).toEqual(todos);
    expect(nestTodo(todos, 1, 3, null)).toEqual(todos);
    expect(nestTodo(todos, 9, 1, null)).toEqual(todos);
  });
});

describe("sortDoneLast", () => {
  const done = (id: number, parentId: number | null): Todo => ({ ...todo(id, parentId), status: "done", done: true });
  const ids = (todos: Todo[]) => todos.map((t) => t.id);

  it("moves the done items below the open ones among their siblings, each keeping its order", () => {
    const todos = [done(1, null), todo(2, null), done(3, null), todo(4, null)];

    expect(ids(sortDoneLast(todos))).toEqual([2, 4, 1, 3]);
  });

  it("does it at every level, and keeps a done item with the siblings it has", () => {
    const todos = [todo(1, null), done(2, 1), todo(3, 1), done(4, null), todo(5, null)];

    expect(ids(sortDoneLast(todos))).toEqual([1, 3, 2, 5, 4]);
  });

  it("changes nothing when the done items are already last", () => {
    const todos = [todo(1, null), todo(2, 1), done(3, 1), done(4, null)];

    expect(ids(sortDoneLast(todos))).toEqual([1, 2, 3, 4]);
  });
});

describe("withPriority", () => {
  it("sets a priority, replaces it, and clears it with null", () => {
    const set = withPriority(todo(1, null), 2);
    expect(set.priority).toBe(2);
    expect(withPriority(set, 5).priority).toBe(5);
    expect("priority" in withPriority(set, null)).toBe(false);
  });
});

describe("sortByPriority", () => {
  const ranked = (id: number, parentId: number | null, priority?: TodoPriority): Todo => ({ ...todo(id, parentId), ...(priority && { priority }) });
  const ids = (todos: Todo[]) => todos.map((t) => t.id);

  it("puts P1 first and the items with no priority last, equal ones keeping their order", () => {
    const todos = [ranked(1, null), ranked(2, null, 3), ranked(3, null, 1), ranked(4, null, 3), ranked(5, null, 5), ranked(6, null, 2)];

    expect(ids(sortByPriority(todos))).toEqual([3, 6, 2, 4, 5, 1]);
  });

  it("sorts the sub-items among themselves and keeps them with their parent's list", () => {
    const todos = [ranked(1, null, 4), ranked(2, 1, 5), ranked(3, 1, 1), ranked(4, null, 2)];

    const sorted = sortByPriority(todos);
    expect(ids(sorted.filter((t) => t.parentId === null))).toEqual([4, 1]);
    expect(ids(sorted.filter((t) => t.parentId === 1))).toEqual([3, 2]);
  });

  it("changes nothing when they are already in order", () => {
    const todos = [ranked(1, null, 1), ranked(2, null, 2), ranked(3, null)];

    expect(ids(sortByPriority(todos))).toEqual([1, 2, 3]);
  });
});
