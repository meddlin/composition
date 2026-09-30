// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveNoteContent } from "@/lib/composition/actions";
import { NotesApp } from "./NotesApp";
import type { Note } from "./types";

vi.mock("@/lib/composition/actions", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  moveNoteToGroup: vi.fn(),
  renameGroup: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const AUTOSAVE_DELAY_MS = 500;

const note: Note = {
  id: 1,
  title: "Hello",
  content: "---\nupdatedAt: old\n---\nhello world",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
};

// What the server hands back: the same text with its frontmatter re-stamped,
// so it never matches what the user has in the textarea.
const canonical = (content: string): Note => ({
  ...note,
  content: content.replace("updatedAt: old", "updatedAt: new"),
  updatedAt: "2026-02-02T00:00:00.000Z",
});

function renderEditor() {
  render(<NotesApp initialNotes={[note]} initialGroups={[]} />);
  return screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("NotesApp autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveNoteContent).mockImplementation(async (_id, content) => canonical(content));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps the caret where it was when the debounced save completes", async () => {
    const editor = renderEditor();
    const typed = `${note.content}, again`;
    const caret = typed.indexOf("world");

    fireEvent.change(editor, { target: { value: typed } });
    editor.setSelectionRange(caret, caret);
    await advance(AUTOSAVE_DELAY_MS);

    expect(saveNoteContent).toHaveBeenCalledWith(1, typed);
    expect(editor.selectionStart).toBe(caret);
    expect(editor.selectionEnd).toBe(caret);
    expect(editor.value).toBe(typed);
  });

  it("still applies the saved metadata to the rest of the UI", async () => {
    vi.mocked(saveNoteContent).mockImplementation(async (_id, content) => ({
      ...canonical(content),
      title: "Renamed",
    }));
    const editor = renderEditor();

    fireEvent.change(editor, { target: { value: `${note.content}!` } });
    await advance(AUTOSAVE_DELAY_MS);

    expect(screen.getAllByText("Renamed").length).toBeGreaterThan(0);
  });

  it("does not overwrite text typed while a save is in flight", async () => {
    let finishFirstSave: (saved: Note) => void = () => {};
    vi.mocked(saveNoteContent).mockImplementationOnce(
      () => new Promise<Note>((resolve) => (finishFirstSave = resolve)),
    );
    const editor = renderEditor();
    const first = `${note.content}!`;
    const second = `${first}!!`;

    fireEvent.change(editor, { target: { value: first } });
    await advance(AUTOSAVE_DELAY_MS);
    fireEvent.change(editor, { target: { value: second } });
    await act(async () => finishFirstSave(canonical(first)));

    expect(editor.value).toBe(second);
  });
});
