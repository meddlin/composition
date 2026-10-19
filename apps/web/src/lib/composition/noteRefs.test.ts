import { describe, expect, it } from "vitest";
import { noteIdFromRef, noteLink, noteRef } from "./noteRefs";

describe("noteRef / noteIdFromRef", () => {
  it("round-trips a note's id", () => {
    expect(noteRef(42)).toBe("note:42");
    expect(noteIdFromRef(noteRef(42))).toBe(42);
  });

  it.each([
    "note:",
    "note:abc",
    "note:-1",
    "note:1.5",
    "note:42/extra",
    "note: 42",
    "Note:42",
    "https://example.com/note:42",
    "#note:42",
    "note:99999999999999999999",
    "",
  ])("does not treat %j as a note link", (href) => {
    expect(noteIdFromRef(href)).toBeNull();
  });
});

describe("noteLink", () => {
  it("is Markdown link syntax pointing at the id", () => {
    expect(noteLink("Release checklist", 42)).toBe("[Release checklist](note:42)");
  });

  it("escapes brackets and backslashes in the text", () => {
    expect(noteLink("a [b] c\\d", 1)).toBe("[a \\[b\\] c\\\\d](note:1)");
  });

  it("keeps the text on one line", () => {
    expect(noteLink("two\nlines", 1)).toBe("[two lines](note:1)");
  });

  it("falls back to Untitled for empty text", () => {
    expect(noteLink("  ", 1)).toBe("[Untitled](note:1)");
  });
});
