// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
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

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
const menu = () => screen.queryByRole("listbox", { name: "Notes" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const key = (name: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(editor(), { key: name, ...init });
const shortcut = () => key("K", { shiftKey: true, metaKey: true });

/** Types by replacing the text and leaving the caret at `caret` (default: the end). */
function type(value: string, caret = value.length) {
  fireEvent.focus(editor());
  fireEvent.change(editor(), { target: { value, selectionStart: caret, selectionEnd: caret } });
}

function select(start: number, end: number) {
  fireEvent.focus(editor());
  editor().setSelectionRange(start, end);
}

describe("MarkdownEditor note links: typing [[", () => {
  afterEach(cleanup);

  it("lists the other notes after a [[", () => {
    render(<Harness />);

    type("[[");

    expect(options()).toEqual(["Release checklist", "Groceries", "Pre-release notes"]);
  });

  it("narrows the list as the title is typed", () => {
    render(<Harness />);

    type("see [[release");

    expect(options()).toEqual(["Release checklist", "Pre-release notes"]);
  });

  it("closes when nothing matches, and stays out of the way of ordinary brackets", () => {
    render(<Harness />);

    type("[[zzz");
    expect(menu()).toBeNull();

    type("a [b]");
    expect(menu()).toBeNull();
  });

  it("stays out of the way inside a fenced code block", () => {
    render(<Harness />);

    type("```\n[[");

    expect(menu()).toBeNull();
  });

  it("inserts a link to the highlighted note on Enter, with the caret after it", () => {
    render(<Harness />);
    type("see [[");

    key("ArrowDown");
    key("Enter");

    expect(editor().value).toBe("see [Groceries](note:2)");
    expect(editor().selectionStart).toBe("see [Groceries](note:2)".length);
    expect(menu()).toBeNull();
  });

  it("replaces what was typed after the [[, keeping the text around it", () => {
    render(<Harness />);
    type("a [[pre and more", "a [[pre".length);

    key("Tab");

    expect(editor().value).toBe("a [Pre-release notes](note:3) and more");
  });

  it("inserts a note picked with the mouse", () => {
    render(<Harness />);
    type("[[");

    fireEvent.mouseDown(screen.getByRole("option", { name: "Groceries" }));

    expect(editor().value).toBe("[Groceries](note:2)");
  });

  it("closes on Escape and leaves the text alone", () => {
    render(<Harness />);
    type("[[rel");

    key("Escape");

    expect(menu()).toBeNull();
    expect(editor().value).toBe("[[rel");
  });

  it("leaves Enter alone when the menu is closed", () => {
    render(<Harness />);
    type("plain text");

    expect(fireEvent.keyDown(editor(), { key: "Enter" })).toBe(true);
  });

  it("marks the highlighted option for assistive tech", () => {
    render(<Harness />);
    type("[[");

    key("ArrowDown");

    const active = screen.getByRole("option", { selected: true });
    expect(active.textContent).toBe("Groceries");
    expect(editor().getAttribute("aria-activedescendant")).toBe(active.id);
  });

  it("does not offer the MDX components for a [", () => {
    render(<Harness />);
    type("[[");

    expect(screen.queryByRole("listbox", { name: "MDX components" })).toBeNull();
  });
});

describe("MarkdownEditor note links: the shortcut", () => {
  afterEach(cleanup);

  it("is announced on the editor", () => {
    render(<Harness />);

    expect(editor().getAttribute("aria-keyshortcuts")).toContain("Control+Shift+K Meta+Shift+K");
  });

  it("opens the picker at the caret and links the chosen note by its title", () => {
    render(<Harness initial="see " />);
    type("see ");

    const handled = !shortcut();
    expect(handled).toBe(true);
    expect(options()).toEqual(["Release checklist", "Groceries", "Pre-release notes"]);

    key("Enter");

    expect(editor().value).toBe("see [Release checklist](note:1)");
  });

  it("also answers to Ctrl+Shift+K", () => {
    render(<Harness />);

    key("K", { shiftKey: true, ctrlKey: true });

    expect(menu()).not.toBeNull();
  });

  it("ignores K without Shift (that is search) and with Alt", () => {
    render(<Harness />);

    key("k", { metaKey: true });
    key("K", { shiftKey: true, metaKey: true, altKey: true });

    expect(menu()).toBeNull();
  });

  it("filters by what is typed, without putting it in the note", () => {
    render(<Harness initial="intro" />);
    type("intro");

    shortcut();
    key("p");
    key("r");
    key("e");

    expect(options()).toEqual(["Pre-release notes"]);
    expect(editor().value).toBe("intro");

    key("Backspace");
    key("Backspace");
    key("Backspace");
    expect(options()).toHaveLength(3);
  });

  it("makes the selected words the link's text", () => {
    render(<Harness initial="read the checklist now" />);
    type("read the checklist now");

    select(9, 18);
    shortcut();
    key("g");
    key("Enter");

    expect(editor().value).toBe("read the [checklist](note:2) now");
  });

  it("says when nothing matches, and does nothing on Enter", () => {
    render(<Harness initial="x" />);
    type("x");

    shortcut();
    key("z");
    key("z");
    key("Enter");

    expect(options()).toEqual([]);
    expect(screen.getByText("No matching notes")).toBeDefined();
    expect(editor().value).toBe("x");
  });

  it("closes on Escape, or when the shortcut is pressed again, leaving the text alone", () => {
    render(<Harness initial="x" />);
    type("x");

    shortcut();
    key("Escape");
    expect(menu()).toBeNull();

    shortcut();
    expect(menu()).not.toBeNull();
    shortcut();
    expect(menu()).toBeNull();
    expect(editor().value).toBe("x");
  });

  it("closes when the editor loses focus", () => {
    render(<Harness />);
    shortcut();

    fireEvent.blur(editor());

    expect(menu()).toBeNull();
  });

  it("escapes brackets in a selection used as the link text", () => {
    render(<Harness initial="[a]" />);
    type("[a]");

    select(0, 3);
    shortcut();
    key("Enter");

    expect(editor().value).toBe("[\\[a\\]](note:1)");
  });

  it("leaves other keys alone while no picker is open", () => {
    render(<Harness />);

    expect(fireEvent.keyDown(editor(), { key: "a" })).toBe(true);
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
