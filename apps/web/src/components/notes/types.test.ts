import { describe, expect, it } from "vitest";
import { noteTitle, type Note } from "./types";

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
