// @vitest-environment jsdom
import { history } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveBlockHost } from "./liveBlockWidget";
import { liveBlocks, REDRAW_DELAY } from "./liveBlocks";
import { liveFrontmatterField } from "./liveFrontmatter";
import { liveMarkdown } from "./liveMarkdown";
import { liveRest } from "./liveRest";

// jsdom lays nothing out and has no Range rects (see liveBlocks.view.test.tsx).
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const views: EditorView[] = [];

/** An editor as Live builds one (Markdown, the block layer and Step 7's parts), parsed to the end. */
function editor(doc: string, caret: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: caret },
      extensions: [history(), markdown({ base: markdownLanguage }), liveMarkdown, liveBlocks(new LiveBlockHost()), liveRest],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  cleanup();
  vi.useRealTimers();
});

const FRONTMATTER = "---\ntitle: Garden notes\ntags: [plants, spring]\n---\n";
const BODY = "<Toc />\n\nIntro\n=====\n\nSome text[^a].\n\n## Later\n\n[^a]: The note.\n\n<Footnotes />";
const DOC = FRONTMATTER + BODY;

describe("the frontmatter in Live (D5)", () => {
  it("is drawn as Preview's card, in place of its YAML, when the note opens (the caret at its start, not focused)", async () => {
    const view = editor(DOC, 0);
    await waitFor(() => expect(view.dom.querySelector(".cm-live-block h1")?.textContent).toBe("Garden notes"));
    expect([...view.dom.querySelectorAll(".cm-live-block [aria-label='Tags'] li")].map((tag) => tag.textContent)).toEqual(["plants", "spring"]);
    expect(view.contentDOM.textContent).not.toContain("title: Garden notes");
  });

  it("shows only its YAML, with no card under it, once the card is clicked", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(view.dom.querySelector(".cm-live-block h1")).not.toBeNull());
    const card = view.dom.querySelector(".cm-live-block h1")!.closest<HTMLElement>(".cm-live-block")!;
    act(() => {
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      // jsdom has no real focus for a contenteditable; the editor is told the way it would be.
      view.dispatch({ effects: [] });
      view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    });
    expect(view.state.selection.main.head).toBe(0);
    await waitFor(() => expect(view.state.field(liveFrontmatterField).active).toBe(true));
    expect(view.contentDOM.textContent).toContain("title: Garden notes");
    expect(view.dom.querySelector(".cm-live-block h1")).toBeNull();
  });

  it("is entered from the line under it with the up arrow", async () => {
    const view = editor(DOC, FRONTMATTER.length + 2);
    await waitFor(() => expect(view.dom.querySelector(".cm-live-block h1")).not.toBeNull());
    runScopeHandlers(view, new KeyboardEvent("keydown", { key: "ArrowUp" }), "editor");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("---");
  });
});

describe("<Toc /> and <Footnotes /> in Live", () => {
  it("draws the table of contents from the note's headings, and scrolls Live to one when it is clicked", async () => {
    const view = editor(DOC, DOC.indexOf("Some"));
    await waitFor(() => expect(view.dom.querySelectorAll("nav[aria-label='Table of contents'] a")).toHaveLength(2));
    const links = [...view.dom.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Table of contents'] a")];
    expect(links.map((link) => link.textContent)).toEqual(["Intro", "Later"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#intro", "#later"]);
    const dispatch = vi.spyOn(view, "dispatch");
    links[1].click();
    expect(dispatch).toHaveBeenCalledTimes(1);
    // A scroll, not a caret move.
    expect(view.state.selection.main.head).toBe(DOC.indexOf("Some"));
    // Its own links are its own: it has an "Edit source" button instead.
    expect(view.dom.querySelector("nav")!.closest(".cm-live-block")!.querySelector(".cm-live-block-edit")).not.toBeNull();
  });

  it("re-reads the headings once typing pauses", async () => {
    const view = editor(DOC, DOC.length);
    await waitFor(() => expect(view.dom.querySelectorAll("nav a")).toHaveLength(2));
    vi.useFakeTimers();
    act(() => view.dispatch({ changes: { from: DOC.indexOf("## Later"), insert: "## Added\n\n" } }));
    expect(view.dom.querySelectorAll("nav a")).toHaveLength(2);
    await act(async () => vi.advanceTimersByTime(REDRAW_DELAY + 10));
    vi.useRealTimers();
    await waitFor(() => expect([...view.dom.querySelectorAll("nav a")].map((link) => link.textContent)).toEqual(["Intro", "Added", "Later"]));
  });

  it("draws the footnotes as Preview's numbered list, and a reference as its number", async () => {
    const view = editor(DOC, DOC.indexOf("Intro"));
    await waitFor(() => expect(view.dom.querySelector("section[aria-label='Footnotes'] li")).not.toBeNull());
    const items = [...view.dom.querySelectorAll("section[aria-label='Footnotes'] li")];
    expect(items.map((item) => item.textContent?.trim())).toEqual(["The note. ↩"]);
    // The line of references it is numbered by is not shown.
    const first = view.dom.querySelector(".cm-live-footnotes > p:first-child");
    expect(first === null || getComputedStyle(first).display === "none").toBe(true);
    const reference = view.dom.querySelector<HTMLElement>(".cm-live-footnote-ref")!;
    expect(reference.textContent).toBe("1");
    expect(reference.dataset.href).toBe("#fn-a");
    expect(view.dom.querySelector(".cm-live-footnote-number")!.textContent).toBe("1.");
    // ↩ goes back to the reference in Live's text.
    const dispatch = vi.spyOn(view, "dispatch");
    items[0].querySelector<HTMLAnchorElement>("a[data-footnote-backref]")!.click();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps the source as typed: drawing hides nothing from the text", () => {
    const view = editor(DOC, DOC.length);
    expect(view.state.doc.toString()).toBe(DOC);
    view.dispatch({ selection: EditorSelection.cursor(DOC.indexOf("[^a]") + 1) });
    expect(view.contentDOM.textContent).toContain("text[^a].");
  });
});
