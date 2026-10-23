import { describe, expect, it } from "vitest";
import { noteExcerpt, recentNotes, relativeTime } from "./homeListing";
import type { Note } from "./types";

function note(id: number, updatedAt: string): Note {
  return { id, title: `n${id}`, content: "", tags: "", description: "", createdAt: "", updatedAt, groupId: null, notebookId: 1 };
}

describe("recentNotes", () => {
  it("orders newest first and caps the list", () => {
    const notes = [note(1, "2026-01-01T00:00:00Z"), note(2, "2026-03-01T00:00:00Z"), note(3, "2026-02-01T00:00:00Z")];
    expect(recentNotes(notes, 2).map((n) => n.id)).toEqual([2, 3]);
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
