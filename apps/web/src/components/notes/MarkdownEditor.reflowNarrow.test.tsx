// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEditor } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// Reflow breaks a line at a column counted in characters; the pane wraps it at a width counted in pixels. In a pane
// narrower than the column the text has already wrapped on screen by the time reflow acts, so a break at the column
// lands part-way along a row and looks like a newline that came too soon. Reflow leaves such a line alone: the pane
// is already keeping it in view, and a hard break would also tie the saved text to the width of the window.

const LINE_HEIGHT = 24;

/** The row the character after `before` sits on when each row holds `width` characters and breaks fall between words. */
function rowAfter(before: string, width: number): number {
  let row = 0;
  const lines = before.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) row += 1;
    let used = 0;
    for (const word of line.split(/(?<= )/)) {
      if (used > 0 && used + word.trimEnd().length > width) {
        row += 1;
        used = 0;
      }
      used += word.length;
    }
  });
  return row;
}

/**
 * jsdom does no layout, so the copy of the textarea that `caretCoordinates` measures has every character at the top.
 * This puts each one on the row it would be on in a pane `rowWidth` characters wide.
 */
function paneWrapsAt(rowWidth: number) {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    if (this.parentElement?.style.visibility !== "hidden") return 0;
    return rowAfter(this.previousSibling?.textContent ?? "", rowWidth) * LINE_HEIGHT;
  });
}

const SENTENCE = "the quick brown fox jumps over the lazy dog";
const reflowAt40 = { reflowEnabled: true, reflowColumn: 40 };

describe("reflow in a narrow pane", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("breaks at the column when the pane is wide enough to show it", () => {
    paneWrapsAt(80);
    const editor = renderEditor("markdown", { writing: reflowAt40 });

    editor.typeKeys(SENTENCE);

    expect(editor.text()).toBe("the quick brown fox jumps over the lazy\ndog");
  });

  it("does not break a line the pane has already wrapped before the column", () => {
    paneWrapsAt(25);
    const editor = renderEditor("markdown", { writing: reflowAt40 });

    editor.typeKeys(SENTENCE);

    expect(editor.text()).toBe(SENTENCE);
    expect(editor.caret()).toBe(SENTENCE.length);
  });

  it("breaks again once the pane is wide enough, as the line is typed on", () => {
    paneWrapsAt(25);
    const editor = renderEditor("markdown", { writing: reflowAt40 });
    editor.typeKeys(SENTENCE);

    paneWrapsAt(80);
    editor.typeKeys("!");

    expect(editor.text()).toBe("the quick brown fox jumps over the lazy\ndog!");
  });

  it("only looks at the line being typed, not the rows above it", () => {
    paneWrapsAt(25);
    const editor = renderEditor("markdown", { writing: reflowAt40, initial: "a short line\n" });
    editor.type("a short line\n");

    editor.typeKeys("the quick brown fox");

    expect(editor.text()).toBe("a short line\nthe quick brown fox");
  });
});
