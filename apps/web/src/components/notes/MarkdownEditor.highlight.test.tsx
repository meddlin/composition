// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLastHighlightColor } from "./lastHighlightColor";
import { MarkdownEditor } from "./MarkdownEditor";
import { describeParity, type EditorDriver } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

function Harness({
  initial = "",
  onValue,
  view,
}: {
  initial?: string;
  onValue?: (value: string) => void;
  view?: "markdown" | "preview" | "split";
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      noteId={7}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      ratio={0.5}
      onRatioChange={vi.fn()}
      onRatioCommit={vi.fn()}
      view={view}
    />
  );
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
const menu = () => screen.queryByRole("listbox", { name: "Highlight color" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const active = () => screen.queryAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")?.textContent;

const Y = (inner: string) => `<Mark color="yellow">${inner}</Mark>`;
const G = (inner: string) => `<Mark color="green">${inner}</Mark>`;

/** Selects `needle` in the editor, as dragging over it would. */
function selectText(editor: EditorDriver, needle: string, from = 0) {
  const start = editor.text().indexOf(needle, from);
  editor.select(start, start + needle.length);
}

const highlightShortcut = (editor: EditorDriver, init: KeyboardEventInit = {}) =>
  editor.press("H", { shiftKey: true, metaKey: true, ...init });

/** What is tinted in the editor that is showing (not in the Markdown editor's layer, which stays in the page, hidden, beside the live one). */
const tintedIn = (editor: EditorDriver) => editor.element().closest("[role=tabpanel]")!.querySelectorAll(".md-mark");

const selectedText = (editor: EditorDriver) => editor.text().slice(editor.selection().start, editor.selection().end);

afterEach(() => resetLastHighlightColor());

// Highlighting what is selected, in the plain Markdown editor and the live one.
describeParity("MarkdownEditor highlighting: the colour menu", (scenario) => {
  scenario("opens over a selection with Cmd/Ctrl+Shift+H, listing the colours", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");

    highlightShortcut(editor);

    expect(menu()).not.toBeNull();
    expect(options()).toEqual(["Yellow1", "Green2", "Blue3", "Pink4", "Orange5"]);
  });

  scenario("takes Ctrl as well as Cmd", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");

    highlightShortcut(editor, { metaKey: false, ctrlKey: true });

    expect(menu()).not.toBeNull();
  });

  scenario("does nothing with no selection and no highlight under the caret, and keeps the shortcut from reaching the browser", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    editor.focus();
    editor.select(3, 3);

    const notCancelled = highlightShortcut(editor);

    expect(menu()).toBeNull();
    expect(notCancelled).toBe(false);
  });

  scenario("ignores the key without Shift, and with Alt", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");

    highlightShortcut(editor, { shiftKey: false });
    highlightShortcut(editor, { altKey: true });

    expect(menu()).toBeNull();
  });

  scenario("moves with the arrow keys, wrapping, and closes on Escape", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);
    expect(active()).toBe("Yellow1");

    editor.press("ArrowDown");
    expect(active()).toBe("Green2");
    editor.press("ArrowUp");
    editor.press("ArrowUp");
    expect(active()).toBe("Orange5");
    editor.press("Escape");

    expect(menu()).toBeNull();
    expect(editor.text()).toBe("hello big world");
  });

  scenario("closes when the selection moves or the editor loses focus", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);
    selectText(editor, "world");
    expect(menu()).toBeNull();

    selectText(editor, "big");
    highlightShortcut(editor);
    expect(menu()).not.toBeNull();
    editor.blur();
    expect(menu()).toBeNull();
  });

  scenario("closes, and lets the key through, when something else is typed", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);

    const notCancelled = editor.press("x");

    expect(menu()).toBeNull();
    expect(notCancelled).toBe(true);
  });

  scenario("is named by the editor while open, for assistive tech", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);

    expect(editor.element().getAttribute("aria-controls")).toBe(menu()!.id);
    expect(editor.element().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
  });
});

