// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLastHighlightColor } from "./lastHighlightColor";
import { MarkdownEditor } from "./MarkdownEditor";

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

/** Selects `needle` in the editor, as dragging over it would. */
function select(needle: string, from = 0) {
  const start = editor().value.indexOf(needle, from);
  fireEvent.focus(editor());
  editor().setSelectionRange(start, start + needle.length);
  fireEvent.select(editor());
}

const shortcut = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(editor(), { key: "H", shiftKey: true, metaKey: true, ...init });
const key = (name: string) => fireEvent.keyDown(editor(), { key: name });

const Y = (inner: string) => `<Mark color="yellow">${inner}</Mark>`;
const G = (inner: string) => `<Mark color="green">${inner}</Mark>`;

describe("MarkdownEditor highlighting", () => {
  afterEach(() => {
    cleanup();
    resetLastHighlightColor();
  });

  describe("the colour menu", () => {
    it("opens over a selection with Cmd/Ctrl+Shift+H, listing the colours", () => {
      render(<Harness initial="hello big world" />);
      select("big");

      shortcut();

      expect(menu()).not.toBeNull();
      expect(options()).toEqual(["Yellow1", "Green2", "Blue3", "Pink4", "Orange5"]);
    });

    it("takes Ctrl as well as Cmd", () => {
      render(<Harness initial="hello big world" />);
      select("big");

      shortcut({ metaKey: false, ctrlKey: true });

      expect(menu()).not.toBeNull();
    });

    it("does nothing with no selection and no highlight under the caret, and keeps the shortcut from reaching the browser", () => {
      render(<Harness initial="hello big world" />);
      fireEvent.focus(editor());
      editor().setSelectionRange(3, 3);

      const notCancelled = shortcut();

      expect(menu()).toBeNull();
      expect(notCancelled).toBe(false);
    });

    it("ignores the key without Shift, and with Alt", () => {
      render(<Harness initial="hello big world" />);
      select("big");

      shortcut({ shiftKey: false });
      shortcut({ altKey: true });

      expect(menu()).toBeNull();
    });

    it("moves with the arrow keys, wrapping, and closes on Escape", () => {
      render(<Harness initial="hello big world" />);
      select("big");
      shortcut();
      expect(active()).toBe("Yellow1");

      key("ArrowDown");
      expect(active()).toBe("Green2");
      key("ArrowUp");
      key("ArrowUp");
      expect(active()).toBe("Orange5");
      key("Escape");

      expect(menu()).toBeNull();
      expect(editor().value).toBe("hello big world");
    });

    it("closes when the selection moves or the editor loses focus", () => {
      render(<Harness initial="hello big world" />);
      select("big");
      shortcut();
      select("world");
      expect(menu()).toBeNull();

      select("big");
      shortcut();
      fireEvent.blur(editor());
      expect(menu()).toBeNull();
    });

    it("closes, and lets the key through, when something else is typed", () => {
      render(<Harness initial="hello big world" />);
      select("big");
      shortcut();

      const notCancelled = fireEvent.keyDown(editor(), { key: "x" });

      expect(menu()).toBeNull();
      expect(notCancelled).toBe(true);
    });

    it("is named by the textarea while open, for assistive tech", () => {
      render(<Harness initial="hello big world" />);
      select("big");
      shortcut();

      expect(editor().getAttribute("aria-controls")).toBe(menu()!.id);
      expect(editor().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    });
  });

  describe("highlighting", () => {
    it("wraps the selection in the chosen colour with Enter, and selects it again", () => {
      render(<Harness initial="hello big world" />);
      select("big");
      shortcut();

      key("Enter");

      expect(editor().value).toBe(`hello ${Y("big")} world`);
      expect(editor().value.slice(editor().selectionStart, editor().selectionEnd)).toBe("big");
      expect(menu()).toBeNull();
    });

    it("picks with the arrows, a number key or the mouse", () => {
      render(<Harness initial="one two three" />);

      select("one");
      shortcut();
      key("ArrowDown");
      key("Enter");
      select("two");
      shortcut();
      key("3");
      select("three");
      shortcut();
      fireEvent.mouseDown(screen.getByRole("option", { name: /Pink/ }));

      expect(editor().value).toBe(
        `${G("one")} <Mark color="blue">two</Mark> <Mark color="pink">three</Mark>`,
      );
    });

    it("starts on the colour used last", () => {
      render(<Harness initial="one two" />);
      select("one");
      shortcut();
      key("2");

      select("two");
      shortcut();

      expect(active()).toBe("Green2");
    });

    it("tells the parent what changed, so the note is saved", () => {
      const onValue = vi.fn();
      render(<Harness initial="hello big world" onValue={onValue} />);
      select("big");
      shortcut();

      key("Enter");

      expect(onValue).toHaveBeenLastCalledWith(`hello ${Y("big")} world`);
    });

    it("explains a refusal and leaves the note as it was", () => {
      render(<Harness initial="the set {a, b} is small" />);
      select("set");
      shortcut();

      key("Enter");

      expect(editor().value).toBe("the set {a, b} is small");
      expect(screen.getByRole("alert").textContent).toContain("MDX");
    });

    it("drops the explanation once the note is edited", () => {
      render(<Harness initial="the set {a, b} is small" />);
      select("set");
      shortcut();
      key("Enter");

      fireEvent.change(editor(), { target: { value: "the set is small" } });

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("on an existing highlight", () => {
    it("opens with a caret inside it, offering Remove", () => {
      render(<Harness initial={`one ${Y("two")} three`} />);
      fireEvent.focus(editor());
      const caret = editor().value.indexOf("wo");
      editor().setSelectionRange(caret, caret);
      fireEvent.select(editor());

      shortcut();

      expect(options()).toEqual(["Yellow1", "Green2", "Blue3", "Pink4", "Orange5", "Remove highlight0"]);
    });

    it("recolours it", () => {
      render(<Harness initial={`one ${Y("two")} three`} />);
      select("two");
      shortcut();

      key("2");

      expect(editor().value).toBe(`one ${G("two")} three`);
    });

    it("removes it, keeping the text selected", () => {
      render(<Harness initial={`one ${Y("two")} three`} />);
      select("two");
      shortcut();

      key("0");

      expect(editor().value).toBe("one two three");
      expect(editor().value.slice(editor().selectionStart, editor().selectionEnd)).toBe("two");
    });

    it("does not offer Remove over plain text", () => {
      render(<Harness initial="one two three" />);
      select("two");
      shortcut();

      expect(options()).not.toContain("Remove highlight0");
    });
  });

  describe("the editor's colours", () => {
    it("paints the text between the tags in the highlight's colour", () => {
      const { container } = render(<Harness initial={`one ${G("two")} three`} />);

      const tinted = container.querySelectorAll(".md-mark");
      expect([...tinted].map((el) => [el.textContent, el.getAttribute("data-color")])).toEqual([["two", "green"]]);
    });
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
