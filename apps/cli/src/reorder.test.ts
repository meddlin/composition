import { describe, expect, it } from "vitest";
import type { Group, Note } from "./backend";
import { placementFor } from "./reorder";
import type { TreeRow } from "./tree";

const stamp = "2026-01-01T00:00:00.000Z";
const note = (id: number, groupId: number | null = null): Note =>
  ({ id, title: `Note ${id}`, content: "", groupId, createdAt: stamp, updatedAt: stamp }) as Note;
const group = (id: number, parentId: number | null = null): Group => ({ id, name: `Group ${id}`, parentId, notebookId: 1, createdAt: stamp, updatedAt: stamp });

const noteRow = (noteId: number, extra: Partial<TreeRow> = {}) =>
  ({ kind: "note", key: `note:${noteId}`, noteId, label: "", depth: 1, pinned: false, ...extra }) as TreeRow;
const groupRow = (groupId: number | null, extra: Partial<TreeRow> = {}) =>
  ({ kind: "group", key: `group:${groupId}`, groupId, label: "", depth: 0, expanded: true, pinned: false, ...extra }) as TreeRow;

// Display order within group 1: notes 10, 11, 12. Other groups' notes are interleaved on purpose.
const notes = [note(10, 1), note(20, 2), note(11, 1), note(12, 1), note(30)];
const groups = [group(1), group(2), group(3), group(4, 1), group(5, 1)];

describe("placementFor a note", () => {
  it("moves up by going before the previous sibling in its group", () => {
    expect(placementFor(noteRow(11), "up", notes, groups)).toEqual({ type: "note", id: 11, groupId: 1, beforeId: 10 });
  });

  it("moves down by going before the sibling after the next one", () => {
    expect(placementFor(noteRow(10), "down", notes, groups)).toEqual({ type: "note", id: 10, groupId: 1, beforeId: 12 });
  });

  it("moves down past the second-to-last sibling to last place", () => {
    expect(placementFor(noteRow(11), "down", notes, groups)).toEqual({ type: "note", id: 11, groupId: 1, beforeId: null });
  });

  it("has nowhere to go from the first or last place", () => {
    expect(placementFor(noteRow(10), "up", notes, groups)).toBeNull();
    expect(placementFor(noteRow(12), "down", notes, groups)).toBeNull();
    expect(placementFor(noteRow(30), "up", notes, groups)).toBeNull();
  });

  it("orders ungrouped notes among themselves", () => {
    const loose = [note(1), note(2), note(3)];
    expect(placementFor(noteRow(2), "up", loose, [])).toEqual({ type: "note", id: 2, groupId: null, beforeId: 1 });
  });

  it("ignores a favorites shortcut", () => {
    expect(placementFor(noteRow(11, { favorite: true }), "up", notes, groups)).toBeNull();
  });
});

describe("placementFor a group", () => {
  it("moves among the groups with the same parent", () => {
    expect(placementFor(groupRow(2), "up", notes, groups)).toEqual({ type: "group", id: 2, parentId: null, beforeId: 1 });
    expect(placementFor(groupRow(1), "down", notes, groups)).toEqual({ type: "group", id: 1, parentId: null, beforeId: 3 });
    expect(placementFor(groupRow(4), "down", notes, groups)).toEqual({ type: "group", id: 4, parentId: 1, beforeId: null });
  });

  it("has nowhere to go from the first or last place", () => {
    expect(placementFor(groupRow(1), "up", notes, groups)).toBeNull();
    expect(placementFor(groupRow(3), "down", notes, groups)).toBeNull();
    expect(placementFor(groupRow(4), "up", notes, groups)).toBeNull();
  });

  it("ignores the Ungrouped bucket, a favorites shortcut and other rows", () => {
    expect(placementFor(groupRow(null), "down", notes, groups)).toBeNull();
    expect(placementFor(groupRow(2, { favorite: true }), "up", notes, groups)).toBeNull();
    expect(placementFor({ kind: "trash", key: "trash", label: "", depth: 0 }, "up", notes, groups)).toBeNull();
    expect(placementFor(undefined, "up", notes, groups)).toBeNull();
  });
});
