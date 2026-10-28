import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { AUTOSAVE_DELAY_MS, createWorkspaceStore, type WorkspaceDeps } from "./workspaceStore";
import { DEFAULT_HOME_SETTINGS } from "@/lib/composition/home";
import { openNoteBeside } from "./panes";
import type { Group, Note, Notebook } from "./types";

const note = (id: number, over: Partial<Note> = {}): Note => ({
  id,
  title: `Note ${id}`,
  content: `---\nupdatedAt: old\n---\nbody ${id}`,
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  notebookId: 1,
  ...over,
});

const group = (id: number, over: Partial<Group> = {}): Group => ({
  id,
  name: `Group ${id}`,
  parentId: null,
  notebookId: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const notebook = (id: number, over: Partial<Notebook> = {}): Notebook => ({
  id,
  name: `Notebook ${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** What the server hands back after a save: the same text with its frontmatter re-stamped. */
const restamped = (saved: Note, content: string): Note => ({
  ...saved,
  content: content.replace("updatedAt: old", "updatedAt: new"),
  updatedAt: "2026-02-02T00:00:00.000Z",
});

/** Only the bridge is faked; each method defaults to doing nothing, and a test replaces the ones it cares about. */
function fakeDeps(over: Partial<WorkspaceDeps> = {}): WorkspaceDeps {
  return { saveNoteContent: vi.fn(async (id: number, content: string) => restamped(note(id), content)), ...over } as WorkspaceDeps;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("shows an edit at once and saves it once, after the delay", async () => {
    const deps = fakeDeps();
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);

    store.editNote(1, "first");
    store.editNote(1, "second");
    expect(store.getSnapshot().notes[0].content).toBe("second");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(deps.saveNoteContent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(1, "second");
  });

  it("takes the saved metadata but keeps the text you typed", async () => {
    const deps = fakeDeps({
      saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...restamped(note(id), content), title: "Renamed" })),
    });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);

    store.editNote(1, "typed ---\nupdatedAt: old");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    const [saved] = store.getSnapshot().notes;
    expect(saved.title).toBe("Renamed");
    expect(saved.updatedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(saved.content).toBe("typed ---\nupdatedAt: old");
  });

  it("does not overwrite text typed while a save is in flight", async () => {
    let finishFirstSave: (saved: Note) => void = () => {};
    const saveNoteContent = vi.fn(() => new Promise<Note>((resolve) => (finishFirstSave = resolve)));
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, fakeDeps({ saveNoteContent }));

    store.editNote(1, "first");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    store.editNote(1, "first, and more");
    finishFirstSave(restamped(note(1), "first"));
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getSnapshot().notes[0].content).toBe("first, and more");
  });

  it("gives each note its own pause, so editing one does not postpone another's save", async () => {
    const deps = fakeDeps();
    const store = createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, deps);

    store.editNote(1, "one");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    store.editNote(2, "two");
    await vi.advanceTimersByTimeAsync(100);

    expect(deps.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(1, "one");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(2, "two");
  });

  it("says when what a flush sent has been saved, so a window being closed can wait for it", async () => {
    let finish!: (note: Note) => void;
    const deps = fakeDeps({ saveNoteContent: vi.fn(() => new Promise<Note>((resolve) => (finish = resolve))) });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);
    store.editNote(1, "typed");

    let done = false;
    const flushed = store.flushSaves().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(1, "typed");
    expect(done).toBe(false);

    finish(restamped(note(1), "typed"));
    await flushed;
    expect(done).toBe(true);
  });

  it("is done at once when there is nothing to flush, and when a save fails", async () => {
    const deps = fakeDeps({ saveNoteContent: vi.fn(async () => Promise.reject(new Error("database closed"))) });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);

    await expect(store.flushSaves()).resolves.toBeUndefined();

    store.editNote(1, "typed");
    await expect(store.flushSaves()).resolves.toBeUndefined();
  });

  it("sends every pending save at once on flush, or just the one note's", async () => {
    const deps = fakeDeps();
    const store = createWorkspaceStore({ notes: [note(1), note(2), note(3)], groups: [] }, deps);

    store.editNote(1, "one");
    store.editNote(2, "two");
    store.editNote(3, "three");
    store.flushSaves(2);
    expect(deps.saveNoteContent).toHaveBeenCalledTimes(1);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(2, "two");

    store.flushSaves();
    expect(deps.saveNoteContent).toHaveBeenCalledTimes(3);

    // Nothing is left to fire when the pause would have ended.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(deps.saveNoteContent).toHaveBeenCalledTimes(3);
  });
});

const flushPromises = () => vi.advanceTimersByTimeAsync(0);
const noteIds = (store: ReturnType<typeof createWorkspaceStore>) => store.getSnapshot().notes.map((n) => n.id);
const paneNoteIds = (store: ReturnType<typeof createWorkspaceStore>) => store.getSnapshot().panes.panes.map((p) => p.noteId);

describe("notes", () => {
  it("creates a note at the top of the list and opens it, sending pending edits first", async () => {
    const created = note(9, { title: "Untitled", content: "" });
    const deps = fakeDeps({ createNote: vi.fn(async () => created) });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);
    store.editNote(1, "unsaved");

    const result = await store.createNote(null, 1);

    expect(deps.saveNoteContent).toHaveBeenCalledWith(1, "unsaved");
    expect(deps.createNote).toHaveBeenCalledWith("Untitled", null, 1);
    expect(result).toBe(created);
    expect(noteIds(store)).toEqual([9, 1]);
    expect(store.getSnapshot().panes.focusedId).toBe(9);
  });

  it("removes a note: no stray save, its pane closed, and the backend told", async () => {
    const deps = fakeDeps({ deleteNote: vi.fn(async () => {}) });
    const store = createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, deps);
    store.updatePanes((panes) => openNoteBeside(panes, 2));
    expect(paneNoteIds(store)).toEqual([1, 2]);
    store.editNote(2, "typing when it is deleted");

    store.removeNote(2);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(deps.saveNoteContent).not.toHaveBeenCalled();
    expect(deps.deleteNote).toHaveBeenCalledWith(2);
    expect(noteIds(store)).toEqual([1]);
    expect(paneNoteIds(store)).toEqual([1]);
  });

  it("files a note in a group at once, then takes the server's version", async () => {
    const filed = note(1, { groupId: 5, updatedAt: "later" });
    const deps = fakeDeps({ moveNoteToGroup: vi.fn(async () => filed) });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, deps);

    store.moveNoteToGroup(1, 5);
    expect(store.getSnapshot().notes[0].groupId).toBe(5);
    expect(store.getSnapshot().notes[0].updatedAt).not.toBe("later");

    await flushPromises();
    expect(deps.moveNoteToGroup).toHaveBeenCalledWith(1, 5);
    expect(store.getSnapshot().notes[0].updatedAt).toBe("later");
  });

  it("puts a note before a sibling at once, and does nothing when nothing would change", async () => {
    const deps = fakeDeps({ placeNote: vi.fn(async (id: number) => note(id, { updatedAt: "later" })) });
    const store = createWorkspaceStore({ notes: [note(1), note(2), note(3)], groups: [] }, deps);

    store.placeNote(1, null, 2);
    store.placeNote(3, null, 1);
    expect(noteIds(store)).toEqual([3, 1, 2]);
    expect(deps.placeNote).toHaveBeenCalledTimes(1);
    expect(deps.placeNote).toHaveBeenCalledWith(3, null, 1);

    await flushPromises();
    expect(store.getSnapshot().notes[0].updatedAt).toBe("later");
  });
});

const parentOf = (store: ReturnType<typeof createWorkspaceStore>, id: number) =>
  store.getSnapshot().groups.find((g) => g.id === id)?.parentId;

describe("the AI helper's chats", () => {
  it("are forgotten, with any answer still streaming, when their note is removed", () => {
    const assistant = createChatsStore({ streamChat: vi.fn() });
    const forget = vi.spyOn(assistant, "forgetNote");
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, fakeDeps({ deleteNote: vi.fn(async () => {}) }), assistant);

    expect(store.assistant).toBe(assistant);
    store.removeNote(1);

    expect(forget).toHaveBeenCalledWith(1);
  });
});

describe("groups", () => {
  it("adds a group the backend made", async () => {
    const made = group(7, { name: "Trips", parentId: 1 });
    const deps = fakeDeps({ createGroup: vi.fn(async () => made) });
    const store = createWorkspaceStore({ notes: [], groups: [group(1)] }, deps);

    await store.createGroup("Trips", 1, 1);

    expect(deps.createGroup).toHaveBeenCalledWith("Trips", 1, 1);
    expect(store.getSnapshot().groups).toContain(made);
  });

  it("renames a group at once, then takes the server's version", async () => {
    const deps = fakeDeps({ renameGroup: vi.fn(async (id: number, name: string) => group(id, { name: name.trim(), updatedAt: "later" })) });
    const store = createWorkspaceStore({ notes: [], groups: [group(1)] }, deps);

    store.renameGroup(1, "  Plans ");
    expect(store.getSnapshot().groups[0].name).toBe("  Plans ");

    await flushPromises();
    expect(store.getSnapshot().groups[0]).toMatchObject({ name: "Plans", updatedAt: "later" });
  });

  it("moves a group under another at once, and puts it back with the reason when the backend refuses", async () => {
    const moveGroup = vi.fn(async () => ({ error: "That would create a loop." }));
    const store = createWorkspaceStore({ notes: [], groups: [group(1), group(2)] }, fakeDeps({ moveGroup }));

    const pending = store.moveGroup(2, 1);
    expect(parentOf(store, 2)).toBe(1);

    expect(await pending).toEqual({ error: "That would create a loop." });
    expect(parentOf(store, 2)).toBeNull();
  });

  it("does not even ask to move a group beneath itself", async () => {
    const deps = fakeDeps({ moveGroup: vi.fn() });
    const store = createWorkspaceStore({ notes: [], groups: [group(1), group(2, { parentId: 1 })] }, deps);

    expect(await store.moveGroup(1, 2)).toEqual({});
    expect(deps.moveGroup).not.toHaveBeenCalled();
    expect(parentOf(store, 1)).toBeNull();
  });

  it("takes the server's group after a move it accepted", async () => {
    const deps = fakeDeps({ moveGroup: vi.fn(async (id: number, parentId: number | null) => ({ group: group(id, { parentId, updatedAt: "later" }) })) });
    const store = createWorkspaceStore({ notes: [], groups: [group(1), group(2)] }, deps);

    expect(await store.moveGroup(2, 1)).toEqual({});
    expect(store.getSnapshot().groups.find((g) => g.id === 2)).toMatchObject({ parentId: 1, updatedAt: "later" });
  });

  it("orders groups among their siblings at once, and puts them back when the backend refuses", async () => {
    const placeGroup = vi.fn(async () => ({ error: "No." }));
    const store = createWorkspaceStore({ notes: [], groups: [group(1), group(2), group(3)] }, fakeDeps({ placeGroup }));

    const pending = store.placeGroup(3, null, 1);
    expect(store.getSnapshot().groups.map((g) => g.id)).toEqual([3, 1, 2]);
    expect(placeGroup).toHaveBeenCalledWith(3, null, 1);

    expect(await pending).toEqual({ error: "No." });
    expect(store.getSnapshot().groups.map((g) => g.id)).toEqual([1, 2, 3]);
  });

  it("deletes a group only once the backend agrees", async () => {
    const deleteGroup = vi.fn().mockResolvedValueOnce({ error: "Not now." }).mockResolvedValueOnce({});
    const store = createWorkspaceStore({ notes: [], groups: [group(1), group(2)] }, fakeDeps({ deleteGroup }));

    expect(await store.deleteGroup(2)).toEqual({ error: "Not now." });
    expect(store.getSnapshot().groups.map((g) => g.id)).toEqual([1, 2]);

    expect(await store.deleteGroup(2)).toEqual({});
    expect(store.getSnapshot().groups.map((g) => g.id)).toEqual([1]);
  });

  it("moves a group, its sub-groups and their notes to another notebook, and undoes it on a refusal", async () => {
    const moveGroupToNotebook = vi.fn().mockResolvedValueOnce({ error: "No room." });
    const store = createWorkspaceStore(
      {
        notes: [note(1, { groupId: 2 }), note(2, { groupId: 3 }), note(3)],
        groups: [group(1), group(2, { parentId: 1 }), group(3, { parentId: 2 })],
        notebooks: [notebook(1), notebook(5)],
      },
      fakeDeps({ moveGroupToNotebook }),
    );

    const pending = store.moveGroupToNotebook(2, 5);
    const { groups, notes } = store.getSnapshot();
    expect(groups.map((g) => [g.id, g.notebookId, g.parentId])).toEqual([[1, 1, null], [2, 5, null], [3, 5, 2]]);
    expect(notes.map((n) => n.notebookId)).toEqual([5, 5, 1]);

    expect(await pending).toEqual({ error: "No room." });
    expect(store.getSnapshot().groups.map((g) => g.notebookId)).toEqual([1, 1, 1]);
    expect(store.getSnapshot().notes.map((n) => n.notebookId)).toEqual([1, 1, 1]);
  });
});

describe("notebooks", () => {
  it("adds a notebook the backend made", async () => {
    const made = notebook(9, { name: "Work" });
    const deps = fakeDeps({ createNotebook: vi.fn(async () => made) });
    const store = createWorkspaceStore({ notes: [], groups: [], notebooks: [notebook(1)] }, deps);

    expect(await store.createNotebook("Work")).toBe(made);
    expect(store.getSnapshot().notebooks.map((n) => n.id)).toEqual([1, 9]);
  });

  it("renames a notebook at once, then takes the server's version", async () => {
    const deps = fakeDeps({ renameNotebook: vi.fn(async (id: number, name: string) => notebook(id, { name: name.trim() })) });
    const store = createWorkspaceStore({ notes: [], groups: [], notebooks: [notebook(1)] }, deps);

    store.renameNotebook(1, " Home ");
    expect(store.getSnapshot().notebooks[0].name).toBe(" Home ");
    await flushPromises();
    expect(store.getSnapshot().notebooks[0].name).toBe("Home");
  });

  it("reorders notebooks at once, takes the backend's order, and goes back if the call fails", async () => {
    const placeNotebook = vi
      .fn()
      .mockResolvedValueOnce([notebook(3), notebook(1), notebook(2)])
      .mockRejectedValueOnce(new Error("offline"));
    const store = createWorkspaceStore({ notes: [], groups: [], notebooks: [notebook(1), notebook(2), notebook(3)] }, fakeDeps({ placeNotebook }));
    const ids = () => store.getSnapshot().notebooks.map((n) => n.id);

    const first = store.placeNotebook(3, 1);
    expect(ids()).toEqual([3, 1, 2]);
    await first;
    expect(ids()).toEqual([3, 1, 2]);

    await store.placeNotebook(2, 3);
    expect(ids()).toEqual([3, 1, 2]);
    expect(placeNotebook).toHaveBeenCalledTimes(2);
  });

  it("deletes an empty notebook only once the backend agrees", async () => {
    const deleteNotebook = vi.fn().mockResolvedValueOnce({ error: "It still has notes." }).mockResolvedValueOnce({});
    const store = createWorkspaceStore({ notes: [], groups: [], notebooks: [notebook(1), notebook(2)] }, fakeDeps({ deleteNotebook }));

    expect(await store.deleteNotebook(2)).toEqual({ error: "It still has notes." });
    expect(store.getSnapshot().notebooks.map((n) => n.id)).toEqual([1, 2]);
    expect(await store.deleteNotebook(2)).toEqual({});
    expect(store.getSnapshot().notebooks.map((n) => n.id)).toEqual([1]);
  });
});

describe("favorites and Home", () => {
  it("pins and unpins, saving the whole list each time and building on the latest", () => {
    const deps = fakeDeps({ saveFavorites: vi.fn(async () => {}) });
    const store = createWorkspaceStore({ notes: [note(1)], groups: [group(2)] }, deps);

    store.toggleFavorite("note", 1);
    store.toggleFavorite("group", 2);
    expect(deps.saveFavorites).toHaveBeenNthCalledWith(1, [{ type: "note", id: 1 }]);
    expect(deps.saveFavorites).toHaveBeenNthCalledWith(2, [{ type: "note", id: 1 }, { type: "group", id: 2 }]);

    store.toggleFavorite("note", 1);
    expect(store.getSnapshot().favorites).toEqual([{ type: "group", id: 2 }]);
  });

  it("unpins a note when it is deleted, and a group once the backend has deleted it", async () => {
    const deps = fakeDeps({
      deleteNote: vi.fn(async () => {}),
      deleteGroup: vi.fn(async () => ({})),
      saveFavorites: vi.fn(async () => {}),
    });
    const store = createWorkspaceStore(
      { notes: [note(1)], groups: [group(2)], favorites: [{ type: "note", id: 1 }, { type: "group", id: 2 }] },
      deps,
    );

    store.removeNote(1);
    expect(store.getSnapshot().favorites).toEqual([{ type: "group", id: 2 }]);
    await store.deleteGroup(2);
    expect(store.getSnapshot().favorites).toEqual([]);
    expect(deps.saveFavorites).toHaveBeenLastCalledWith([]);
  });

  it("pins a notebook on Home, and unpins it when the notebook is deleted", async () => {
    const deps = fakeDeps({ saveHomeSettings: vi.fn(async () => ({})), deleteNotebook: vi.fn(async () => ({})) });
    const store = createWorkspaceStore({ notes: [], groups: [], notebooks: [notebook(1), notebook(2)] }, deps);

    store.toggleNotebookPin(2);
    expect(store.getSnapshot().home.pinnedNotebooks).toEqual([2]);
    expect(deps.saveHomeSettings).toHaveBeenLastCalledWith({ ...DEFAULT_HOME_SETTINGS, pinnedNotebooks: [2] });

    await store.deleteNotebook(2);
    expect(store.getSnapshot().home.pinnedNotebooks).toEqual([]);
    expect(deps.saveHomeSettings).toHaveBeenLastCalledWith({ ...DEFAULT_HOME_SETTINGS, pinnedNotebooks: [] });
  });
});

describe("a note made from an AI answer", () => {
  it("is filed beside the note it was asked about and opened to its right", async () => {
    const created = note(9, { groupId: 4, notebookId: 2, content: "" });
    const deps = fakeDeps({ createNote: vi.fn(async () => created) });
    const store = createWorkspaceStore({ notes: [note(1, { groupId: 4, notebookId: 2 })], groups: [] }, deps);

    await store.newNoteFromText(1, "A good answer.", 1);

    expect(deps.createNote).toHaveBeenCalledWith(expect.any(String), 4, 2);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(9, expect.stringContaining("A good answer."));
    expect(noteIds(store)).toEqual([9, 1]);
    expect(paneNoteIds(store)).toEqual([1, 9]);
  });
});

describe("reconcile", () => {
  it("takes the database's version, keeps typed text that is still unsaved, and closes panes whose note is gone", async () => {
    const deps = fakeDeps();
    const store = createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, deps);
    store.updatePanes((panes) => openNoteBeside(panes, 2));
    store.editNote(2, "typed, not yet saved");

    store.reconcile({
      notes: [note(2, { title: "Renamed elsewhere" }), note(3)],
      groups: [group(1)],
      notebooks: [notebook(1), notebook(2)],
      favorites: [{ type: "note", id: 3 }],
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notes.map((n) => n.id)).toEqual([2, 3]);
    expect(snapshot.notes[0]).toMatchObject({ title: "Renamed elsewhere", content: "typed, not yet saved" });
    expect(snapshot.groups.map((g) => g.id)).toEqual([1]);
    expect(snapshot.notebooks.map((n) => n.id)).toEqual([1, 2]);
    expect(snapshot.favorites).toEqual([{ type: "note", id: 3 }]);
    expect(paneNoteIds(store)).toEqual([2]);
    expect(snapshot.panes.focusedId).toBe(2);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(deps.saveNoteContent).toHaveBeenCalledWith(2, "typed, not yet saved");
  });

  it("keeps the open panes when everything still exists", () => {
    const store = createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, fakeDeps());
    store.updatePanes((panes) => openNoteBeside(panes, 2));
    const before = store.getSnapshot().panes;

    store.reconcile({ notes: [note(1), note(2)], groups: [] });

    expect(store.getSnapshot().panes).toBe(before);
  });
});

describe("subscribing", () => {
  it("calls listeners on a change, keeps the snapshot as it was otherwise, and stops after unsubscribing", () => {
    const store = createWorkspaceStore({ notes: [note(1)], groups: [] }, fakeDeps());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();

    expect(store.getSnapshot()).toBe(before);
    store.editNote(1, "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);

    unsubscribe();
    store.editNote(1, "y");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
