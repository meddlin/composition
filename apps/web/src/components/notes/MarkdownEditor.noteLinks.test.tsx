// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { describeParity, type EditorDriver } from "./parityHarness";
import type { Note } from "./types";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const note = (id: number, title: string): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: "",
  updatedAt: "",
  groupId: null,
  notebookId: 1,
});

// Note 7 is the one being edited.
const notes = [note(7, "This note"), note(1, "Release checklist"), note(2, "Groceries"), note(3, "Pre-release notes")];

function Harness({
  initial = "",
  onOpenNote = vi.fn(),
  list = notes,
}: {
  initial?: string;
  onOpenNote?: (id: number, beside: boolean) => void;
  list?: Note[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      noteId={7}
      value={value}
      onChange={setValue}
      ratio={0.5}
      onRatioChange={vi.fn()}
      onRatioCommit={vi.fn()}
      notes={list}
      onOpenNote={onOpenNote}
    />
  );
}

const menu = () => screen.queryByRole("listbox", { name: "Notes" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const shortcut = (editor: EditorDriver, init: KeyboardEventInit = {}) =>
  editor.press("K", { shiftKey: true, metaKey: true, ...init });

// Linking to a note, in the plain Markdown editor and the live one.
describeParity("MarkdownEditor note links: typing [[", (scenario) => {
  scenario("lists the other notes after a [[", ({ render }) => {
    const editor = render({ notes });

    editor.type("[[");

    expect(options()).toEqual(["Release checklist", "Groceries", "Pre-release notes"]);
  });

  scenario("narrows the list as the title is typed", ({ render }) => {
    const editor = render({ notes });

    editor.type("see [[release");

    expect(options()).toEqual(["Release checklist", "Pre-release notes"]);
  });

  scenario("closes when nothing matches, and stays out of the way of ordinary brackets", ({ render }) => {
    const editor = render({ notes });

    editor.type("[[zzz");
    expect(menu()).toBeNull();

    editor.type("a [b]");
    expect(menu()).toBeNull();
  });

  scenario("stays out of the way inside a fenced code block", ({ render }) => {
    const editor = render({ notes });

    editor.type("```\n[[");

    expect(menu()).toBeNull();
  });

  scenario("inserts a link to the highlighted note on Enter, with the caret after it", ({ render }) => {
    const editor = render({ notes });
    editor.type("see [[");

    editor.press("ArrowDown");
    editor.press("Enter");

    expect(editor.text()).toBe("see [Groceries](note:2)");
    expect(editor.caret()).toBe("see [Groceries](note:2)".length);
    expect(menu()).toBeNull();
  });

  scenario("replaces what was typed after the [[, keeping the text around it", ({ render }) => {
    const editor = render({ notes });
    editor.type("a [[pre and more", "a [[pre".length);

    editor.press("Tab");

    expect(editor.text()).toBe("a [Pre-release notes](note:3) and more");
  });

  scenario("inserts a note picked with the mouse", ({ render }) => {
    const editor = render({ notes });
    editor.type("[[");

    fireEvent.mouseDown(screen.getByRole("option", { name: "Groceries" }));

    expect(editor.text()).toBe("[Groceries](note:2)");
  });

  scenario("closes on Escape and leaves the text alone", ({ render }) => {
    const editor = render({ notes });
    editor.type("[[rel");

    editor.press("Escape");

    expect(menu()).toBeNull();
    expect(editor.text()).toBe("[[rel");
  });

  scenario("leaves Enter alone when the menu is closed", ({ render, mode }) => {
    const editor = render({ notes });
    editor.type("plain text");

    if (mode === "markdown") {
      // The browser makes the new line in a textarea, so all there is to check is that nothing cancelled the key.
      expect(editor.press("Enter")).toBe(true);
    } else {
      // The live editor makes it itself.
      editor.press("Enter");
      expect(editor.text()).toBe("plain text\n");
    }
  });

  scenario("marks the highlighted option for assistive tech", ({ render }) => {
    const editor = render({ notes });
    editor.type("[[");

    editor.press("ArrowDown");

    const active = screen.getByRole("option", { selected: true });
    expect(active.textContent).toBe("Groceries");
    expect(editor.element().getAttribute("aria-activedescendant")).toBe(active.id);
  });

  scenario("does not offer the MDX components for a [", ({ render }) => {
    const editor = render({ notes });
    editor.type("[[");

    expect(screen.queryByRole("listbox", { name: "MDX components" })).toBeNull();
  });
});

describeParity("MarkdownEditor note links: the shortcut", (scenario) => {
  scenario("is announced on the editor", ({ render }) => {
    const editor = render({ notes });

    expect(editor.element().getAttribute("aria-keyshortcuts")).toContain("Control+Shift+K Meta+Shift+K");
  });

  scenario("opens the picker at the caret and links the chosen note by its title", ({ render }) => {
    const editor = render({ initial: "see ", notes });
    editor.type("see ");

    const handled = !shortcut(editor);
    expect(handled).toBe(true);
    expect(options()).toEqual(["Release checklist", "Groceries", "Pre-release notes"]);

    editor.press("Enter");

    expect(editor.text()).toBe("see [Release checklist](note:1)");
  });

  scenario("also answers to Ctrl+Shift+K", ({ render }) => {
    const editor = render({ notes });

    editor.press("K", { shiftKey: true, ctrlKey: true });

    expect(menu()).not.toBeNull();
  });

  scenario("ignores K without Shift (that is search) and with Alt", ({ render }) => {
    const editor = render({ notes });

    editor.press("k", { metaKey: true });
    editor.press("K", { shiftKey: true, metaKey: true, altKey: true });

    expect(menu()).toBeNull();
  });

  scenario("filters by what is typed, without putting it in the note", ({ render }) => {
    const editor = render({ initial: "intro", notes });
    editor.type("intro");

    shortcut(editor);
    editor.press("p");
    editor.press("r");
    editor.press("e");

    expect(options()).toEqual(["Pre-release notes"]);
    expect(editor.text()).toBe("intro");

    editor.press("Backspace");
    editor.press("Backspace");
    editor.press("Backspace");
    expect(options()).toHaveLength(3);
  });

  scenario("makes the selected words the link's text", ({ render }) => {
    const editor = render({ initial: "read the checklist now", notes });
    editor.type("read the checklist now");

    editor.select(9, 18);
    shortcut(editor);
    editor.press("g");
    editor.press("Enter");

    expect(editor.text()).toBe("read the [checklist](note:2) now");
  });

  scenario("says when nothing matches, and does nothing on Enter", ({ render }) => {
    const editor = render({ initial: "x", notes });
    editor.type("x");

    shortcut(editor);
    editor.press("z");
    editor.press("z");
    editor.press("Enter");

    expect(options()).toEqual([]);
    expect(screen.getByText("No matching notes")).toBeDefined();
    expect(editor.text()).toBe("x");
  });

  scenario("closes on Escape, or when the shortcut is pressed again, leaving the text alone", ({ render }) => {
    const editor = render({ initial: "x", notes });
    editor.type("x");

    shortcut(editor);
    editor.press("Escape");
    expect(menu()).toBeNull();

    shortcut(editor);
    expect(menu()).not.toBeNull();
    shortcut(editor);
    expect(menu()).toBeNull();
    expect(editor.text()).toBe("x");
  });

  scenario("closes when the editor loses focus", ({ render }) => {
    const editor = render({ notes });
    shortcut(editor);
    expect(menu()).not.toBeNull();

    editor.blur();

    expect(menu()).toBeNull();
  });

  scenario("escapes brackets in a selection used as the link text", ({ render }) => {
    const editor = render({ initial: "[a]", notes });
    editor.type("[a]");

    editor.select(0, 3);
    shortcut(editor);
    editor.press("Enter");

    expect(editor.text()).toBe("[\\[a\\]](note:1)");
  });

  scenario("leaves other keys alone while no picker is open", ({ render }) => {
    const editor = render({ notes });

    expect(editor.press("a")).toBe(true);
  });
});

describe("MarkdownEditor note links: the preview", () => {
  afterEach(cleanup);

  const preview = () => document.querySelector<HTMLElement>(".prose")!;

  it("renders a note link as a link that opens the note in place", () => {
    const onOpenNote = vi.fn();
    render(<Harness initial="See [the checklist](note:1)." onOpenNote={onOpenNote} />);

    fireEvent.click(within(preview()).getByRole("link", { name: "the checklist" }));

    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith(1, false);
  });

  it("opens the note beside this one with Cmd or Ctrl held", () => {
    const onOpenNote = vi.fn();
    render(<Harness initial="[a](note:1) [b](note:2)" onOpenNote={onOpenNote} />);

    fireEvent.click(within(preview()).getByRole("link", { name: "a" }), { metaKey: true });
    fireEvent.click(within(preview()).getByRole("link", { name: "b" }), { ctrlKey: true });

    expect(onOpenNote.mock.calls).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it("does not navigate the page", () => {
    render(<Harness initial="[a](note:1)" />);

    const notCancelled = fireEvent.click(within(preview()).getByRole("link", { name: "a" }));

    expect(notCancelled).toBe(false);
  });

  it("shows a link to a note that no longer exists as dead text", () => {
    const onOpenNote = vi.fn();
    render(<Harness initial="See [old note](note:999)." onOpenNote={onOpenNote} />);

    expect(within(preview()).queryByRole("link", { name: "old note" })).toBeNull();
    // The words sit in a span of the preview's own (see rehypeSourceSpans), inside the one that says the note is gone.
    const dead = within(preview()).getByTitle("This note no longer exists");
    expect(dead.textContent).toBe("old note");

    fireEvent.click(dead);
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it("leaves other links as written", () => {
    render(<Harness initial="[site](https://example.com) and [mail](mailto:a@b.co)" />);

    expect(within(preview()).getByRole("link", { name: "site" }).getAttribute("href")).toBe("https://example.com");
    expect(within(preview()).getByRole("link", { name: "mail" }).getAttribute("href")).toBe("mailto:a@b.co");
  });

  it("still drops the target of a link with an unsafe scheme", () => {
    render(<Harness initial="[x](javascript:alert(1))" />);

    expect(preview().querySelector("a")?.getAttribute("href") ?? "").toBe("");
  });

  it("works inside a note that uses MDX components", () => {
    render(<Harness initial={"<Info>\n\nSee [the checklist](note:1).\n\n</Info>"} />);

    expect(within(preview()).getByRole("link", { name: "the checklist" }).getAttribute("href")).toBe("#note-1");
  });
});
