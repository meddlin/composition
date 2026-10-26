import { describe, expect, it } from "vitest";
import { noteExcerpt, pinnedItems, recentNotes, relativeTime } from "./homeListing";
import type { Group, Note, Notebook } from "./types";

const notebook = (id: number): Notebook => ({ id, name: `Notebook ${id}`, createdAt: "", updatedAt: "" });
const group = (id: number, notebookId: number): Group => ({ id, name: `Group ${id}`, parentId: null, notebookId, createdAt: "", updatedAt: "" });

function note(id: number, updatedAt: string): Note {
  return { id, title: `n${id}`, content: "", tags: "", description: "", createdAt: "", updatedAt, groupId: null, notebookId: 1 };
}

describe("recentNotes", () => {
  it("orders newest first and caps the list", () => {
    const notes = [note(1, "2026-01-01T00:00:00Z"), note(2, "2026-03-01T00:00:00Z"), note(3, "2026-02-01T00:00:00Z")];
    expect(recentNotes(notes, 2).map((n) => n.id)).toEqual([2, 3]);
  });
});

describe("recentNotes options", () => {
  const notes = [
    { ...note(1, "2026-01-01T00:00:00Z"), notebookId: 1 },
    { ...note(2, "2026-03-01T00:00:00Z"), notebookId: 2 },
    { ...note(3, "2026-02-01T00:00:00Z"), notebookId: 1 },
    { ...note(4, "2026-04-01T00:00:00Z"), notebookId: 2 },
  ];

  it("can be limited to one notebook", () => {
    expect(recentNotes(notes, 12, { notebookId: 1 }).map((n) => n.id)).toEqual([3, 1]);
    expect(recentNotes(notes, 12, { notebookId: null }).map((n) => n.id)).toEqual([4, 2, 3, 1]);
  });

  it("orders by when notes were opened, then by edit for the ones never opened", () => {
    const opened = { 1: 300, 3: 100 };
    expect(recentNotes(notes, 12, { sort: "opened", opened }).map((n) => n.id)).toEqual([1, 3, 4, 2]);
  });

  it("falls back to the edit order when nothing was opened", () => {
    expect(recentNotes(notes, 12, { sort: "opened", opened: {} }).map((n) => n.id)).toEqual([4, 2, 3, 1]);
  });

  it("applies the notebook limit and the count after ordering", () => {
    expect(recentNotes(notes, 1, { sort: "opened", opened: { 3: 5, 1: 9 }, notebookId: 1 }).map((n) => n.id)).toEqual([1]);
  });
});

describe("pinnedItems", () => {
  const notebooks = [notebook(1), notebook(2)];
  const groups = [group(10, 1), group(11, 2)];
  const notes = [note(1, "2026-01-01T00:00:00Z"), note(2, "2026-03-01T00:00:00Z")];

  it("lists pinned notebooks first, then notes and groups in pin order", () => {
    const favorites = [
      { type: "note" as const, id: 2 },
      { type: "group" as const, id: 11 },
      { type: "note" as const, id: 1 },
    ];
    const items = pinnedItems(notebooks, groups, notes, favorites, [2, 1]);
    expect(items.map((i) => (i.kind === "notebook" ? `nb${i.notebook.id}` : i.kind === "group" ? `g${i.group.id}` : `n${i.note.id}`))).toEqual([
      "nb2",
      "nb1",
      "n2",
      "g11",
      "n1",
    ]);
  });

  it("skips pins whose notebook, group or note is gone", () => {
    const favorites = [
      { type: "note" as const, id: 99 },
      { type: "group" as const, id: 99 },
      { type: "note" as const, id: 1 },
    ];
    expect(pinnedItems(notebooks, groups, notes, favorites, [7, 1])).toHaveLength(2);
  });
});

describe("noteExcerpt", () => {
  it("drops frontmatter and markdown markup", () => {
    const content = "---\ntitle: T\n---\n# Heading\n\nSome **bold** and a [link](http://x.y).";
    expect(noteExcerpt(content)).toBe("Heading Some bold and a link.");
  });
  it("truncates long text", () => {
    expect(noteExcerpt("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  it("describes recent and older times", () => {
    expect(relativeTime("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-23T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-23T07:00:00Z", now)).toBe("5 hr ago");
    expect(relativeTime("2026-10-22T11:00:00Z", now)).toBe("1 day ago");
  });
});
