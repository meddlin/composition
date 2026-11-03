// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { expect, vi } from "vitest";
import { describeParity, type EditorDriver } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

/** The ruler of the editor that is showing (the Markdown tab's stays in the page, hidden, beside the live one). */
const rulerOf = (editor: EditorDriver) =>
  editor.element().closest("[role=tabpanel]")!.querySelector<HTMLElement>("[data-testid=editor-ruler]");

// The ruler and reflow, in the plain Markdown editor and the live one.
describeParity("the editor's ruler", (scenario) => {
  scenario("is not drawn unless switched on", ({ render }) => {
    const editor = render({ writing: { rulerColumn: 72 } });

    expect(rulerOf(editor)).toBeNull();
  });

  scenario("is drawn at the chosen column, counted in the editor's own characters", ({ render }) => {
    const editor = render({ writing: { rulerEnabled: true, rulerColumn: 72 } });

    const ruler = rulerOf(editor)!;
    expect(ruler.getAttribute("aria-hidden")).toBe("true");
    expect((ruler.firstElementChild as HTMLElement).style.left).toContain("72ch");
  });

  scenario("never changes the text", ({ render }) => {
    const editor = render({ writing: { rulerEnabled: true, rulerColumn: 20 } });

    editor.typeKeys("the quick brown fox jumps over the lazy dog");

    expect(editor.text()).toBe("the quick brown fox jumps over the lazy dog");
  });
});

describeParity("the editor's reflow", (scenario) => {
  const on = { reflowEnabled: true, reflowColumn: 20 };

  scenario("does nothing unless switched on", ({ render }) => {
    const editor = render({ writing: { reflowColumn: 20 } });

    editor.typeKeys("the quick brown fox jumps over the lazy dog");

    expect(editor.text()).toBe("the quick brown fox jumps over the lazy dog");
  });

  scenario("breaks a line as it is typed past the column, and keeps typing after the break", ({ render }) => {
    const editor = render({ writing: on });

    editor.typeKeys("the quick brown fox jumps over the lazy dog");

    expect(editor.text()).toBe("the quick brown fox\njumps over the lazy\ndog");
    expect(editor.caret()).toBe(editor.text().length);
  });

  scenario("lines a list item's continuation up under its text", ({ render }) => {
    const editor = render({ writing: on });

    editor.typeKeys("- the quick brown fox jumps");

    expect(editor.text()).toBe("- the quick brown\n  fox jumps");
  });

  scenario("leaves a table row whole, unless asked to break it", ({ render }) => {
    const row = "| the quick brown fox | jumps over |";
    const kept = render({ writing: on });
    kept.typeKeys(row);
    expect(kept.text()).toBe(row);
  });

  scenario("breaks a table row when asked to", ({ render }) => {
    const editor = render({ writing: { ...on, reflowKeepsTables: false } });

    editor.typeKeys("| the quick brown fox | jumps over |");

    expect(editor.text()).toBe("| the quick brown\nfox | jumps over |");
  });

  scenario("leaves pasted text, and text that is not being typed, alone", ({ render, mode }) => {
    const editor = render({ writing: on });
    const long = "the quick brown fox jumps over the lazy dog";

    if (mode === "markdown") {
      fireEvent.input(editor.element(), { target: { value: long }, inputType: "insertFromPaste" });
    } else {
      editor.paste([], long);
    }
    expect(editor.text()).toBe(long);

    editor.type(`${long}!`);
    expect(editor.text()).toBe(`${long}!`);
  });
});
