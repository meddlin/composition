import { describe, expect, it } from "vitest";
import { findNoteTrigger, linkTo, matchNotes, MAX_PICKER_NOTES } from "./noteLinks";
import type { Note } from "./types";

const note = (id: number, title: string): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: "",
  updatedAt: "",
  groupId: null,
  notebookId: 1,
});

describe("findNoteTrigger", () => {
  const at = (text: string) => findNoteTrigger(text, text.length);

  it("fires on a bare [[", () => expect(at("[[")).toEqual({ start: 0, query: "" }));
  it("carries what was typed after it", () => expect(at("see [[rel")).toEqual({ start: 4, query: "rel" }));
  it("allows spaces in the query", () => expect(at("[[release che")).toEqual({ start: 0, query: "release che" }));
  it("fires on a later line", () => expect(at("one\n\n[[x")).toEqual({ start: 5, query: "x" }));
  it("uses the caret, not the end of the text", () => {
    expect(findNoteTrigger("[[abc def", 4)).toEqual({ start: 0, query: "ab" });
  });

  it.each(["[", "a [b] c", "[[x]]", "[[x] y", "[[x\ny", "", "no brackets"])("ignores %j", (text) => {
    expect(at(text)).toBeNull();
  });

  it("ignores a [[ inside a fenced code block", () => {
    expect(at("```js\n[[")).toBeNull();
    expect(at("~~~\n[[")).toBeNull();
  });

  it("fires again after a fence closes", () => {
    expect(at("```\ncode\n```\n[[")).toEqual({ start: 13, query: "" });
  });
});

describe("matchNotes", () => {
  const notes = [note(1, "Release checklist"), note(2, "Pre-release notes"), note(3, "Groceries"), note(4, "release plan")];

  it("lists every note for an empty query", () => {
    expect(matchNotes(notes, "").map((n) => n.id)).toEqual([1, 2, 3, 4]);
  });

  it("matches anywhere in the title, ignoring case, titles that start with it first", () => {
    expect(matchNotes(notes, "RELEASE").map((n) => n.id)).toEqual([1, 4, 2]);
  });

  it("leaves out the note being edited", () => {
    expect(matchNotes(notes, "release", 1).map((n) => n.id)).toEqual([4, 2]);
  });

  it("finds a note with no title as Untitled", () => {
    expect(matchNotes([note(5, "  ")], "untit").map((n) => n.id)).toEqual([5]);
  });

  it("offers a limited number", () => {
    const many = Array.from({ length: 30 }, (_, i) => note(i + 1, `Note ${i}`));
    expect(matchNotes(many, "")).toHaveLength(MAX_PICKER_NOTES);
  });

  it("returns nothing when nothing matches", () => {
    expect(matchNotes(notes, "zzz")).toEqual([]);
  });
});

describe("linkTo", () => {
  it("uses the title by default and the given words when there are some", () => {
    expect(linkTo(note(7, "Release checklist"))).toBe("[Release checklist](note:7)");
    expect(linkTo(note(7, "Release checklist"), "the checklist")).toBe("[the checklist](note:7)");
    expect(linkTo(note(7, "Release checklist"), "  ")).toBe("[Release checklist](note:7)");
  });
});
