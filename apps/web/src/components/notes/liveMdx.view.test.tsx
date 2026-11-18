// @vitest-environment jsdom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEditor } from "./LiveEditor";
import type { LiveBlockContext } from "./liveBlockWidget";

// jsdom lays nothing out and has no Range rects (see liveBlocks.view.test.tsx).
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const INFO = "<Info>\n\nStaging resets **nightly**.\n\n```js\nconst answer = 42;\n```\n\n</Info>";
const DRAWIO = '<Drawio src="app_data/flow-diagram-3f9c2a71b0de.png" alt="Flow" />';
const SHEET = '<Sheet title="Q3">\n\n```csv\nRegion,Units\nWest,120\n```\n\n</Sheet>';
const YOUTUBE = '<YouTube url="https://youtu.be/dQw4w9WgXcQ" />';
const FRONTMATTER = "---\ntitle: Sample\n---\n";
// jsdom lays nothing out, so the editor draws only what it guesses is near the top: a few blocks a note.
const DOC = `Intro\n\n${YOUTUBE}\n\n${INFO}\n\nEnd`;
const EDITABLE = `${FRONTMATTER}Intro\n\n${DRAWIO}\n\n${SHEET}\n\nEnd`;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The Live editor over `doc`, parsed to the end, with the caret at the end. */
function live(doc: string, blocks: LiveBlockContext = {}) {
  const { container } = render(<LiveEditor value={doc} onChange={() => {}} blocks={blocks} />);
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  act(() => view.dispatch({ selection: { anchor: doc.length } }));
  return { container, view };
}

const blockOf = (container: HTMLElement, kind: string) => container.querySelector<HTMLElement>(`.cm-live-block[data-kind="mdx-${kind}"]`);
const mousedown = (element: Element) =>
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

describe("MDX components in the Live tab", () => {
  it("draws each component with Preview's own markup, the code in it coloured, in place of its source", async () => {
    const { container, view } = live(DOC);
    await waitFor(() => expect(blockOf(container, "Info")?.textContent).toContain("Staging resets nightly."));
    expect(blockOf(container, "Info")!.querySelector("strong")!.textContent).toBe("nightly");
    expect(blockOf(container, "YouTube")!.querySelector("iframe")).not.toBeNull();
    // The code fence in the callout is coloured by the highlighter Preview loads on demand.
    await waitFor(() => expect(blockOf(container, "Info")!.querySelector(".hljs-keyword")?.textContent).toBe("const"));
    expect(view.contentDOM.textContent).not.toContain("<Info>");
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("puts the caret in a callout's source when it is clicked, and the source shows with the drawing under it", async () => {
    const { container, view } = live(DOC);
    await waitFor(() => expect(blockOf(container, "Info")?.querySelector("strong")).not.toBeNull());
    mousedown(blockOf(container, "Info")!.querySelector("strong")!);
    expect(view.state.selection.main.head).toBe(DOC.indexOf("<Info>"));
    expect(view.contentDOM.textContent).toContain("<Info>");
    expect(container.querySelector('.cm-live-block-beside[data-kind="mdx-Info"]')).not.toBeNull();
  });

  it("gives a video an Edit source button, and leaves other clicks to it", async () => {
    const { container, view } = live(DOC);
    await waitFor(() => expect(blockOf(container, "YouTube")).not.toBeNull());
    mousedown(blockOf(container, "YouTube")!.querySelector(".cm-live-block-body *")!);
    expect(view.state.selection.main.head).toBe(DOC.length);
    const edit = blockOf(container, "YouTube")!.querySelector<HTMLButtonElement>(".cm-live-block-edit")!;
    expect(edit.textContent).toBe("Edit source");
    mousedown(edit);
    expect(view.state.selection.main.head).toBe(DOC.indexOf("<YouTube"));
  });

  it("works a diagram's Edit diagram and a sheet's Edit sheet from Live, with the sheet's place in the note's body", async () => {
    const drawio = { edit: vi.fn() };
    const sheet = { edit: vi.fn(), reimport: vi.fn() };
    const { container, view } = live(EDITABLE, { drawio, sheet });
    await waitFor(() => expect(blockOf(container, "Drawio")?.querySelector("button")).not.toBeNull());
    await waitFor(() => expect(blockOf(container, "Sheet")?.textContent).toContain("West"));
    expect(blockOf(container, "Sheet")!.dataset.ownsClicks).toBe("true");

    const editDiagram = blockOf(container, "Drawio")!.querySelector("button")!;
    expect(editDiagram.textContent).toContain("Edit diagram");
    // The button is the button's, not a click on the picture that edits its source.
    mousedown(editDiagram);
    editDiagram.click();
    expect(drawio.edit).toHaveBeenCalledWith("flow-diagram-3f9c2a71b0de.png");
    expect(view.state.selection.main.head).toBe(EDITABLE.length);

    const editSheet = [...blockOf(container, "Sheet")!.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Edit sheet" || button.textContent?.includes("Edit sheet"))!;
    editSheet.click();
    expect(sheet.edit).toHaveBeenCalledWith(EDITABLE.indexOf("<Sheet") - FRONTMATTER.length);
  });

  it("shows a component that is not valid MDX yet as its source with a small note, not an error banner", async () => {
    const half = '<YouTube url="https://youtu.be/dQw4w9WgXcQ" start="1 />';
    const { container, view } = live(`Intro\n\n<Info>\n\nTotal: {1 + 1}\n\n</Info>\n\n${half}\n\nEnd`);
    await waitFor(() => expect(container.querySelectorAll(".cm-live-block-pending")).toHaveLength(2));
    expect(container.querySelector(".cm-live-block-pending")!.textContent).toMatch(/^Not rendered yet: /);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // The source stays in the text, to be finished.
    expect(view.contentDOM.textContent).toContain("Total: {1 + 1}");
    expect(view.contentDOM.textContent).toContain('start="1 />');
  });
});
