import { describe, expect, it } from "vitest";
import { rowText } from "./Tree";
import type { TreeRow } from "../tree";

const group = (extra: Partial<Extract<TreeRow, { kind: "group" }>> = {}): TreeRow => ({
  kind: "group",
  key: "group:1",
  groupId: 1,
  label: "Work",
  depth: 0,
  expanded: true,
  pinned: false,
  ...extra,
});
const note = (extra: Partial<Extract<TreeRow, { kind: "note" }>> = {}): TreeRow => ({
  kind: "note",
  key: "note:1",
  noteId: 1,
  label: "Plan",
  depth: 1,
  pinned: false,
  ...extra,
});

describe("rowText", () => {
  it("shows a fold marker on a group and indents by depth", () => {
    expect(rowText(group())).toBe("▾ Work");
    expect(rowText(group({ expanded: false }))).toBe("▸ Work");
    expect(rowText(group({ depth: 2 }))).toBe("    ▾ Work");
  });

  it("indents a note past its group's marker", () => {
    expect(rowText(note())).toBe("    Plan");
  });

  it("stars what is pinned, where it sits in the tree", () => {
    expect(rowText(group({ pinned: true }))).toBe("▾ Work ★");
    expect(rowText(note({ pinned: true }))).toBe("    Plan ★");
  });

  it("shows a favorites entry without a star or a fold marker", () => {
    expect(rowText(note({ pinned: true, favorite: true }))).toBe("    Plan");
    expect(rowText(group({ pinned: true, favorite: true, depth: 1, expanded: false }))).toBe("  ◆ Work");
  });

  it("gives the Favorites section a fold marker, and plain rows their label", () => {
    expect(rowText({ kind: "section", key: "favorites", label: "★ Favorites", depth: 0, expanded: true })).toBe("▾ ★ Favorites");
    expect(rowText({ kind: "section", key: "favorites", label: "★ Favorites", depth: 0, expanded: false })).toBe("▸ ★ Favorites");
    expect(rowText({ kind: "settings", key: "settings", label: "⚙ Settings", depth: 0 })).toBe("⚙ Settings");
  });
});
