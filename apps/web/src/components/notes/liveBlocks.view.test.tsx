// @vitest-environment jsdom
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEditor } from "./LiveEditor";
import { LiveBlockHost } from "./liveBlockWidget";
import { liveBlockKinds, liveBlocks, liveBlocksField, REDRAW_DELAY, TABLE } from "./liveBlocks";

// jsdom lays nothing out and has no Range rects. A drawn block asks the editor to measure once it has rendered, and
// that measure (run on an animation frame, sometimes after a test is done) reads text through them.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const TABLE_1 = "| Name | Count |\n|---|---|\n| apples | 3 |";
const DOC = `Before\n\n${TABLE_1}\n\nAfter`;
const FROM = DOC.indexOf("| Name");
const TO = FROM + TABLE_1.length;

const views: EditorView[] = [];

/** An editor with the block layer over `doc`, parsed to the end, with the caret at `caret`. */
function editor(doc: string, caret: number, extensions = [liveBlocks(new LiveBlockHost())]) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: caret }, extensions: [history(), markdown({ base: markdownLanguage }), extensions] }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  views.push(view);
  return view;
}

const tableIn = (view: EditorView) => view.dom.querySelector(".cm-live-block table");

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  cleanup();
  vi.useRealTimers();
});

describe("a table drawn in the Live tab", () => {
  it("is a real table, with Preview's markup and its cells readable, in place of its source", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(tableIn(view)).not.toBeNull());
    const table = tableIn(view)!;
    expect([...table.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Name", "Count"]);
    expect([...table.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["apples", "3"]);
    // Drawn inside Preview's `prose`, so the same styles apply.
    expect(table.closest(".prose")).not.toBeNull();
    // The source is not in the text, and assistive tech is told about the table.
    expect(view.contentDOM.textContent).not.toContain("|---|");
    expect(table.closest(".cm-live-block")!.getAttribute("aria-hidden")).toBeNull();
    // Hidden is not deleted.
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("puts the caret at the start of its source when it is clicked, and the source shows with the drawing under it", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(tableIn(view)).not.toBeNull());
    const block = view.dom.querySelector<HTMLElement>(".cm-live-block")!;
    block.querySelector("td")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.selection.main.head).toBe(FROM);
    expect(view.contentDOM.textContent).toContain("|---|---|");
    const beside = view.dom.querySelector(".cm-live-block-beside");
    expect(beside).not.toBeNull();
    // The drawing under its own source is a repeat of it, so assistive tech reads only the source.
    expect(beside!.getAttribute("aria-hidden")).toBe("true");
  });

  it("redraws the drawing under a table being typed in only once typing has paused", async () => {
    vi.useFakeTimers();
    const view = editor(DOC, FROM + 2);
    // The caret started in the table, so its drawing comes after the first pause.
    expect(view.dom.querySelector(".cm-live-block")).toBeNull();
    await act(async () => void vi.advanceTimersByTime(REDRAW_DELAY));
    expect(view.dom.querySelector(".cm-live-block-beside")).not.toBeNull();

    const cell = DOC.indexOf("3 |");
    view.dispatch({ changes: { from: cell, insert: "1" }, selection: { anchor: cell + 1 } });
    await act(async () => void vi.advanceTimersByTime(REDRAW_DELAY - 50));
    view.dispatch({ changes: { from: cell + 1, insert: "2" }, selection: { anchor: cell + 2 } });
    await act(async () => void vi.advanceTimersByTime(REDRAW_DELAY - 50));
    // Each key put the redraw off again: the drawing is still the table as it was.
    expect(view.dom.querySelector(".cm-live-block-beside td:last-child")!.textContent).toBe("3");
    await act(async () => void vi.advanceTimersByTime(50));
    expect(view.dom.querySelector(".cm-live-block-beside td:last-child")!.textContent).toBe("123");
  });

  it("is drawn again after an undo that takes back its deletion", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(tableIn(view)).not.toBeNull());
    view.dispatch({ changes: { from: FROM - 2, to: TO + 2 }, userEvent: "delete" });
    expect(view.dom.querySelector(".cm-live-block")).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
    view.dispatch({ selection: { anchor: DOC.length } });
    await waitFor(() => expect(tableIn(view)).not.toBeNull());
  });

  it("is only one React root per table, kept while typing elsewhere", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(tableIn(view)).not.toBeNull());
    const table = tableIn(view);
    view.dispatch({ changes: { from: DOC.length, insert: " more" }, selection: { anchor: DOC.length + 5 } });
    view.dispatch({ changes: { from: 0, insert: "Way " }, selection: { anchor: 4 } });
    await waitFor(() => expect(tableIn(view)).toBe(table));
  });
});

