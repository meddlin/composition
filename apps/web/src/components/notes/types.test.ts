import { describe, expect, it } from "vitest";
import { applySavedNote, noteTitle, type Note } from "./types";

const note = (title: string) => ({ title }) as Note;

describe("noteTitle", () => {
  it("returns the trimmed title", () => {
    expect(noteTitle(note("  Hello  "))).toBe("Hello");
  });

  it("falls back to Untitled for empty or whitespace titles", () => {
    expect(noteTitle(note(""))).toBe("Untitled");
    expect(noteTitle(note("   "))).toBe("Untitled");
  });
});

describe("applySavedNote", () => {
  const make = (id: number, overrides: Partial<Note> = {}): Note => ({
    id,
    title: `Note ${id}`,
    content: `content ${id}`,
    tags: "",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    ...overrides,
  });

  it("keeps the local content instead of the server's re-rendered copy", () => {
    const saved = make(1, { content: "server content" });

    const [result] = applySavedNote([make(1, { content: "typed since" })], saved);

    expect(result.content).toBe("typed since");
  });

  it("takes the server's metadata", () => {
    const saved = make(1, {
      title: "Renamed",
      tags: "a,b",
      description: "d",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });

    const [result] = applySavedNote([make(1)], saved);

    expect(result).toMatchObject({
      title: "Renamed",
      tags: "a,b",
      description: "d",
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
  });

  it("leaves other notes untouched", () => {
    const others = [make(2), make(3)];

    const result = applySavedNote([make(1), ...others], make(1, { title: "x" }));

    expect(result.slice(1)).toEqual(others);
  });

  it("does nothing when the note is no longer in the list", () => {
    const notes = [make(2)];

    expect(applySavedNote(notes, make(1))).toEqual(notes);
  });
});
