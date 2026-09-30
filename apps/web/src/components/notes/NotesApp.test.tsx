// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNote, saveLayout, saveNoteContent } from "@/lib/composition/actions";
import { DEFAULT_LAYOUT, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import type { Note } from "./types";

vi.mock("@/lib/composition/actions", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  moveNoteToGroup: vi.fn(),
  renameGroup: vi.fn(),
  saveLayout: vi.fn(),
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
  render(<NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);
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

describe("NotesApp column resizing", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sidebar = () => screen.getByRole("navigation", { name: "Notes" });
  const handle = () => screen.getByRole("separator", { name: "Resize sidebar" });

  function drag(from: number, to: number) {
    fireEvent.pointerDown(handle(), { pointerId: 1, button: 0, clientX: from });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: to });
  }

  it("starts at the saved sidebar width", () => {
    render(
      <NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={{ ...DEFAULT_LAYOUT, sidebarWidth: 300 }} />,
    );

    expect(sidebar().style.width).toBe("300px");
  });

  it("resizes the sidebar live and saves once when the drag ends", () => {
    renderEditor();

    drag(100, 160);
    expect(sidebar().style.width).toBe(`${DEFAULT_LAYOUT.sidebarWidth + 60}px`);
    expect(saveLayout).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle(), { pointerId: 1 });
    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout).toHaveBeenCalledWith({
      sidebarWidth: DEFAULT_LAYOUT.sidebarWidth + 60,
      editorRatio: DEFAULT_LAYOUT.editorRatio,
    });
  });

  it("clamps the sidebar to its min and max", () => {
    renderEditor();

    drag(500, 0);
    expect(sidebar().style.width).toBe(`${MIN_SIDEBAR_WIDTH}px`);

    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 5000 });
    expect(sidebar().style.width).toBe(`${MAX_SIDEBAR_WIDTH}px`);
  });

  it("keeps the sidebar handle when no note is open", () => {
    render(<NotesApp initialNotes={[]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);

    drag(100, 140);
    expect(sidebar().style.width).toBe(`${DEFAULT_LAYOUT.sidebarWidth + 40}px`);
  });
});

describe("NotesApp group note creation", () => {
  afterEach(cleanup);

  it("creates a note directly inside the group it was requested from", async () => {
    const group = { id: 7, name: "Work", parentId: null, createdAt: "", updatedAt: "" };
    vi.mocked(createNote).mockResolvedValue({ ...note, id: 2, groupId: 7 });
    render(<NotesApp initialNotes={[]} initialGroups={[group]} initialLayout={DEFAULT_LAYOUT} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("New note in Work"));
    });

    expect(createNote).toHaveBeenCalledWith("Untitled", 7);
  });

  it("keeps the New note / New group buttons below the note tree", () => {
    render(<NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);

    const tree = screen.getByText("Ungrouped");
    const newNote = screen.getByText("+ New note");
    expect(tree.compareDocumentPosition(newNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
