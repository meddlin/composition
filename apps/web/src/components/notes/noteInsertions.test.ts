import { afterEach, describe, expect, it, vi } from "vitest";
import { appendMarkdown, insertIntoOpenNote, placeMarkdown, registerNoteInserter } from "./noteInsertions";

const apply = (text: string, selection: { start: number; end: number }, bodyStart: number, markdown: string, how: "block" | "inline") => {
  const p = placeMarkdown(text, selection, bodyStart, markdown, how);
  const next = text.slice(0, p.start) + p.text + text.slice(p.end);
  return { next, caretAt: p.start + p.caret };
};

describe("placeMarkdown, a block", () => {
  const quote = "> words\n> — [T](pdf:x)";

  it("goes under a paragraph set apart by a blank line, and leaves the caret under it", () => {
    const text = "---\ntitle: T\n---\nfirst paragraph";
    const { next, caretAt } = apply(text, { start: text.length, end: text.length }, 17, quote, "block");

    expect(next).toBe(`${text}\n\n${quote}\n\n`);
    expect(caretAt).toBe(next.length);
  });

  it("needs only one more newline after a line that ends with one, and none after a blank line", () => {
    const one = "---\n---\nline\n";
    const two = "---\n---\nline\n\n";

    expect(apply(one, { start: one.length, end: one.length }, 8, quote, "block").next).toBe(`${one}\n${quote}\n\n`);
    expect(apply(two, { start: two.length, end: two.length }, 8, quote, "block").next).toBe(`${two}${quote}\n\n`);
  });

  it("splits a paragraph at the caret, with a blank line each side", () => {
    const text = "abcdef";
    const { next } = apply(text, { start: 3, end: 3 }, 0, quote, "block");

    expect(next).toBe(`abc\n\n${quote}\n\ndef`);
  });

  it("does not add blank lines the text already has after the caret", () => {
    const text = "para one\n\npara two";
    const at = "para one".length;

    expect(apply(text, { start: at, end: at }, 0, quote, "block").next).toBe(`para one\n\n${quote}\n\npara two`);
    const single = "para one\npara two";
    expect(apply(single, { start: at, end: at }, 0, quote, "block").next).toBe(`para one\n\n${quote}\n\npara two`);
  });

  it("replaces the selection", () => {
    const text = "keep DROP keep";

    expect(apply(text, { start: 5, end: 9 }, 0, quote, "block").next).toBe(`keep \n\n${quote}\n\n keep`);
  });

  it("goes at the start of the body, not in the frontmatter, when the caret is in the frontmatter or the note is empty", () => {
    const text = "---\ntitle: T\n---\n";

    expect(apply(text, { start: 6, end: 6 }, 17, quote, "block").next).toBe(`${text}${quote}\n\n`);
    expect(apply("", { start: 0, end: 0 }, 0, quote, "block").next).toBe(`${quote}\n\n`);
  });

  it("clamps a selection that is past the end of the text", () => {
    expect(apply("abc", { start: 40, end: 50 }, 0, quote, "block").next).toBe(`abc\n\n${quote}\n\n`);
  });
});

describe("placeMarkdown, inline", () => {
  const link = "[T, p. 3](pdf:x#p=3)";

  it("goes in as it is, after a space unless one is there already", () => {
    expect(apply("see ", { start: 4, end: 4 }, 0, link, "inline").next).toBe(`see ${link}`);
    expect(apply("see", { start: 3, end: 3 }, 0, link, "inline").next).toBe(`see ${link}`);
    expect(apply("see\n", { start: 4, end: 4 }, 0, link, "inline").next).toBe(`see\n${link}`);
  });

  it("starts the body without a space, replaces a selection, and leaves the caret after it", () => {
    expect(apply("---\n---\n", { start: 0, end: 0 }, 8, link, "inline").next).toBe(`---\n---\n${link}`);
    const { next, caretAt } = apply("see HERE now", { start: 4, end: 8 }, 0, link, "inline");
    expect(next).toBe(`see ${link} now`);
    expect(caretAt).toBe(4 + link.length);
  });
});

describe("appendMarkdown", () => {
  it("adds a paragraph at the end, with one blank line before it", () => {
    expect(appendMarkdown("text", "> q")).toBe("text\n\n> q\n");
    expect(appendMarkdown("text\n", "> q")).toBe("text\n\n> q\n");
    expect(appendMarkdown("text\n\n", "> q")).toBe("text\n\n> q\n");
    expect(appendMarkdown("", "> q")).toBe("> q\n");
  });
});

describe("the registry of open editors", () => {
  const unregister: (() => void)[] = [];
  afterEach(() => unregister.splice(0).forEach((u) => u()));

  it("hands the Markdown to the editor open for the note, and says whether there was one", () => {
    const inserter = vi.fn();
    unregister.push(registerNoteInserter(5, inserter));

    expect(insertIntoOpenNote(5, "> q", "block")).toBe(true);
    expect(inserter).toHaveBeenCalledWith("> q", "block");
    expect(insertIntoOpenNote(6, "> q", "block")).toBe(false);
  });

  it("uses the later editor when a note is open twice, and the earlier again once it closes", () => {
    const first = vi.fn();
    const second = vi.fn();
    unregister.push(registerNoteInserter(5, first));
    const closeSecond = registerNoteInserter(5, second);

    insertIntoOpenNote(5, "a", "inline");
    closeSecond();
    insertIntoOpenNote(5, "b", "inline");

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith("b", "inline");
  });

  it("forgets an editor that has closed", () => {
    const close = registerNoteInserter(5, vi.fn());
    close();

    expect(insertIntoOpenNote(5, "a", "inline")).toBe(false);
  });
});
