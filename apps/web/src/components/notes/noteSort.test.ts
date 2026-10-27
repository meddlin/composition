// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { isNoteSort, resetNoteSort, setNoteSort, sortNotes } from "./noteSort";
import type { Note } from "./types";

function note(id: number, createdAt: string, updatedAt: string): Note {
  return { id, title: `n${id}`, content: "", groupId: null, createdAt, updatedAt } as Note;
}

const notes = [
  note(1, "2026-01-02", "2026-03-01"),
  note(2, "2026-01-01", "2026-05-01"),
  note(3, "2026-01-03", "2026-04-01"),
];
const ids = (list: Note[]) => list.map((n) => n.id);

describe("sortNotes", () => {
  it("leaves custom order untouched", () => {
    expect(sortNotes(notes, "custom")).toBe(notes);
  });

  it("sorts by created date in both directions", () => {
    expect(ids(sortNotes(notes, "created-asc"))).toEqual([2, 1, 3]);
    expect(ids(sortNotes(notes, "created-desc"))).toEqual([3, 1, 2]);
  });

  it("sorts by updated date in both directions", () => {
    expect(ids(sortNotes(notes, "updated-asc"))).toEqual([1, 3, 2]);
    expect(ids(sortNotes(notes, "updated-desc"))).toEqual([2, 3, 1]);
  });

  it("does not mutate its input", () => {
    const before = ids(notes);
    sortNotes(notes, "updated-desc");
    expect(ids(notes)).toEqual(before);
  });
});

describe("note sort preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetNoteSort();
  });

  it("recognizes only known sorts", () => {
    expect(isNoteSort("updated-asc")).toBe(true);
    expect(isNoteSort("alphabetical")).toBe(false);
  });

  it("persists the choice", () => {
    setNoteSort("created-asc");
    expect(window.localStorage.getItem("composition.noteSort")).toBe("created-asc");
  });
});
