import { describe, expect, it } from "vitest";
import { indentCommandFor, indentLines, type IndentEdit } from "./indentLines";

/** The text after the edit, and the selection in it, as the editor would show them. */
function apply(text: string, edit: IndentEdit | null) {
  if (!edit) return null;
  return { text: text.slice(0, edit.start) + edit.text + text.slice(edit.end), selection: edit.selection };
}

describe("indentLines", () => {
  it("indents every line the selection touches, and keeps the same text selected", () => {
    const text = "one\ntwo\nthree";
    // From the middle of "one" to the middle of "three".
    const result = apply(text, indentLines(text, 1, 11, "indent"));
    expect(result?.text).toBe("\tone\n\ttwo\n\tthree");
    expect(result?.selection).toEqual({ start: 2, end: 14 });
  });

  it("leaves out the last line when the selection ends at its very start", () => {
    const text = "one\ntwo\nthree";
    expect(apply(text, indentLines(text, 0, 8, "indent"))?.text).toBe("\tone\n\ttwo\nthree");
  });

  it("does not indent an empty line", () => {
    const text = "a\n\nb";
    expect(apply(text, indentLines(text, 0, 4, "indent"))?.text).toBe("\ta\n\n\tb");
  });

  it("indents the line a bare caret is on", () => {
    const text = "one\ntwo";
    const result = apply(text, indentLines(text, 5, 5, "indent"));
    expect(result?.text).toBe("one\n\ttwo");
    expect(result?.selection).toEqual({ start: 6, end: 6 });
  });

  it("stacks tabs on an already-indented line, as for a nested list", () => {
    const text = "- a\n\t- b";
    expect(apply(text, indentLines(text, 0, text.length, "indent"))?.text).toBe("\t- a\n\t\t- b");
  });

  it("outdents a tab, or up to four spaces, from each line", () => {
    const text = "\tone\n      two\n  three\nfour";
    expect(apply(text, indentLines(text, 0, text.length, "outdent"))?.text).toBe("one\n  two\nthree\nfour");
  });

  it("moves the selection back with an outdent, but not past the start of the line", () => {
    const text = "\tone\n\ttwo";
    // The caret sits inside the tab's width on the second line: start of "two"'s line + 1.
    const result = apply(text, indentLines(text, 1, 6, "outdent"));
    expect(result?.text).toBe("one\ntwo");
    expect(result?.selection).toEqual({ start: 0, end: 4 });
  });

  it("is null when there is nothing to outdent", () => {
    expect(indentLines("one\ntwo", 0, 7, "outdent")).toBeNull();
  });

  it("is null when indenting only empty lines", () => {
    expect(indentLines("\n\n", 0, 2, "indent")).toBeNull();
  });
});

describe("indentCommandFor", () => {
  const key = (key: string, init: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {}) => ({
    key,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...init,
  });
  const text = "one\ntwo";
  const across = { start: 0, end: 7 };
  const caret = { start: 2, end: 2 };
  const within = { start: 0, end: 3 };

  it("takes Tab and Shift+Tab only when the selection spans lines", () => {
    expect(indentCommandFor(key("Tab"), text, across)).toBe("indent");
    expect(indentCommandFor(key("Tab", { shiftKey: true }), text, across)).toBe("outdent");
    expect(indentCommandFor(key("Tab"), text, caret)).toBeNull();
    expect(indentCommandFor(key("Tab"), text, within)).toBeNull();
    expect(indentCommandFor(key("Tab", { shiftKey: true }), text, caret)).toBeNull();
  });

  it("takes Ctrl+] and Ctrl+[ wherever the caret is", () => {
    expect(indentCommandFor(key("]", { ctrlKey: true }), text, caret)).toBe("indent");
    expect(indentCommandFor(key("[", { ctrlKey: true }), text, caret)).toBe("outdent");
  });

  it("leaves Cmd+[ and Cmd+] to Back and Forward, and other chords alone", () => {
    expect(indentCommandFor(key("]", { metaKey: true }), text, across)).toBeNull();
    expect(indentCommandFor(key("[", { metaKey: true }), text, across)).toBeNull();
    expect(indentCommandFor(key("Tab", { altKey: true }), text, across)).toBeNull();
    expect(indentCommandFor(key("]", { ctrlKey: true, shiftKey: true }), text, across)).toBeNull();
  });
});
