import { describe, expect, it } from "vitest";
import { buildTodoTree, cleanTodoTitle, countDescendants, subtreeIds } from "./todos";
import type { Todo } from "./todosApi";

const todo = (id: number, parentId: number | null, title = `t${id}`): Todo => ({
  id,
  parentId,
  title,
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
