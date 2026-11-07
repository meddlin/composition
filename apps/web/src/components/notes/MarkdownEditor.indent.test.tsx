// @vitest-environment jsdom
import { expect, vi } from "vitest";
import { describeParity } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// Indenting and outdenting lines, in the plain Markdown editor and the live one.
describeParity("indenting lines", (scenario) => {
  scenario("Tab indents every line of a multi-line selection instead of replacing it with a tab", ({ render }) => {
    const editor = render({ initial: "one\ntwo\nthree" });
    editor.select(1, 11);

    const notCancelled = editor.press("Tab");

    expect(notCancelled).toBe(false);
    expect(editor.text()).toBe("\tone\n\ttwo\n\tthree");
    expect(editor.selection()).toEqual({ start: 2, end: 14 });
    expect(editor.reported.at(-1)).toBe("\tone\n\ttwo\n\tthree");
  });

  scenario("Tab still types a tab over a selection within one line", ({ render }) => {
    const editor = render({ initial: "one two" });
    editor.select(0, 3);

    editor.press("Tab");

    expect(editor.text()).toBe("\t two");
  });

  scenario("Shift+Tab outdents a multi-line selection, and is left alone (to leave the editor) otherwise", ({ render }) => {
    const editor = render({ initial: "\tone\n\ttwo" });
    editor.select(0, 9);

    expect(editor.press("Tab", { shiftKey: true })).toBe(false);
    expect(editor.text()).toBe("one\ntwo");

    editor.select(1, 1);
    expect(editor.press("Tab", { shiftKey: true })).toBe(true);
    expect(editor.text()).toBe("one\ntwo");
  });

  scenario("Ctrl+] and Ctrl+[ indent and outdent the line at the caret", ({ render }) => {
    const editor = render({ initial: "one\ntwo" });
    editor.select(5, 5);

    editor.press("]", { ctrlKey: true });
    expect(editor.text()).toBe("one\n\ttwo");
    expect(editor.caret()).toBe(6);

    editor.press("[", { ctrlKey: true });
    expect(editor.text()).toBe("one\ntwo");
    expect(editor.caret()).toBe(5);
  });

  scenario("leaves Cmd+] alone, for Forward", ({ render }) => {
    const editor = render({ initial: "one\ntwo" });
    editor.select(0, 7);

    expect(editor.press("]", { metaKey: true })).toBe(true);
    expect(editor.text()).toBe("one\ntwo");
  });
});
