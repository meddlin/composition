// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readPaneSelection } from "./paneSelection";

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

function pane(editorText = "The quick brown fox", previewText = "Preview text here") {
  document.body.innerHTML = `<section id="pane"><textarea>${editorText}</textarea><div data-note-preview><p id="p">${previewText}</p></div></section><div id="outside">elsewhere</div>`;
  return {
    section: document.getElementById("pane")!,
    textarea: document.querySelector("textarea")!,
    preview: document.getElementById("p")!,
  };
}

const selectNode = (node: Node) => {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.addRange(range);
};

describe("readPaneSelection", () => {
  it("reads what is selected in the editor, even while the editor does not have focus", () => {
    const { section, textarea } = pane();
    textarea.setSelectionRange(4, 9);
    expect(readPaneSelection(section)).toBe("quick");
  });

  it("reads what is selected in the preview", () => {
    const { section, preview } = pane();
    selectNode(preview);
    expect(readPaneSelection(section)).toBe("Preview text here");
  });

  it("is empty when nothing is selected", () => {
    const { section, textarea } = pane();
    textarea.setSelectionRange(3, 3);
    expect(readPaneSelection(section)).toBe("");
  });

  it("ignores a selection somewhere else on the page", () => {
    const { section } = pane();
    selectNode(document.getElementById("outside")!);
    expect(readPaneSelection(section)).toBe("");
  });

  it("prefers the editor's selection when both have one", () => {
    const { section, textarea, preview } = pane();
    textarea.setSelectionRange(0, 3);
    selectNode(preview);
    expect(readPaneSelection(section)).toBe("The");
  });

  it("copes with a pane that has no editor, as when only the preview is showing", () => {
    document.body.innerHTML = `<section id="pane"><div data-note-preview><p id="p">Only preview</p></div></section>`;
    selectNode(document.getElementById("p")!);
    expect(readPaneSelection(document.getElementById("pane")!)).toBe("Only preview");
  });
});