describe("a block that handles its own clicks", () => {
  // Step 6 draws MDX components this way; an HTML block stands in for one here.
  const kinds = [liveBlockKinds.of(TABLE), liveBlockKinds.of({ node: "HTMLBlock", ownsClicks: true })];
  const html = "<Info>\nInside the callout.\n</Info>";
  const doc = `Before\n\n${html}\n\nAfter`;

  it("leaves clicks to the drawing, and has an Edit source button that puts the caret in its source", async () => {
    const view = editor(doc, doc.length, [liveBlocks(new LiveBlockHost()), ...kinds]);
    await waitFor(() => expect(view.dom.querySelector(".cm-live-block-body")?.textContent).toContain("Inside the callout."));
    const block = view.dom.querySelector<HTMLElement>(".cm-live-block")!;
    block.querySelector(".cm-live-block-body *")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.selection.main.head).toBe(doc.length);

    const button = block.querySelector<HTMLButtonElement>(".cm-live-block-edit")!;
    expect(button.textContent).toBe("Edit source");
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(view.state.selection.main.head).toBe(doc.indexOf("<Info"));
    expect(view.contentDOM.textContent).toContain("<Info>");
  });

  it("works its Edit source button from the keyboard", async () => {
    const view = editor(doc, doc.length, [liveBlocks(new LiveBlockHost()), ...kinds]);
    await waitFor(() => expect(view.dom.querySelector(".cm-live-block-edit")).not.toBeNull());
    view.dom.querySelector<HTMLButtonElement>(".cm-live-block-edit")!.click();
    expect(view.state.selection.main.head).toBe(doc.indexOf("<Info"));
  });

  it("tells the editor to ignore the events in it", () => {
    const view = editor(doc, doc.length, [liveBlocks(new LiveBlockHost()), ...kinds]);
    let ignores: boolean | undefined;
    view.state.field(liveBlocksField).decorations.between(0, doc.length, (_from, _to, value) => {
      ignores = value.spec.widget.ignoreEvent();
    });
    expect(ignores).toBe(true);
  });
});

describe("the Live editor", () => {
  it("draws tables, hands them Preview's providers, and shows find's current match in its table's source", async () => {
    const open = vi.fn();
    const linked = `${DOC}\n\n| Link |\n|---|\n| [other](note:7) |\n`;
    const { container, rerender } = render(
      <LiveEditor value={linked} onChange={() => {}} blocks={{ noteLinks: { exists: () => true, open } }} />,
    );
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    await waitFor(() => expect(container.querySelectorAll(".cm-live-block table")).toHaveLength(2));
    // A note link in a table is Preview's NoteAnchor, given the editor's links.
    const anchor = container.querySelector<HTMLAnchorElement>(".cm-live-block a")!;
    expect(anchor.textContent).toBe("other");

    rerender(
      <LiveEditor value={linked} onChange={() => {}} blocks={{ noteLinks: { exists: () => true, open } }} findQuery="apples" />,
    );
    expect(container.querySelector(".cm-content")!.textContent).toContain("| apples | 3 |");
    expect(container.querySelector(".find-current")!.textContent).toBe("apples");
  });
});
