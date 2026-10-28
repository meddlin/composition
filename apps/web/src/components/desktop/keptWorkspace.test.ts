// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStore, type WorkspaceDeps } from "@/components/notes/workspaceStore";
import type { Note } from "@/components/notes/types";
import { forgetKeptWorkspace, keepWorkspace } from "./keptWorkspace";

const at = "2026-01-01T00:00:00.000Z";
const note = (id: number, over: Partial<Note> = {}): Note => ({
  id,
  title: `Note ${id}`,
  content: `body ${id}`,
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId: null,
  notebookId: 1,
  ...over,
});

const make = vi.fn((data: Parameters<typeof createWorkspaceStore>[0]) => createWorkspaceStore(data, {} as WorkspaceDeps));

afterEach(() => {
  forgetKeptWorkspace();
  make.mockClear();
});

describe("keepWorkspace", () => {
  it("makes the workspace on first use and hands back the same one afterwards", () => {
    const first = keepWorkspace({ notes: [note(1)], groups: [] }, make);
    const second = keepWorkspace({ notes: [note(1)], groups: [] }, make);

    expect(second).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("brings a kept workspace up to date with the database, and keeps what the user had open", () => {
    const first = keepWorkspace({ notes: [note(1), note(2)], groups: [] }, make);
    first.updatePanes((panes) => ({ ...panes, focusedId: 2 }));

    // Meanwhile Settings restored a note from the Trash Can and renamed another.
    const again = keepWorkspace({ notes: [note(1, { title: "Renamed" }), note(2), note(3)], groups: [] }, make);

    expect(again.getSnapshot().notes.map((n) => n.title)).toEqual(["Renamed", "Note 2", "Note 3"]);
    expect(again.getSnapshot().panes.panes.map((p) => p.noteId)).toEqual([1]);
  });

  it("sends what was typed but not yet saved when the page is left, since no screen will unmount to do it", () => {
    const saveNoteContent = vi.fn(async (id: number, content: string) => note(id, { content }));
    const store = keepWorkspace(
      { notes: [note(1)], groups: [] },
      (data) => createWorkspaceStore(data, { saveNoteContent } as unknown as WorkspaceDeps),
    );
    store.editNote(1, "typed just before quitting");
    expect(saveNoteContent).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    expect(saveNoteContent).toHaveBeenCalledWith(1, "typed just before quitting");
  });
});
