// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorControls } from "./MarkdownEditor";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const FRONTMATTER = "---\ntitle: A\ndescription: ''\ntags: []\ncreatedAt: 2026-01-01\nupdatedAt: 2026-01-01\n---\n";

let latest = "";
function Harness({ initial, controls }: { initial: string; controls: React.Ref<MarkdownEditorControls> }) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor
      noteId={7}
      value={value}
      onChange={(next) => {
        latest = next;
        setValue(next);
      }}
      ratio={0.5}
      onRatioChange={vi.fn()}
      onRatioCommit={vi.fn()}
      view="markdown"
      controls={controls}
    />
  );
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
afterEach(cleanup);

function open(initial: string) {
  const controls = createRef<MarkdownEditorControls>();
  render(<Harness initial={initial} controls={controls} />);
  return controls;
}

describe("MarkdownEditor: putting Markdown in from outside", () => {
  it("adds a block at the end of the note when the user has not been in the editor", () => {
    const controls = open(`${FRONTMATTER}first paragraph`);

    act(() => controls.current?.insertMarkdown("> quote", "block"));

    expect(latest).toBe(`${FRONTMATTER}first paragraph\n\n> quote\n\n`);
  });

  it("adds it at the caret once the user has put one there, and leaves the caret under it", () => {
    const controls = open(`${FRONTMATTER}alpha beta`);
    const at = FRONTMATTER.length + "alpha".length;
    fireEvent.focus(editor());
    editor().setSelectionRange(at, at);

    act(() => controls.current?.insertMarkdown("> quote", "block"));

    expect(latest).toBe(`${FRONTMATTER}alpha\n\n> quote\n\n beta`);
    expect(editor().selectionStart).toBe(`${FRONTMATTER}alpha\n\n> quote\n\n`.length);
  });

  it("adds inline Markdown in the words, after a space", () => {
    const controls = open(`${FRONTMATTER}see`);
    fireEvent.focus(editor());
    editor().setSelectionRange(editor().value.length, editor().value.length);

    act(() => controls.current?.insertMarkdown("[p. 3](pdf:x#p=3)", "inline"));

    expect(latest).toBe(`${FRONTMATTER}see [p. 3](pdf:x#p=3)`);
  });

  it("keeps out of the frontmatter, wherever the caret was", () => {
    const controls = open(`${FRONTMATTER}body`);
    fireEvent.focus(editor());
    editor().setSelectionRange(5, 5);

    act(() => controls.current?.insertMarkdown("> quote", "block"));

    expect(latest.startsWith(`${FRONTMATTER}> quote\n\n`)).toBe(true);
  });
});
