// @vitest-environment jsdom
import { expect, vi } from "vitest";
import { describeParity } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// The driver is what the parity suites trust, so each of its moves is checked on both editors.
describeParity("the parity harness's driver", (scenario) => {
  scenario("starts with the note's text and no selection", ({ render }) => {
    const editor = render({ initial: "hello" });

    expect(editor.text()).toBe("hello");
    expect(editor.reported).toEqual([]);
  });

  scenario("types a whole text with the caret at the end, and says what it reported", ({ render }) => {
    const editor = render();

    editor.type("one two");

    expect(editor.text()).toBe("one two");
    expect(editor.caret()).toBe(7);
    expect(editor.selection()).toEqual({ start: 7, end: 7 });
    expect(editor.reported).toEqual(["one two"]);
  });

  scenario("types with the caret somewhere else", ({ render }) => {
    const editor = render();

    editor.type("one two", 3);

    expect(editor.caret()).toBe(3);
  });

  scenario("selects a range", ({ render }) => {
    const editor = render({ initial: "one two three" });

    editor.select(4, 7);

    expect(editor.selection()).toEqual({ start: 4, end: 7 });
    expect(editor.caret()).toBe(4);
  });

  scenario("reports a key that changes the text, and says whether the key was cancelled", ({ render }) => {
    const editor = render();
    editor.type("ab", 1);

    const notCancelled = editor.press("Tab");

    expect(notCancelled).toBe(false);
    expect(editor.text()).toBe("a\tb");
    expect(editor.reported.at(-1)).toBe("a\tb");
  });

  scenario("hands out the element that has the caret", ({ render }) => {
    const editor = render();

    editor.type("x");

    expect(editor.element().isConnected).toBe(true);
    expect(editor.element().getAttribute("aria-label")).toBe("Markdown editor");
  });
});
