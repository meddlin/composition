// @vitest-environment jsdom
import { expect, vi } from "vitest";
import { describeParity } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// Bold and italic from the keyboard, in the plain Markdown editor and the live one.
describeParity("bold and italic shortcuts", (scenario) => {
  scenario("Ctrl+B bolds the selection and Ctrl+I italicizes it", ({ render }) => {
    const editor = render({ initial: "a word here" });
    editor.select(2, 6);

    const notCancelled = editor.press("b", { ctrlKey: true });

    expect(notCancelled).toBe(false);
    expect(editor.text()).toBe("a **word** here");
    expect(editor.selection()).toEqual({ start: 4, end: 8 });
    expect(editor.reported.at(-1)).toBe("a **word** here");

    editor.press("i", { ctrlKey: true });
    expect(editor.text()).toBe("a ***word*** here");
  });

  scenario("Cmd+B and Cmd+I work the same", ({ render }) => {
    const editor = render({ initial: "word" });
    editor.select(0, 4);

    editor.press("i", { metaKey: true });
    expect(editor.text()).toBe("*word*");
    editor.press("b", { metaKey: true });
    expect(editor.text()).toBe("***word***");
  });

  scenario("pressing it again takes the emphasis off", ({ render }) => {
    const editor = render({ initial: "a word here" });
    editor.select(2, 6);

    editor.press("b", { ctrlKey: true });
    editor.press("b", { ctrlKey: true });

    expect(editor.text()).toBe("a word here");
    expect(editor.selection()).toEqual({ start: 2, end: 6 });
  });

  scenario("is left alone with nothing selected", ({ render }) => {
    const editor = render({ initial: "a word here" });
    editor.select(3, 3);

    expect(editor.press("b", { ctrlKey: true })).toBe(true);
    expect(editor.text()).toBe("a word here");
  });
});
