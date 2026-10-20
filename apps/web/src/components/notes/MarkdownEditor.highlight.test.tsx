// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLastHighlightColor } from "./lastHighlightColor";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

function Harness({ initial = "", onValue }: { initial?: string; onValue?: (value: string) => void }) {
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