describeParity("MarkdownEditor highlighting: highlighting", (scenario) => {
  scenario("wraps the selection in the chosen colour with Enter, and selects it again", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);

    editor.press("Enter");

    expect(editor.text()).toBe(`hello ${Y("big")} world`);
    expect(selectedText(editor)).toBe("big");
    expect(menu()).toBeNull();
  });

  scenario("picks with the arrows, a number key or the mouse", ({ render }) => {
    const editor = render({ initial: "one two three" });

    selectText(editor, "one");
    highlightShortcut(editor);
    editor.press("ArrowDown");
    editor.press("Enter");
    selectText(editor, "two");
    highlightShortcut(editor);
    editor.press("3");
    selectText(editor, "three");
    highlightShortcut(editor);
    fireEvent.mouseDown(screen.getByRole("option", { name: /Pink/ }));

    expect(editor.text()).toBe(`${G("one")} <Mark color="blue">two</Mark> <Mark color="pink">three</Mark>`);
  });

  scenario("starts on the colour used last", ({ render }) => {
    const editor = render({ initial: "one two" });
    selectText(editor, "one");
    highlightShortcut(editor);
    editor.press("2");

    selectText(editor, "two");
    highlightShortcut(editor);

    expect(active()).toBe("Green2");
  });

  scenario("tells the parent what changed, so the note is saved", ({ render }) => {
    const editor = render({ initial: "hello big world" });
    selectText(editor, "big");
    highlightShortcut(editor);

    editor.press("Enter");

    expect(editor.reported.at(-1)).toBe(`hello ${Y("big")} world`);
  });

  scenario("explains a refusal and leaves the note as it was", ({ render }) => {
    const editor = render({ initial: "the set {a, b} is small" });
    selectText(editor, "set");
    highlightShortcut(editor);

    editor.press("Enter");

    expect(editor.text()).toBe("the set {a, b} is small");
    expect(screen.getByRole("alert").textContent).toContain("MDX");
  });

  scenario("drops the explanation once the note is edited", ({ render }) => {
    const editor = render({ initial: "the set {a, b} is small" });
    selectText(editor, "set");
    highlightShortcut(editor);
    editor.press("Enter");

    editor.type("the set is small");

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describeParity("MarkdownEditor highlighting: on an existing highlight", (scenario) => {
  scenario("opens with a caret inside it, offering Remove", ({ render }) => {
    const editor = render({ initial: `one ${Y("two")} three` });
    editor.focus();
    const caret = editor.text().indexOf("wo");
    editor.select(caret, caret);

    highlightShortcut(editor);

    expect(options()).toEqual(["Yellow1", "Green2", "Blue3", "Pink4", "Orange5", "Remove highlight0"]);
  });

  scenario("recolours it", ({ render }) => {
    const editor = render({ initial: `one ${Y("two")} three` });
    selectText(editor, "two");
    highlightShortcut(editor);

    editor.press("2");

    expect(editor.text()).toBe(`one ${G("two")} three`);
  });

  scenario("removes it, keeping the text selected", ({ render }) => {
    const editor = render({ initial: `one ${Y("two")} three` });
    selectText(editor, "two");
    highlightShortcut(editor);

    editor.press("0");

    expect(editor.text()).toBe("one two three");
    expect(selectedText(editor)).toBe("two");
  });

  scenario("does not offer Remove over plain text", ({ render }) => {
    const editor = render({ initial: "one two three" });
    selectText(editor, "two");
    highlightShortcut(editor);

    expect(options()).not.toContain("Remove highlight0");
  });
});

describeParity("MarkdownEditor highlighting: the editor's colours", (scenario) => {
  scenario("paints the text between the tags in the highlight's colour", ({ render }) => {
    const editor = render({ initial: `one ${G("two")} three` });

    const tinted = tintedIn(editor);
    expect([...tinted].map((el) => [el.textContent, el.getAttribute("data-color")])).toEqual([["two", "green"]]);
  });

  scenario("leaves text outside the tags, and tags in code, untinted", ({ render }) => {
    const editor = render({ initial: `plain ${G("one")} and \`${Y("code")}\` end` });

    expect([...tintedIn(editor)].map((el) => el.textContent)).toEqual(["one"]);
  });
});

describe("MarkdownEditor highlighting from the preview", () => {
  afterEach(() => {
    cleanup();
    resetLastHighlightColor();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  const preview = () => document.querySelector<HTMLElement>(".prose")!;
  const menuItems = () => screen.queryAllByRole("menuitem").map((item) => item.textContent);

  /** Selects `needle` in the rendered preview, as dragging over it would. */
  function selectInPreview(needle: string) {
    const walker = document.createTreeWalker(preview(), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const at = node.data.indexOf(needle);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      return node.parentElement!;
    }
    throw new Error(`${needle} is not in the preview`);
  }
  /** Right-clicks `target`; true if the browser's own menu was left to open. */
  const rightClick = (target: Element) => fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });

  it("offers to highlight the selected text, pick a colour, or copy it", async () => {
    render(<Harness initial="hello big world" />);

    rightClick(selectInPreview("big"));

    expect(menuItems()).toEqual(["Highlight text", "Highlight color", "Copy"]);
  });

  it("highlights the selection in yellow with Highlight text", async () => {
    render(<Harness initial="hello big world" />);
    rightClick(selectInPreview("big"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    await waitFor(() => expect(editor().value).toBe(`hello ${Y("big")} world`));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("highlights in the colour picked from the submenu, and uses it next time", async () => {
    render(<Harness initial="one two three" />);
    rightClick(selectInPreview("one"));
    const more = screen.getByRole("menuitem", { name: "Highlight color" });
    fireEvent.keyDown(more, { key: "ArrowRight" });

    fireEvent.click(screen.getByRole("menuitem", { name: /Green/ }));
    await waitFor(() => expect(editor().value).toBe(`${G("one")} two three`));

    rightClick(selectInPreview("two"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));
    await waitFor(() => expect(editor().value).toBe(`${G("one")} ${G("two")} three`));
  });

  it("maps a selection across formatting and paragraphs to the right words", async () => {
    render(<Harness initial={"a **bold** word\n\nsecond one"} />);
    const range = document.createRange();
    const first = preview().querySelector("p")!.firstChild!.firstChild!;
    range.setStart(first, 0);
    range.setEnd(preview().querySelectorAll("p")[1].firstChild!.firstChild!, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    rightClick(preview().querySelector("p")!);

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    await waitFor(() => expect(editor().value).toBe(`${Y("a")} **${Y("bold")}** ${Y("word")}\n\n${Y("second")} one`));
  });

  it("leaves the browser's own menu alone when nothing is selected and no highlight is clicked", async () => {
    render(<Harness initial="hello big world" />);

    const native = rightClick(preview().querySelector("p")!);

    expect(native).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes over the menu, so the browser's doesn't also open", async () => {
    render(<Harness initial="hello big world" />);

    expect(rightClick(selectInPreview("big"))).toBe(false);
  });

  it("opens on a highlight with no selection, offering to remove it", async () => {
    render(<Harness initial={`one ${Y("two")} three`} />);

    rightClick(preview().querySelector("mark")!);
    expect(menuItems()).toContain("Remove highlight");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove highlight" }));

    await waitFor(() => expect(editor().value).toBe("one two three"));
  });

  it("recolours a highlight from the colour submenu", async () => {
    render(<Harness initial={`one ${Y("two")} three`} />);
    rightClick(preview().querySelector("mark")!);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Highlight color" }), { key: "ArrowRight" });

    fireEvent.click(screen.getByRole("menuitem", { name: /Green/ }));

    await waitFor(() => expect(editor().value).toBe(`one ${G("two")} three`));
  });

  it("does not offer Remove over plain text", async () => {
    render(<Harness initial="hello big world" />);

    rightClick(selectInPreview("big"));

    expect(menuItems()).not.toContain("Remove highlight");
  });

  it("copies the selected text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness initial="hello big world" />);
    rightClick(selectInPreview("big"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("big");
  });

  it("says why when the selection has nothing to highlight, keeping Copy", async () => {
    render(<Harness initial={"run `code` now"} />);

    rightClick(selectInPreview("code"));

    expect(screen.getByRole("menuitem", { name: "Highlight text" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(screen.getByRole("menu")).getByText(/can't be/)).toBeDefined();
    expect(menuItems()).toContain("Copy");
  });

  it("says why when the text can't be traced back to the note", () => {
    // A JSX attribute string would decode the entity; this has to be the note's own text.
    render(<Harness initial={"fish &amp; chips"} />);

    rightClick(selectInPreview("chips"));

    expect(screen.getByRole("menuitem", { name: "Highlight text" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(screen.getByRole("menu")).getByText(/traced back/)).toBeDefined();
  });

  it("explains a refusal, and leaves the note as it was", async () => {
    render(<Harness initial="the set {a, b} is small" />);
    rightClick(selectInPreview("set"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    expect((await screen.findByRole("alert")).textContent).toContain("MDX");
    expect(editor().value).toBe("the set {a, b} is small");
  });

  it("works with only the preview showing, where the editor is hidden", async () => {
    render(<Harness initial="hello big world" view="preview" />);
    rightClick(selectInPreview("big"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    await waitFor(() => expect(editor().value).toBe(`hello ${Y("big")} world`));
  });

  it("shows a refusal in the preview when that is all that is showing", async () => {
    render(<Harness initial="the set {a, b} is small" view="preview" />);
    rightClick(selectInPreview("set"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    expect((await within(preview().closest("section")!).findByRole("alert")).textContent).toContain("MDX");
  });

  it("counts frontmatter, which the preview doesn't show, in the offsets", async () => {
    render(<Harness initial={"---\ntitle: Hi\n---\nhello big world"} />);
    rightClick(selectInPreview("big"));

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight text" }));

    await waitFor(() => expect(editor().value).toBe(`---\ntitle: Hi\n---\nhello ${Y("big")} world`));
  });
});
