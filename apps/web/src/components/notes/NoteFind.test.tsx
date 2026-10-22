// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotePane } from "./NotePane";
import type { Note } from "./types";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const at = "2026-01-01T00:00:00.000Z";
const note: Note = {
  id: 1,
  title: "Cats",
  content: "# Cats\n\nThe cat sat. Another Cat, and a concatenation.\n\nA **second cat** appears.",
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId: null,
  notebookId: 1,
};

function renderPane(props: Partial<Parameters<typeof NotePane>[0]> = {}) {
  return render(
    <NotePane
      note={note}
      focused
      view="split"
      ratio={0.5}
      onRatioChange={vi.fn()}
      onRatioCommit={vi.fn()}
      onViewChange={vi.fn()}
      onFocus={vi.fn()}
      onClose={vi.fn()}
      onChange={vi.fn()}
      onDropNote={vi.fn()}
      notes={[note]}
      onOpenNote={vi.fn()}
      {...props}
    />,
  );
}

const findInput = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Find in note" });
const status = () => within(screen.getByRole("search")).getByRole("status").textContent;
const type = (value: string) => fireEvent.change(findInput(), { target: { value } });
const marked = (container: HTMLElement) =>
  [...container.querySelectorAll(".find-match, .find-current")].map((el) => [el.textContent, el.className]);

describe("find in note", () => {
  afterEach(cleanup);

  it("is closed until asked for", () => {
    renderPane();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("opens on Ctrl+F and on Cmd+F, focused, without opening the browser's own find", () => {
    renderPane();
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.keyDown(document, { key: "f", ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(findInput());

    cleanup();
    renderPane();
    fireEvent.keyDown(document, { key: "f", metaKey: true });
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("does not answer for a pane that is not focused", () => {
    renderPane({ focused: false });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("opens from the header button", () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Find in note" }));
    expect(screen.getByRole("search")).toBeTruthy();
  });

  it("highlights a phrase in the editor and counts the matches", () => {
    const { container } = renderPane({ view: "markdown" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("cat");

    expect(status()).toBe("1 of 5");
    const editorLayer = container.querySelector("[aria-hidden] pre")!;
    const found = marked(editorLayer as HTMLElement);
    expect(found.map(([text]) => text)).toEqual(["Cat", "cat", "Cat", "cat", "cat"]);
    expect(found.filter(([, cls]) => String(cls).includes("find-current"))).toHaveLength(1);
  });

  it("matches case and whole words when asked", () => {
    renderPane({ view: "markdown" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("cat");

    fireEvent.click(screen.getByRole("button", { name: "Match case" }));
    expect(status()).toBe("1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Whole word" }));
    expect(status()).toBe("1 of 2");
    expect(screen.getByRole("button", { name: "Whole word" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("steps through the matches with Enter and Shift+Enter, wrapping round", () => {
    renderPane({ view: "markdown" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("cat");

    fireEvent.keyDown(findInput(), { key: "Enter" });
    expect(status()).toBe("2 of 5");
    fireEvent.keyDown(findInput(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(findInput(), { key: "Enter", shiftKey: true });
    expect(status()).toBe("5 of 5");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(status()).toBe("1 of 5");
  });

  it("says when there is nothing to find, and does not step", () => {
    renderPane({ view: "markdown" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("dog");
    expect(status()).toBe("No matches");
    fireEvent.keyDown(findInput(), { key: "Enter" });
    expect(status()).toBe("No matches");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next match" }).disabled).toBe(true);
  });

  it("counts what the preview shows when only the preview is showing", () => {
    renderPane({ view: "preview" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("second cat");
    // Found across the bold markup, which the source text spells with asterisks.
    expect(status()).toBe("1 of 1");
  });

  it("clears the highlights when the bar closes, and returns focus to the editor", () => {
    const { container } = renderPane({ view: "markdown" });
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });
    type("cat");
    expect(marked(container).length).toBeGreaterThan(0);

    fireEvent.keyDown(findInput(), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(marked(container)).toEqual([]);
    expect(document.activeElement).toBe(screen.getByLabelText("Markdown editor"));
  });

  it("starts from the text selected in the editor", () => {
    renderPane({ view: "markdown" });
    const editor = screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
    editor.focus();
    editor.setSelectionRange(12, 15); // "cat" in "The cat sat."
    fireEvent.keyDown(editor, { key: "f", ctrlKey: true });
    expect(findInput().value).toBe("cat");
  });
});
