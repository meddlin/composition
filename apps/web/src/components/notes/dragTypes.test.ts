import { describe, expect, it } from "vitest";
import { draggedNoteId, GROUP_DRAG_TYPE, hasDraggedNote, NOTE_DRAG_TYPE, PANE_DRAG_TYPE } from "./dragTypes";

function payload(entries: Record<string, string>) {
  return {
    types: Object.keys(entries),
    getData: (type: string) => entries[type] ?? "",
  };
}

describe("hasDraggedNote", () => {
  it("accepts a note from the sidebar or from a pane header", () => {
    expect(hasDraggedNote([NOTE_DRAG_TYPE])).toBe(true);
    expect(hasDraggedNote([PANE_DRAG_TYPE])).toBe(true);
  });

  it("refuses groups and anything else", () => {
    expect(hasDraggedNote([GROUP_DRAG_TYPE])).toBe(false);
    expect(hasDraggedNote(["text/plain", "Files"])).toBe(false);
    expect(hasDraggedNote([])).toBe(false);
  });
});

describe("draggedNoteId", () => {
  it("reads the id from either kind of note drag", () => {
    expect(draggedNoteId(payload({ [NOTE_DRAG_TYPE]: "12" }))).toBe(12);
    expect(draggedNoteId(payload({ [PANE_DRAG_TYPE]: "7" }))).toBe(7);
  });

  it.each([[""], ["abc"], ["1.5"]])("returns null for the payload %j", (raw) => {
    expect(draggedNoteId(payload({ [NOTE_DRAG_TYPE]: raw }))).toBeNull();
  });

  it("returns null when no note is being dragged", () => {
    expect(draggedNoteId(payload({ [GROUP_DRAG_TYPE]: "3" }))).toBeNull();
    expect(draggedNoteId(payload({}))).toBeNull();
  });
});
