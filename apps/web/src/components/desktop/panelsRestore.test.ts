import { describe, expect, it, vi } from "vitest";
import type { Note } from "@/components/notes/types";
import { loadPanelsToRestore } from "./panelsRestore";

const note = (id: number): Note => ({
  id,
  title: `Note ${id}`,
  content: "",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  notebookId: 1,
});

const saved = (...noteIds: (number | null)[]) => ({
  version: 1,
  windows: {
    main: {
      layout: { type: "panel", id: "p1" },
      panels: Object.fromEntries(
        noteIds.map((noteId, i) => [`p${i + 1}`, { kind: "note", state: { noteId, view: "split" } }]),
      ),
    },
  },
});

function fakeApi(over: { saved?: unknown; trashed?: Note[]; loadPanels?: () => Promise<unknown>; loadTrashedNotes?: () => Promise<Note[]> } = {}) {
  return {
    loadPanels: vi.fn(over.loadPanels ?? (async () => over.saved)),
    loadTrashedNotes: vi.fn(over.loadTrashedNotes ?? (async () => over.trashed ?? [])),
  };
}

describe("loading the panels to bring back", () => {
  it("is nothing, and asks nothing of the Trash Can, when no panels were saved", async () => {
    const api = fakeApi();

    expect(await loadPanelsToRestore([note(1)], api)).toEqual({ saved: undefined, trashed: [] });
    expect(api.loadTrashedNotes).not.toHaveBeenCalled();
  });

  it("asks the Trash Can only for the notes its panels show that are not among the notes", async () => {
    const api = fakeApi({ saved: saved(1, 7, 7, null, 9), trashed: [note(7)] });

    const result = await loadPanelsToRestore([note(1)], api);

    expect(api.loadTrashedNotes).toHaveBeenCalledWith([7, 9]);
    expect(result.trashed).toEqual([note(7)]);
    expect(result.saved).toEqual(saved(1, 7, 7, null, 9));
  });

  it("does not ask when every note a panel shows is still there", async () => {
    const api = fakeApi({ saved: saved(1, 2) });

    await loadPanelsToRestore([note(1), note(2)], api);

    expect(api.loadTrashedNotes).not.toHaveBeenCalled();
  });

  it("starts without the panels, rather than failing, if they cannot be read", async () => {
    const api = fakeApi({ loadPanels: async () => Promise.reject(new Error("settings unreadable")) });

    expect(await loadPanelsToRestore([note(1)], api)).toEqual({ saved: undefined, trashed: [] });
  });

  it("brings the panels back as empty ones if the Trash Can cannot be read", async () => {
    const api = fakeApi({ saved: saved(7), loadTrashedNotes: async () => Promise.reject(new Error("database busy")) });

    expect(await loadPanelsToRestore([note(1)], api)).toEqual({ saved: saved(7), trashed: [] });
  });

  it("reads past a document it does not understand", async () => {
    const api = fakeApi({ saved: { version: 99, windows: "?" } });

    expect(await loadPanelsToRestore([note(1)], api)).toEqual({ saved: { version: 99, windows: "?" }, trashed: [] });
    expect(api.loadTrashedNotes).not.toHaveBeenCalled();
  });

  it("asks about the notes shown in pop-out windows as well", async () => {
    const popout = (noteId: number) => ({ layout: { type: "panel", id: "p9" }, panels: { p9: { kind: "note", state: { noteId, view: "split" } } } });
    const document = { ...saved(1), windows: { ...saved(1).windows, w1: popout(5), w2: popout(1) } };
    const api = fakeApi({ saved: document, trashed: [note(5)] });

    const result = await loadPanelsToRestore([note(1)], api);

    expect(api.loadTrashedNotes).toHaveBeenCalledWith([5]);
    expect(result.trashed).toEqual([note(5)]);
  });

  it("asks about a note only an AI panel is pinned to, but not about one an AI panel merely follows", async () => {
    const ai = (state: unknown) => ({ kind: "ai", state });
    const document = {
      version: 1,
      windows: {
        main: {
          layout: { type: "panel", id: "p1" },
          panels: { p1: ai({ noteId: 7, follow: false }), p2: ai({ noteId: 8, follow: true }), p3: ai({ noteId: null, follow: false }) },
        },
      },
    };
    const api = fakeApi({ saved: document, trashed: [note(7)] });

    const result = await loadPanelsToRestore([note(1)], api);

    expect(api.loadTrashedNotes).toHaveBeenCalledWith([7]);
    expect(result.trashed).toEqual([note(7)]);
  });
});
