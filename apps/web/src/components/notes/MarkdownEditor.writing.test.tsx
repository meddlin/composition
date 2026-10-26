// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WRITING_SETTINGS, type WritingSettings } from "@/lib/composition/writing";
import { MarkdownEditor } from "./MarkdownEditor";
import { WritingProvider } from "./WritingProvider";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

function Harness({ initial = "", writing }: { initial?: string; writing: Partial<WritingSettings> }) {
  const [value, setValue] = useState(initial);
  return (
    <WritingProvider value={{ ...DEFAULT_WRITING_SETTINGS, ...writing }}>
      <MarkdownEditor
        noteId={7}
        value={value}
        onChange={setValue}
        ratio={0.5}
        onRatioChange={vi.fn()}
        onRatioCommit={vi.fn()}
        view="markdown"
      />
    </WritingProvider>
  );
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");

/** Types `text` at the end of the editor the way a keyboard does: a character at a time, each an `insertText` input. */
function type(text: string) {
  for (const char of text) {
    const el = editor();
    const next = el.value + char;
    fireEvent.input(el, { target: { value: next }, inputType: "insertText", data: char });
    // A change that does not come from typing leaves the caret where the browser put it, at the end.
    if (el.selectionStart === el.value.length - 1) el.setSelectionRange(el.value.length, el.value.length);
  }
}

afterEach(cleanup);

describe("the editor's ruler", () => {
  it("is not drawn unless switched on", () => {
    render(<Harness writing={{ rulerColumn: 72 }} />);

    expect(screen.queryByTestId("editor-ruler")).toBeNull();
  });

  it("is drawn at the chosen column, counted in the editor's own characters", () => {
    render(<Harness writing={{ rulerEnabled: true, rulerColumn: 72 }} />);

    const ruler = screen.getByTestId("editor-ruler");
    expect(ruler.getAttribute("aria-hidden")).toBe("true");
    expect((ruler.firstElementChild as HTMLElement).style.left).toContain("72ch");
  });

  it("never changes the text", () => {
    render(<Harness writing={{ rulerEnabled: true, rulerColumn: 20 }} />);

    type("the quick brown fox jumps over the lazy dog");

    expect(editor().value).toBe("the quick brown fox jumps over the lazy dog");
  });
});

describe("the editor's reflow", () => {
  const on = { reflowEnabled: true, reflowColumn: 20 };

  it("does nothing unless switched on", () => {
    render(<Harness writing={{ reflowColumn: 20 }} />);

    type("the quick brown fox jumps over the lazy dog");

    expect(editor().value).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("breaks a line as it is typed past the column, and keeps typing after the break", () => {
    render(<Harness writing={on} />);

    type("the quick brown fox jumps over the lazy dog");

    expect(editor().value).toBe("the quick brown fox\njumps over the lazy\ndog");
    expect(editor().selectionStart).toBe(editor().value.length);
  });

  it("lines a list item's continuation up under its text", () => {
    render(<Harness writing={on} />);

    type("- the quick brown fox jumps");

    expect(editor().value).toBe("- the quick brown\n  fox jumps");
  });

  it("leaves a table row whole, unless asked to break it", () => {
    const row = "| the quick brown fox | jumps over |";
    const { unmount } = render(<Harness writing={on} />);
    type(row);
    expect(editor().value).toBe(row);
    unmount();

    render(<Harness writing={{ ...on, reflowKeepsTables: false }} />);
    type(row);
    expect(editor().value).toBe("| the quick brown\nfox | jumps over |");
  });

  it("leaves pasted text, and text that is not being typed, alone", () => {
    render(<Harness writing={on} />);
    const long = "the quick brown fox jumps over the lazy dog";

    fireEvent.input(editor(), { target: { value: long }, inputType: "insertFromPaste" });
    expect(editor().value).toBe(long);

    fireEvent.change(editor(), { target: { value: `${long}!` } });
    expect(editor().value).toBe(`${long}!`);
  });
});
