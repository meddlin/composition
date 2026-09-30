import { describe, expect, it } from "vitest";
import { canMoveGroup, wouldCreateCycle } from "./groupMove";

// 1 ─ 2 ─ 3   and a separate root 4
const groups = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
];

describe("wouldCreateCycle", () => {
  it("rejects a group as its own parent", () => {
    expect(wouldCreateCycle(groups, 2, 2)).toBe(true);
  });

  it("rejects moving a group under any of its descendants", () => {
    expect(wouldCreateCycle(groups, 1, 2)).toBe(true);
    expect(wouldCreateCycle(groups, 1, 3)).toBe(true);
  });

  it("allows an unrelated parent, a sibling branch and the top level", () => {
    expect(wouldCreateCycle(groups, 1, 4)).toBe(false);
    expect(wouldCreateCycle(groups, 3, 4)).toBe(false);
    expect(wouldCreateCycle(groups, 3, null)).toBe(false);
  });

  it("terminates on already-corrupt data", () => {
    const looped = [
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
      { id: 3, parentId: null },
    ];
    expect(wouldCreateCycle(looped, 3, 1)).toBe(false);
  });
});

describe("canMoveGroup", () => {
  it("is false for a no-op move to the current parent", () => {
    expect(canMoveGroup(groups, 2, 1)).toBe(false);
    expect(canMoveGroup(groups, 1, null)).toBe(false);
  });

  it("is false for an unknown group", () => {
    expect(canMoveGroup(groups, 99, null)).toBe(false);
  });

  it("is true for a legal reparent", () => {
    expect(canMoveGroup(groups, 3, 4)).toBe(true);
    expect(canMoveGroup(groups, 2, null)).toBe(true);
  });
});
