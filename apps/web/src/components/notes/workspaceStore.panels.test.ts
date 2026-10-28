import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { panelIds } from "../panels/layoutTree";
import type { NotePanelState } from "../panels/kinds";
import { assistantSubject, focusedPanelId } from "../panels/panelsState";
import type { Note } from "./types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceOptions, type WorkspaceStore } from "./workspaceStore";

const note = (id: number, over: Partial<Note> = {}): Note => ({
  id,
  title: `Note ${id}`,
  content: `body ${id}`,
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  notebookId: 1,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A workspace with panels and the notes given. Only the bridge is faked, and a test replaces the methods it uses. */
function gridStore(notes: Note[] = [], over: Partial<WorkspaceDeps> = {}, panels: WorkspaceOptions["panels"] = {}): WorkspaceStore {
  const deps = { deleteNote: vi.fn(async () => {}), saveNoteContent: vi.fn(async (id: number, content: string) => note(id, { content })), ...over } as WorkspaceDeps;
  return createWorkspaceStore({ notes, groups: [] }, deps, undefined, { panels });
}

const mainWindow = (store: WorkspaceStore) => store.getSnapshot().panels.windows.main;
const kindOf = (store: WorkspaceStore, panelId: string) => store.getSnapshot().panels.byId[panelId].kind;
const stateOf = (store: WorkspaceStore, panelId: string) => store.getSnapshot().panels.byId[panelId].state as NotePanelState;
const focused = (store: WorkspaceStore) => focusedPanelId(mainWindow(store));
/** The note each panel shows, left to right; "-" for a panel that is not a note panel. */
const notesShown = (store: WorkspaceStore) =>
  panelIds(mainWindow(store).layout).map((id) => (kindOf(store, id) === "note" ? (stateOf(store, id).noteId ?? 0) : "-"));

describe("a workspace's panels", () => {
  it("start as one empty panel, focused", () => {
    const store = gridStore();

    const { layout, focusOrder } = mainWindow(store);
    const [only, ...others] = panelIds(layout);

    expect(others).toEqual([]);
    expect(kindOf(store, only)).toBe("empty");
    expect(focusOrder).toEqual([only]);
  });

  it("split a panel, putting a new empty one beside it and focusing that", () => {
    const store = gridStore();
    const [first] = panelIds(mainWindow(store).layout);

    const second = store.splitPanel(first, "right")!;

    const { layout, focusOrder } = mainWindow(store);
    expect(panelIds(layout)).toEqual([first, second]);
    expect(layout).toMatchObject({ type: "split", direction: "row" });
    expect(kindOf(store, second)).toBe("empty");
    expect(focusOrder).toEqual([second, first]);
  });

  it("split above or below into a column, and to the left ahead of the panel", () => {
    const store = gridStore();
    const [first] = panelIds(mainWindow(store).layout);

    const above = store.splitPanel(first, "top")!;
    expect(panelIds(mainWindow(store).layout)).toEqual([above, first]);
    expect(mainWindow(store).layout).toMatchObject({ direction: "column" });

    const left = store.splitPanel(above, "left")!;
    expect(panelIds(mainWindow(store).layout)).toEqual([left, above, first]);
  });

  it("do nothing, and make no panel, for a panel that is not there", () => {
    const store = gridStore();
    const before = store.getSnapshot().panels;

    expect(store.splitPanel("nope", "right")).toBeNull();
    expect(store.getSnapshot().panels).toBe(before);
  });

  it("close a panel, forgetting it and focusing the one the user used before it", () => {
    const store = gridStore();
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    const c = store.splitPanel(b, "right")!; // used in the order a, b, c
    store.focusPanel(a);
    store.focusPanel(c); // now c, a, b

    store.closePanel(c);

    expect(panelIds(mainWindow(store).layout)).toEqual([a, b]);
    expect(mainWindow(store).focusOrder).toEqual([a, b]);
    expect(store.getSnapshot().panels.byId[c]).toBeUndefined();
  });

  it("close the last panel by leaving a new empty one, which a window always has", () => {
    const store = gridStore();
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelKind(only, "notes-browser");

    store.closePanel(only);

    const [left, ...others] = panelIds(mainWindow(store).layout);
    expect(others).toEqual([]);
    expect(kindOf(store, left)).toBe("empty");
    expect(store.getSnapshot().panels.byId[only]).toBeUndefined();
  });

  it("leave an only panel that is already empty as it is", () => {
    const store = gridStore();
    const [only] = panelIds(mainWindow(store).layout);
    const before = store.getSnapshot().panels;

    store.closePanel(only);

    expect(store.getSnapshot().panels).toBe(before);
  });

  it("ignore closing a panel that is not there", () => {
    const store = gridStore();
    const before = store.getSnapshot().panels;

    store.closePanel("nope");

    expect(store.getSnapshot().panels).toBe(before);
  });
});

describe("picking a note, as in the sidebar", () => {
  const notes = [note(1), note(2), note(3)];

  it("fills the empty panel a window starts with", () => {
    const store = gridStore(notes);
    const [only] = panelIds(mainWindow(store).layout);

    store.openNote(2);

    expect(kindOf(store, only)).toBe("note");
    expect(stateOf(store, only)).toEqual({ noteId: 2, view: "split" });
  });

  it("replaces the note in the focused note panel, keeping how it is viewed", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelState(only, { noteId: 1, view: "preview" });

    store.openNote(2);

    expect(stateOf(store, only)).toEqual({ noteId: 2, view: "preview" });
  });

  it("focuses the panel that already shows the note rather than showing it twice", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2); // fills b, which is focused
    store.focusPanel(a);

    store.openNote(2);

    expect(notesShown(store)).toEqual([1, 2]);
    expect(focused(store)).toBe(b);
  });

  it("goes to the most recently used note panel when a panel of another kind is focused", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const browser = store.splitPanel(a, "right")!;
    store.setPanelKind(browser, "notes-browser");

    store.openNote(2);

    expect(notesShown(store)).toEqual([2, "-"]);
    expect(focused(store)).toBe(a);
  });

  it("opens a new note panel to the right of the focused panel when there is no note panel", () => {
    const store = gridStore(notes);
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelKind(only, "notes-browser");

    store.openNote(3);

    expect(notesShown(store)).toEqual(["-", 3]);
    expect(focused(store)).not.toBe(only);
  });
});

describe("opening a note to the side", () => {
  const notes = [note(1), note(2)];

  it("takes the only panel when that is an empty one", () => {
    const store = gridStore(notes);

    store.openNoteBeside(1);

    expect(notesShown(store)).toEqual([1]);
  });

  it("makes a new note panel to the right of the focused one, which is on the editor tab", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);

    store.openNoteBeside(2);

    const [, b] = panelIds(mainWindow(store).layout);
    expect(notesShown(store)).toEqual([1, 2]);
    expect(stateOf(store, b)).toEqual({ noteId: 2, view: "markdown" });
    expect(focused(store)).toBe(b);
    expect(stateOf(store, a).noteId).toBe(1);
  });

  it("shows the note a second time when it is already open, since opening to the side is asked for", () => {
    const store = gridStore(notes);
    store.openNote(1);

    store.openNoteBeside(1);

    expect(notesShown(store)).toEqual([1, 1]);
  });
});

describe("dropping a note on a panel", () => {
  const notes = [note(1), note(2)];

  it("fills an empty panel when dropped on its middle", () => {
    const store = gridStore(notes);
    const [only] = panelIds(mainWindow(store).layout);

    store.dropNote(2, only, "center");

    expect(stateOf(store, only)).toEqual({ noteId: 2, view: "split" });
  });

  it("replaces the note of a note panel when dropped on its middle, keeping its tab", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelState(only, { noteId: 1, view: "preview" });

    store.dropNote(2, only, "center");

    expect(stateOf(store, only)).toEqual({ noteId: 2, view: "preview" });
  });

  it("makes a new note panel on the side it was dropped, whatever the panel shows", () => {
    const store = gridStore(notes);
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelKind(only, "notes-browser");

    store.dropNote(2, only, "left");
    store.dropNote(1, only, "bottom");

    expect(notesShown(store)).toEqual([2, "-", 1]); // the second drop nests a column in the browser's place
    expect(mainWindow(store).layout).toMatchObject({ direction: "row" });
    expect(focused(store)).not.toBe(only);
  });

  it("does nothing when dropped on the middle of a panel that cannot show a note", () => {
    const store = gridStore(notes);
    const [only] = panelIds(mainWindow(store).layout);
    store.setPanelKind(only, "notes-browser");
    const before = store.getSnapshot().panels;

    store.dropNote(2, only, "center");

    expect(store.getSnapshot().panels).toBe(before);
  });
});

describe("notes made while there are panels", () => {
  it("opens a new note in a panel, and leaves the web app's row of panes alone", async () => {
    const created = note(9, { content: "" });
    const store = gridStore([note(1)], { createNote: vi.fn(async () => created) });

    await store.createNote(null, 1);

    expect(notesShown(store)).toEqual([9]);
    expect(store.getSnapshot().panes.panes).toEqual([]);
  });

  it("opens a note made from an AI answer beside the panel that showed the note it was asked about", async () => {
    const created = note(9, { content: "" });
    const store = gridStore([note(1), note(2)], { createNote: vi.fn(async () => created) });
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    store.splitPanel(a, "right");
    store.openNote(2); // the focused panel is the one on the right

    await store.newNoteFromText(1, "A good answer.", 1);

    expect(notesShown(store)).toEqual([1, 9, 2]);
  });
});

describe("a note deleted while it is shown in a panel", () => {
  it("stays in its panel, with the text it had, apart from the notes", () => {
    const store = gridStore([note(1), note(2)]);
    store.openNote(1);
    store.editNote(1, "typed before the delete");
    const [panel] = panelIds(mainWindow(store).layout);

    store.removeNote(1);

    expect(notesShown(store)).toEqual([1]);
    expect(stateOf(store, panel).noteId).toBe(1);
    expect(store.getSnapshot().notes.map((n) => n.id)).toEqual([2]);
    expect(store.getSnapshot().deleted).toEqual([expect.objectContaining({ id: 1, content: "typed before the delete" })]);
  });

  it("is not kept for a note no panel shows", () => {
    const store = gridStore([note(1), note(2)]);
    store.openNote(1);

    store.removeNote(2);

    expect(store.getSnapshot().deleted).toEqual([]);
  });

  it("cannot be edited, and sends nothing to be saved", async () => {
    const deps = { saveNoteContent: vi.fn() };
    const store = gridStore([note(1)], deps);
    store.openNote(1);
    store.removeNote(1);

    store.editNote(1, "typed after");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(deps.saveNoteContent).not.toHaveBeenCalled();
    expect(store.getSnapshot().deleted[0].content).toBe("body 1");
  });

  it("is forgotten once its panel is closed or shows another note", () => {
    const store = gridStore([note(1), note(2), note(3)]);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    store.removeNote(1);
    store.removeNote(2);
    expect(store.getSnapshot().deleted.map((n) => n.id)).toEqual([1, 2]);

    store.closePanel(a);
    expect(store.getSnapshot().deleted.map((n) => n.id)).toEqual([2]);

    store.openNote(3); // replaces the note in b
    expect(store.getSnapshot().deleted).toEqual([]);
    expect(stateOf(store, b).noteId).toBe(3);
  });

  it("comes back to life when the database has the note again", () => {
    const store = gridStore([note(1), note(2)]);
    store.openNote(1);
    store.removeNote(1);

    store.reconcile({ notes: [note(1, { title: "Restored" }), note(2)], groups: [] });

    expect(store.getSnapshot().deleted).toEqual([]);
    expect(store.getSnapshot().notes.find((n) => n.id === 1)?.title).toBe("Restored");
    expect(notesShown(store)).toEqual([1]);
  });

  it("is also what a shown note becomes when the database no longer has it", () => {
    const store = gridStore([note(1), note(2)]);
    store.openNote(1);

    store.reconcile({ notes: [note(2)], groups: [] });

    expect(notesShown(store)).toEqual([1]);
    expect(store.getSnapshot().deleted).toEqual([expect.objectContaining({ id: 1 })]);
  });
});

describe("following a link in a note's preview", () => {
  const notes = [note(1), note(2), note(3)];

  it("shows the linked note in the panel the link was in", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);

    store.openLinkedNote(2, a, false);

    expect(notesShown(store)).toEqual([2]);
  });

  it("opens it to the right of that panel when asked to", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    store.splitPanel(a, "right");
    store.openNote(3);

    store.openLinkedNote(2, a, true);

    expect(notesShown(store)).toEqual([1, 2, 3]);
  });

  it("focuses the panel that already shows the note, rather than showing it twice", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    store.focusPanel(a);

    store.openLinkedNote(2, a, false);
    expect(notesShown(store)).toEqual([1, 2]);
    expect(focused(store)).toBe(b);

    store.focusPanel(a);
    store.openLinkedNote(2, a, true);
    expect(notesShown(store)).toEqual([1, 2]);
    expect(focused(store)).toBe(b);
  });

  it("ignores a link to a note that does not exist", () => {
    const store = gridStore(notes);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const before = store.getSnapshot().panels;

    store.openLinkedNote(99, a, false);

    expect(store.getSnapshot().panels).toBe(before);
  });
});

describe("rearranging panels", () => {
  it("moves a panel to the side of another it was dropped on", () => {
    const store = gridStore();
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    const c = store.splitPanel(b, "right")!;

    store.movePanel(a, c, "right");

    expect(panelIds(mainWindow(store).layout)).toEqual([b, c, a]);
    expect(focused(store)).toBe(a);
  });

  it("swaps two panels when one is dropped on the middle of the other", () => {
    const store = gridStore();
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;

    store.movePanel(a, b, "center");

    expect(panelIds(mainWindow(store).layout)).toEqual([b, a]);
  });

  it("applies the sizes of a divider drag to the split at a path", () => {
    const store = gridStore();
    const [a] = panelIds(mainWindow(store).layout);
    store.splitPanel(a, "right");

    store.resizePanels([], [3, 1]);

    const { layout } = mainWindow(store);
    expect(layout.type === "split" && layout.children.map((child) => child.size)).toEqual([3, 1]);
  });
});

describe("saving the panels", () => {
  /** A store whose saves are collected. */
  function savingStore(notes: Note[] = []) {
    const save = vi.fn();
    return { store: gridStore(notes, {}, { save }), save };
  }
  const lastSaved = (save: ReturnType<typeof vi.fn>) => save.mock.lastCall![0];

  it("sends the arrangement and what each panel shows, as a versioned document, when it changes", () => {
    const { store, save } = savingStore([note(1)]);
    const [a] = panelIds(mainWindow(store).layout);

    const b = store.splitPanel(a, "right")!;
    store.openNote(1); // fills b, which is focused

    expect(lastSaved(save)).toEqual({
      version: 1,
      windows: {
        main: {
          layout: mainWindow(store).layout,
          panels: {
            [a]: { kind: "empty", state: null },
            [b]: { kind: "note", state: { noteId: 1, view: "split" } },
          },
        },
      },
    });
  });

  it("does not send anything for moving focus, which is not part of the arrangement", () => {
    const { store, save } = savingStore();
    const [a] = panelIds(mainWindow(store).layout);
    store.splitPanel(a, "right");
    save.mockClear();

    store.focusPanel(a);

    expect(save).not.toHaveBeenCalled();
  });

  it("waits for the end of a divider drag to send the sizes, rather than sending every step of it", () => {
    const { store, save } = savingStore();
    const [a] = panelIds(mainWindow(store).layout);
    store.splitPanel(a, "right");
    save.mockClear();

    store.resizePanels([], [2, 1]);
    store.resizePanels([], [3, 1]);
    expect(save).not.toHaveBeenCalled();

    store.commitPanels();
    expect(save).toHaveBeenCalledTimes(1);
    expect(lastSaved(save).windows.main.layout.children.map((child: { size: number }) => child.size)).toEqual([3, 1]);
  });
});

describe("restoring the panels", () => {
  const leaf = (id: string) => ({ type: "panel", id });
  const row = (...children: [number, object][]) => ({
    type: "split",
    direction: "row",
    children: children.map(([size, node]) => ({ size, node })),
  });
  const document = (layout: unknown, panels: unknown) => ({ version: 1, windows: { main: { layout, panels } } });
  const restored = (saved: unknown, notes: Note[] = [note(1), note(2)], trashed: Note[] = []) =>
    gridStore(notes, {}, { saved, trashed });

  it("brings back the arrangement, and what each panel showed", () => {
    const store = restored(
      document(row([2, leaf("p1")], [1, leaf("p2")]), {
        p1: { kind: "note", state: { noteId: 2, view: "preview" } },
        p2: { kind: "notes-browser", state: { notebookId: null } },
      }),
    );

    expect(panelIds(mainWindow(store).layout)).toEqual(["p1", "p2"]);
    expect(mainWindow(store).layout).toMatchObject({ children: [{ size: 2 }, { size: 1 }] });
    expect(stateOf(store, "p1")).toEqual({ noteId: 2, view: "preview" });
    expect(kindOf(store, "p2")).toBe("notes-browser");
    expect(focused(store)).toBe("p1");
  });

  it("starts with one empty panel when nothing usable was saved", () => {
    const unusable: unknown[] = [
      undefined,
      null,
      "panels",
      { version: 2, windows: { main: { layout: leaf("p1"), panels: { p1: { kind: "empty", state: null } } } } },
      { version: 1 },
      { version: 1, windows: {} },
      document("nonsense", {}),
      document(row([1, leaf("p1")], [1, leaf("p1")]), {}),
      document(leaf("__proto__"), {}),
    ];

    for (const saved of unusable) {
      const store = restored(saved);
      expect(panelIds(mainWindow(store).layout), JSON.stringify(saved)).toHaveLength(1);
      expect(kindOf(store, focused(store)), JSON.stringify(saved)).toBe("empty");
      // The new panel has an id the store made, never one taken from what was saved.
      expect(focused(store), JSON.stringify(saved)).toMatch(/^p\d+$/);
    }
  });

  it("makes an empty panel of one it cannot bring back", () => {
    const store = restored(
      document(row([1, leaf("p1")], [1, leaf("p2")], [1, leaf("p3")], [1, leaf("p4")], [1, leaf("p5")]), {
        p1: { kind: "to-do", state: {} }, // a kind this version does not have
        p2: { kind: "note", state: { noteId: 99, view: "split" } }, // a note that is gone for good
        p3: { kind: "note", state: { noteId: 1, view: "sideways" } }, // a tab that does not exist
        p4: { kind: "toString", state: null }, // not a kind, though every object has it
        // p5 was never recorded
      }),
    );

    expect(panelIds(mainWindow(store).layout).map((id) => kindOf(store, id))).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("reads a note panel that was showing no note, and a browser whose notebook is gone", () => {
    const store = restored(
      document(row([1, leaf("p1")], [1, leaf("p2")]), {
        p1: { kind: "note", state: { noteId: null, view: "markdown" } },
        p2: { kind: "notes-browser", state: { notebookId: 42 } },
      }),
    );

    expect(stateOf(store, "p1")).toEqual({ noteId: null, view: "markdown" });
    expect(store.getSnapshot().panels.byId.p2.state).toEqual({ notebookId: null });
  });

  it("keeps a note panel whose note is in the Trash Can, as a deleted note", () => {
    const trashed = note(7, { title: "Trashed" });
    const store = restored(document(leaf("p1"), { p1: { kind: "note", state: { noteId: 7, view: "split" } } }), [note(1)], [trashed, note(8)]);

    expect(stateOf(store, "p1").noteId).toBe(7);
    expect(store.getSnapshot().deleted).toEqual([trashed]); // not note 8, which no panel shows
  });

  it("makes panels with ids that do not collide with the ones it brought back", () => {
    const store = restored(document(row([1, leaf("p1")], [1, leaf("p2")]), { p1: { kind: "empty", state: null }, p2: { kind: "empty", state: null } }));

    const added = store.splitPanel("p1", "right")!;

    expect(["p1", "p2"]).not.toContain(added);
    expect(new Set(panelIds(mainWindow(store).layout)).size).toBe(3);
  });

  it("brings back what it saved", () => {
    const save = vi.fn();
    const first = gridStore([note(1), note(2)], {}, { save });
    first.openNote(2);
    const [a] = panelIds(mainWindow(first).layout);
    first.splitPanel(a, "bottom");
    const saved = JSON.parse(JSON.stringify(save.mock.lastCall![0]));

    const second = restored(saved);

    expect(mainWindow(second).layout).toEqual(mainWindow(first).layout);
    expect(notesShown(second)).toEqual(notesShown(first));
  });
});

describe("pop-out windows", () => {
  const windowIds = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);
  const panelsIn = (store: WorkspaceStore, windowId: string) => panelIds(store.getSnapshot().panels.windows[windowId].layout);
  const focusOrderIn = (store: WorkspaceStore, windowId: string) => store.getSnapshot().panels.windows[windowId].focusOrder;

  /** The main window with two note panels, [a: note 1, b: note 2]. */
  function twoNotes() {
    const store = gridStore([note(1), note(2), note(3)]);
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    return { store, a, b };
  }

  it("take a panel out of the main window into a new window, which keeps what the panel shows", () => {
    const { store, a, b } = twoNotes();

    const popout = store.movePanelToNewWindow(b)!;

    expect(popout).not.toBe("main");
    expect(windowIds(store)).toEqual(["main", popout]);
    expect(panelsIn(store, "main")).toEqual([a]);
    expect(panelsIn(store, popout)).toEqual([b]);
    expect(stateOf(store, b)).toEqual({ noteId: 2, view: "split" });
    expect(focusOrderIn(store, "main")).toEqual([a]);
    expect(focusOrderIn(store, popout)).toEqual([b]);
  });

  it("leave the main window a new empty panel when its only panel is taken out", () => {
    const store = gridStore([note(1)]);
    store.openNote(1);
    const [only] = panelIds(mainWindow(store).layout);

    const popout = store.movePanelToNewWindow(only)!;

    const [left, ...others] = panelsIn(store, "main");
    expect(others).toEqual([]);
    expect(left).not.toBe(only);
    expect(kindOf(store, left)).toBe("empty");
    expect(panelsIn(store, popout)).toEqual([only]);
  });

  it("do nothing to move the only panel of a pop-out into another new window", () => {
    const { store, b } = twoNotes();
    const popout = store.movePanelToNewWindow(b)!;
    const before = store.getSnapshot().panels;

    expect(store.movePanelToNewWindow(b)).toBeNull();
    expect(store.getSnapshot().panels).toBe(before);
    expect(windowIds(store)).toEqual(["main", popout]);
  });

  it("do nothing for a panel that is not there", () => {
    const { store } = twoNotes();
    const before = store.getSnapshot().panels;

    expect(store.movePanelToNewWindow("nope")).toBeNull();
    expect(store.getSnapshot().panels).toBe(before);
  });

  it("move a panel into another window, beside the panel used last there, and focus it", () => {
    const { store, a, b } = twoNotes();
    const popout = store.movePanelToNewWindow(b)!;
    store.openNote(3, popout); // the pop-out's only panel now shows note 3
    expect(panelsIn(store, "main")).toEqual([a]);

    store.movePanelToWindow(a, popout);

    // a left the main window, which got an empty panel; the pop-out has b and a, a focused and to the right.
    expect(panelsIn(store, popout)).toEqual([b, a]);
    expect(focusOrderIn(store, popout)[0]).toBe(a);
    expect(kindOf(store, panelsIn(store, "main")[0])).toBe("empty");
    expect(stateOf(store, a)).toEqual({ noteId: 1, view: "split" });
  });

  it("close the pop-out when its last panel is moved back to the main window", () => {
    const { store, a, b } = twoNotes();
    const popout = store.movePanelToNewWindow(b)!;

    store.movePanelToWindow(b, "main");

    expect(windowIds(store)).toEqual(["main"]);
    expect(panelsIn(store, "main")).toEqual([a, b]);
    expect(focused(store)).toBe(b);
    expect(store.getSnapshot().panels.windows[popout]).toBeUndefined();
  });

  it("not move a panel into the window it is in, or one that is not there", () => {
    const { store, a } = twoNotes();
    const before = store.getSnapshot().panels;

    store.movePanelToWindow(a, "main");
    store.movePanelToWindow(a, "w99");

    expect(store.getSnapshot().panels).toBe(before);
  });

  it("close a pop-out when its last panel is closed, rather than leaving it an empty one", () => {
    const { store, a, b } = twoNotes();
    const popout = store.movePanelToNewWindow(b)!;

    store.closePanel(b);

    expect(windowIds(store)).toEqual(["main"]);
    expect(panelsIn(store, "main")).toEqual([a]);
    expect(store.getSnapshot().panels.byId[b]).toBeUndefined();
    expect(store.getSnapshot().panels.windows[popout]).toBeUndefined();
  });

  it("close a pop-out whose only panel is empty too, since a pop-out has no reason to stay open", () => {
    const { store, b } = twoNotes();
    const popout = store.movePanelToNewWindow(b)!;
    store.setPanelKind(b, "empty");

    store.closePanel(b);

    expect(windowIds(store)).toEqual(["main"]);
    expect(store.getSnapshot().panels.windows[popout]).toBeUndefined();
  });
});

describe("closing a pop-out window", () => {
  /** The main window with note 1, and a pop-out showing note 2. */
  function withPopout() {
    const saveNoteContent = vi.fn(async (id: number, content: string) => note(id, { content }));
    const save = vi.fn();
    const store = gridStore([note(1), note(2)], { saveNoteContent }, { save });
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    const popout = store.movePanelToNewWindow(b)!;
    return { store, a, b, popout, saveNoteContent, save };
  }
  const windowIds = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);

  it("sends what was typed in it that is not saved yet, then forgets its panels", () => {
    const { store, b, popout, saveNoteContent } = withPopout();
    store.editNote(2, "typed just before closing");
    expect(saveNoteContent).not.toHaveBeenCalled(); // still inside the autosave delay

    store.closeWindow(popout);

    expect(saveNoteContent).toHaveBeenCalledWith(2, "typed just before closing");
    expect(windowIds(store)).toEqual(["main"]);
    expect(store.getSnapshot().panels.byId[b]).toBeUndefined();
  });

  it("forgets a deleted note that only that window was showing", () => {
    const { store, popout } = withPopout();
    store.removeNote(2);
    expect(store.getSnapshot().deleted.map((n) => n.id)).toEqual([2]);

    store.closeWindow(popout);

    expect(store.getSnapshot().deleted).toEqual([]);
  });

  it("is saved as gone, so it does not come back at the next launch", () => {
    const { store, popout, save } = withPopout();
    expect(Object.keys(save.mock.lastCall![0].windows)).toEqual(["main", popout]);

    store.closeWindow(popout);

    expect(Object.keys(save.mock.lastCall![0].windows)).toEqual(["main"]);
  });

  it("leaves the main window, which cannot be closed this way, and a window that is already gone", () => {
    const { store, popout } = withPopout();
    store.closeWindow(popout);
    const before = store.getSnapshot().panels;

    store.closeWindow("main");
    store.closeWindow(popout);
    store.closeWindow("w99");

    expect(store.getSnapshot().panels).toBe(before);
  });
});

describe("restoring pop-out windows", () => {
  const leaf = (id: string) => ({ type: "panel", id });
  const row = (...ids: string[]) => ({ type: "split", direction: "row", children: ids.map((id) => ({ size: 1, node: leaf(id) })) });
  const record = (kind: string, state: unknown = null) => ({ kind, state });
  const noteState = (noteId: number) => ({ noteId, view: "split" });
  const window = (layout: unknown, panels: Record<string, unknown>) => ({ layout, panels });
  const restored = (windows: Record<string, unknown>, notes: Note[] = [note(1), note(2), note(3)], trashed: Note[] = []) =>
    gridStore(notes, {}, { saved: { version: 1, windows }, trashed });
  const windowIds = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);
  const panelsIn = (store: WorkspaceStore, windowId: string) => panelIds(store.getSnapshot().panels.windows[windowId].layout);
  const main = window(leaf("p1"), { p1: record("note", noteState(1)) });

  it("brings back each window, in the order they were saved, with what its panels showed", () => {
    const store = restored({
      main,
      w1: window(row("p2", "p3"), { p2: record("note", noteState(2)), p3: record("notes-browser", { notebookId: null }) }),
      w2: window(leaf("p4"), { p4: record("note", noteState(3)) }),
    });

    expect(windowIds(store)).toEqual(["main", "w1", "w2"]);
    expect(panelsIn(store, "w1")).toEqual(["p2", "p3"]);
    expect(stateOf(store, "p2")).toEqual(noteState(2));
    expect(kindOf(store, "p3")).toBe("notes-browser");
    expect(store.getSnapshot().panels.windows.w1.focusOrder).toEqual(["p2", "p3"]);
    expect(stateOf(store, "p4")).toEqual(noteState(3));
  });

  it("makes new windows and panels with ids that do not collide with the ones it brought back", () => {
    const store = restored({ main, w1: window(leaf("p2"), { p2: record("empty") }), w3: window(leaf("p7"), { p7: record("empty") }) });

    const popout = store.movePanelToNewWindow("p1")!;
    const added = store.splitPanel("p2", "right")!;

    expect(["w1", "w3"]).not.toContain(popout);
    expect(["p1", "p2", "p7"]).not.toContain(added);
    expect(windowIds(store)).toHaveLength(4);
  });

  it("drops a pop-out it cannot read, and keeps the rest", () => {
    const store = restored({
      main,
      w1: window("nonsense", {}),
      w2: window(leaf("p5"), { p5: record("empty") }),
      "not-a-window": window(leaf("p6"), { p6: record("empty") }),
    });

    expect(windowIds(store)).toEqual(["main", "w2"]);
  });

  it("drops a pop-out that reuses a panel id from another window, since a panel is in one place", () => {
    const store = restored({ main, w1: window(leaf("p1"), { p1: record("empty") }), w2: window(leaf("p5"), { p5: record("empty") }) });

    expect(windowIds(store)).toEqual(["main", "w2"]);
    expect(kindOf(store, "p1")).toBe("note");
  });

  it("starts again with one empty panel, and no pop-outs, if the main window cannot be read", () => {
    const store = restored({ main: window("nonsense", {}), w1: window(leaf("p2"), { p2: record("empty") }) });

    expect(windowIds(store)).toEqual(["main"]);
    expect(kindOf(store, panelsIn(store, "main")[0])).toBe("empty");
  });

  it("makes an empty panel of a pop-out's note that is gone, and keeps one in the Trash Can as deleted", () => {
    const trashed = note(8, { title: "Trashed" });
    const store = restored(
      { main, w1: window(row("p2", "p3"), { p2: record("note", noteState(99)), p3: record("note", noteState(8)) }) },
      [note(1)],
      [trashed],
    );

    expect(kindOf(store, "p2")).toBe("empty");
    expect(stateOf(store, "p3").noteId).toBe(8);
    expect(store.getSnapshot().deleted).toEqual([trashed]);
  });

  it("brings back what it saved, pop-outs included", () => {
    const save = vi.fn();
    const first = gridStore([note(1), note(2)], {}, { save });
    first.openNote(1);
    const [a] = panelIds(mainWindow(first).layout);
    const b = first.splitPanel(a, "right")!;
    first.openNote(2);
    const popout = first.movePanelToNewWindow(b)!;
    first.splitPanel(b, "bottom");
    const saved = JSON.parse(JSON.stringify(save.mock.lastCall![0]));

    const second = gridStore([note(1), note(2)], {}, { saved });

    expect(windowIds(second)).toEqual(["main", popout]);
    expect(second.getSnapshot().panels.windows[popout].layout).toEqual(first.getSnapshot().panels.windows[popout].layout);
    expect(stateOf(second, b)).toEqual(stateOf(first, b));
  });
});

describe("notes made in a pop-out", () => {
  const noteIdsIn = (store: WorkspaceStore, windowId: string) =>
    panelIds(store.getSnapshot().panels.windows[windowId].layout).map((id) => (stateOf(store, id) as { noteId: number | null }).noteId);

  it("open in the window that asked for them, not in the main window", async () => {
    const created = note(9, { content: "" });
    const store = gridStore([note(1), note(2)], { createNote: vi.fn(async () => created) });
    store.openNote(1);
    const [a] = panelIds(mainWindow(store).layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    const popout = store.movePanelToNewWindow(b)!;

    await store.createNote(null, 1, popout);

    expect(noteIdsIn(store, popout)).toEqual([9]);
    expect(noteIdsIn(store, "main")).toEqual([1]);
  });
});

describe("the AI helper as a panel", () => {
  const aiState = (store: WorkspaceStore, panelId: string) => store.getSnapshot().panels.byId[panelId].state as { noteId: number | null; follow: boolean };

  describe("opened from a note panel", () => {
    it("puts an AI panel to its right, pinned to its note, and focuses it", () => {
      const store = gridStore([note(1)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);

      const ai = store.openAssistantFor(notePanel)!;

      expect(panelIds(mainWindow(store).layout)).toEqual([notePanel, ai]);
      expect(kindOf(store, ai)).toBe("ai");
      expect(aiState(store, ai)).toEqual({ noteId: 1, follow: false });
      expect(focused(store)).toBe(ai);
    });

    it("focuses the AI panel already pinned to that note, in the same window, rather than making another", () => {
      const store = gridStore([note(1)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const ai = store.openAssistantFor(notePanel)!;
      store.focusPanel(notePanel);

      const again = store.openAssistantFor(notePanel);

      expect(again).toBe(ai);
      expect(panelIds(mainWindow(store).layout)).toEqual([notePanel, ai]);
      expect(focused(store)).toBe(ai);
    });

    it("makes a second AI panel for the same note when the first is in another window", () => {
      const store = gridStore([note(1)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const first = store.openAssistantFor(notePanel)!;
      const popout = store.movePanelToNewWindow(first)!;

      const second = store.openAssistantFor(notePanel)!;

      expect(second).not.toBe(first);
      expect(panelIds(mainWindow(store).layout)).toEqual([notePanel, second]);
      expect(panelIds(store.getSnapshot().panels.windows[popout].layout)).toEqual([first]);
    });

    it("does not take an AI panel that follows, or one pinned to another note", () => {
      const store = gridStore([note(1), note(2)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const other = store.openAssistantFor(notePanel)!;
      store.setPanelState(other, { noteId: 2, follow: false });
      const following = store.splitPanel(notePanel, "bottom")!;
      store.setPanelKind(following, "ai");
      store.focusPanel(notePanel);

      const ai = store.openAssistantFor(notePanel)!;

      expect([other, following]).not.toContain(ai);
      expect(aiState(store, ai)).toEqual({ noteId: 1, follow: false });
    });

    it("does nothing for a panel that shows no note", () => {
      const store = gridStore([note(1)]);
      const [empty] = panelIds(mainWindow(store).layout);
      const before = store.getSnapshot().panels;

      expect(store.openAssistantFor(empty)).toBeNull();
      expect(store.getSnapshot().panels).toBe(before);

      store.setPanelKind(empty, "note"); // a note panel with no note yet
      const beforeNoNote = store.getSnapshot().panels;
      expect(store.openAssistantFor(empty)).toBeNull();
      expect(store.getSnapshot().panels).toBe(beforeNoNote);
    });

    it("does nothing for a panel that is not there", () => {
      const store = gridStore([note(1)]);

      expect(store.openAssistantFor("nope")).toBeNull();
    });
  });

  describe("the note an AI panel is about", () => {
    const subject = (store: WorkspaceStore, panelId: string) => assistantSubject(store.getSnapshot().panels, panelId);

    /** The main window with note panels [a: note 1, b: note 2] and an AI panel c after them, focused, that follows. */
    function following() {
      const store = gridStore([note(1), note(2), note(3)]);
      store.openNote(1);
      const [a] = panelIds(mainWindow(store).layout);
      const b = store.splitPanel(a, "right")!;
      store.openNote(2);
      const c = store.splitPanel(b, "right")!;
      store.setPanelKind(c, "ai");
      return { store, a, b, c };
    }

    it("is its own note when it is pinned, whatever else the user is working in", () => {
      const { store, a, b, c } = following();
      store.setPanelState(c, { noteId: 3, follow: false });

      store.focusPanel(a);

      expect(subject(store, c)).toBe(3);
      store.focusPanel(b);
      expect(subject(store, c)).toBe(3);
    });

    it("is the note in the note panel used last, when it follows", () => {
      const { store, a, b, c } = following();

      expect(subject(store, c)).toBe(2); // b was used last

      store.focusPanel(a);
      expect(subject(store, c)).toBe(1);
      store.focusPanel(c);
      expect(subject(store, c)).toBe(1); // the AI panel itself shows no note
      store.focusPanel(b);
      expect(subject(store, c)).toBe(2);
    });

    it("looks in its own window first, and then in the main window", () => {
      const { store, b, c } = following();
      store.movePanelToNewWindow(c);
      expect(subject(store, c)).toBe(2); // no note panel in the pop-out: the main window's, used last

      const d = store.splitPanel(c, "right")!;
      store.setPanelKind(d, "note");
      store.setPanelState(d, { noteId: 3, view: "markdown" });
      store.focusPanel(b);

      expect(subject(store, c)).toBe(3); // the pop-out's own note, though b is the main window's focused panel
    });

    it("skips a note panel that shows no note yet", () => {
      const { store, b, c } = following();
      store.setPanelState(b, { noteId: null, view: "split" });
      store.focusPanel(b);

      expect(subject(store, c)).toBe(1); // a's, since b shows none
    });

    it("is none when no note panel shows a note", () => {
      const store = gridStore([note(1)]);
      const [only] = panelIds(mainWindow(store).layout);
      store.setPanelKind(only, "ai");

      expect(subject(store, only)).toBeNull();
    });

    it("is none for a panel that is not an AI panel, or not there", () => {
      const { store, a } = following();

      expect(subject(store, a)).toBeNull();
      expect(subject(store, "nope")).toBeNull();
    });
  });

  describe("following or pinned", () => {
    /** Note panels [a: note 1, b: note 2] and an AI panel c, which follows. */
    function setup() {
      const store = gridStore([note(1), note(2)]);
      store.openNote(1);
      const [a] = panelIds(mainWindow(store).layout);
      const b = store.splitPanel(a, "right")!;
      store.openNote(2);
      const c = store.splitPanel(b, "right")!;
      store.setPanelKind(c, "ai");
      return { store, a, b, c };
    }

    it("starts out following, with no note of its own, when it is made from an empty panel", () => {
      const { store, c } = setup();

      expect(aiState(store, c)).toEqual({ noteId: null, follow: true });
    });

    it("pins to the note it was following when following is turned off", () => {
      const { store, a, c } = setup();
      store.focusPanel(a);

      store.setAssistantFollow(c, false);

      expect(aiState(store, c)).toEqual({ noteId: 1, follow: false });
      store.focusPanel(c);
      expect(assistantSubject(store.getSnapshot().panels, c)).toBe(1);
    });

    it("follows again, forgetting its note, when following is turned on", () => {
      const { store, c } = setup();
      store.setAssistantFollow(c, false);

      store.setAssistantFollow(c, true);

      expect(aiState(store, c)).toEqual({ noteId: null, follow: true });
    });

    it("stays following when there is no note to pin to", () => {
      const store = gridStore([note(1)]);
      const [only] = panelIds(mainWindow(store).layout);
      store.setPanelKind(only, "ai");
      const before = store.getSnapshot().panels;

      store.setAssistantFollow(only, false);

      expect(store.getSnapshot().panels).toBe(before);
    });

    it("changes nothing for a panel that is not an AI panel", () => {
      const { store, a } = setup();
      const before = store.getSnapshot().panels;

      store.setAssistantFollow(a, false);
      store.setAssistantFollow("nope", false);

      expect(store.getSnapshot().panels).toBe(before);
    });

    it("is saved", () => {
      const save = vi.fn();
      const store = gridStore([note(1)], {}, { save });
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const ai = store.splitPanel(notePanel, "right")!;
      store.setPanelKind(ai, "ai");

      store.setAssistantFollow(ai, false);

      expect(save.mock.lastCall![0].windows.main.panels[ai]).toEqual({ kind: "ai", state: { noteId: 1, follow: false } });
    });
  });

  describe("saved and brought back", () => {
    const leaf = (id: string) => ({ type: "panel", id });
    const row = (...ids: string[]) => ({
      type: "split",
      direction: "row",
      children: ids.map((id) => ({ size: 1, node: leaf(id) })),
    });
    const document = (panels: Record<string, unknown>) => ({
      version: 1,
      windows: { main: { layout: row(...Object.keys(panels)), panels } },
    });
    const restored = (saved: unknown, notes: Note[] = [note(1), note(2)], trashed: Note[] = []) => gridStore(notes, {}, { saved, trashed });

    it("sends an AI panel with the note it is pinned to, and whether it follows", () => {
      const save = vi.fn();
      const store = gridStore([note(1)], {}, { save });
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);

      const ai = store.openAssistantFor(notePanel)!;

      expect(save.mock.lastCall![0].windows.main.panels[ai]).toEqual({ kind: "ai", state: { noteId: 1, follow: false } });
    });

    it("brings back a pinned AI panel and one that follows", () => {
      const store = restored(
        document({
          p1: { kind: "ai", state: { noteId: 2, follow: false } },
          p2: { kind: "ai", state: { noteId: null, follow: true } },
        }),
      );

      expect(aiState(store, "p1")).toEqual({ noteId: 2, follow: false });
      expect(aiState(store, "p2")).toEqual({ noteId: null, follow: true });
    });

    it("forgets the note of an AI panel that follows, since it does not use one", () => {
      const store = restored(document({ p1: { kind: "ai", state: { noteId: 99, follow: true } } }));

      expect(aiState(store, "p1")).toEqual({ noteId: null, follow: true });
    });

    it("makes an empty panel of one it cannot bring back", () => {
      const store = restored(
        document({
          p1: { kind: "ai", state: { noteId: 99, follow: false } }, // a note that is gone for good
          p2: { kind: "ai", state: { noteId: null, follow: false } }, // pinned to nothing
          p3: { kind: "ai", state: { noteId: 1 } }, // no saying whether it follows
          p4: { kind: "ai", state: { noteId: 1, follow: "yes" } },
          p5: { kind: "ai", state: { noteId: 1.5, follow: false } },
          p6: { kind: "ai", state: null },
          p7: { kind: "ai", state: [1, false] },
        }),
      );

      expect(panelIds(mainWindow(store).layout).map((id) => kindOf(store, id))).toEqual(Array(7).fill("empty"));
    });

    it("keeps an AI panel pinned to a note in the Trash Can, as a deleted note", () => {
      const trashed = note(7, { title: "Trashed" });
      const store = restored(document({ p1: { kind: "ai", state: { noteId: 7, follow: false } } }), [note(1)], [trashed, note(8)]);

      expect(aiState(store, "p1")).toEqual({ noteId: 7, follow: false });
      expect(store.getSnapshot().deleted).toEqual([trashed]);
    });

    it("brings back what it saved", () => {
      const save = vi.fn();
      const first = gridStore([note(1), note(2)], {}, { save });
      first.openNote(2);
      const [notePanel] = panelIds(mainWindow(first).layout);
      first.openAssistantFor(notePanel);
      const following = first.splitPanel(notePanel, "bottom")!;
      first.setPanelKind(following, "ai");
      const saved = JSON.parse(JSON.stringify(save.mock.lastCall![0]));

      const second = restored(saved);

      expect(mainWindow(second).layout).toEqual(mainWindow(first).layout);
      expect(second.getSnapshot().panels.byId).toEqual(first.getSnapshot().panels.byId);
    });
  });

  describe("about a note that is deleted", () => {
    /** An AI panel pinned to note 1, with the note panel that showed it moved on to note 2. */
    function pinnedWhileNoteMovesOn() {
      const store = gridStore([note(1), note(2)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const ai = store.openAssistantFor(notePanel)!;
      store.openNote(2, "main"); // the AI panel is focused: goes to the note panel used last
      return { store, notePanel, ai };
    }

    it("stays in its panel, with the text it had, even when no note panel shows the note", () => {
      const { store, ai } = pinnedWhileNoteMovesOn();
      expect(notesShown(store)).toEqual([2, "-"]);

      store.removeNote(1);

      expect(aiState(store, ai)).toEqual({ noteId: 1, follow: false });
      expect(store.getSnapshot().deleted).toEqual([expect.objectContaining({ id: 1, content: "body 1" })]);
    });

    it("is forgotten once the AI panel is closed", () => {
      const { store, ai } = pinnedWhileNoteMovesOn();
      store.removeNote(1);
      expect(store.getSnapshot().deleted.map((n) => n.id)).toEqual([1]);

      store.closePanel(ai);

      expect(store.getSnapshot().deleted).toEqual([]);
    });

    it("is kept when the database no longer has the note, and is back to life when it has it again", () => {
      const { store } = pinnedWhileNoteMovesOn();

      store.reconcile({ notes: [note(2)], groups: [] });
      expect(store.getSnapshot().deleted).toEqual([expect.objectContaining({ id: 1 })]);

      store.reconcile({ notes: [note(1), note(2)], groups: [] });
      expect(store.getSnapshot().deleted).toEqual([]);
    });

    describe("its chats", () => {
      function withChats() {
        const assistant = createChatsStore({ streamChat: vi.fn() });
        const forget = vi.spyOn(assistant, "forgetNote");
        const deps = { deleteNote: vi.fn(async () => {}) } as unknown as WorkspaceDeps;
        const store = createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, deps, assistant, { panels: {} });
        store.openNote(1);
        const [notePanel] = panelIds(mainWindow(store).layout);
        const ai = store.openAssistantFor(notePanel)!;
        store.openNote(2, "main"); // the note panel moves on; only the AI panel is about note 1
        return { store, ai, forget };
      }

      it("are kept while the AI panel pinned to the note is open, to be read", () => {
        const { store, forget } = withChats();

        store.removeNote(1);

        expect(forget).not.toHaveBeenCalled();
        expect(store.getSnapshot().deleted.map((n) => n.id)).toEqual([1]);
      });

      it("are forgotten once the AI panel is closed", () => {
        const { store, ai, forget } = withChats();
        store.removeNote(1);

        store.closePanel(ai);

        expect(forget).toHaveBeenCalledWith(1);
      });

      it("are not forgotten when the note comes back before the AI panel is closed", () => {
        const { store, ai, forget } = withChats();
        store.removeNote(1);
        store.reconcile({ notes: [note(1), note(2)], groups: [] });

        store.closePanel(ai);

        expect(forget).not.toHaveBeenCalled();
      });

      it("are forgotten at once when no AI panel is about the note", () => {
        const { store, forget } = withChats();

        store.removeNote(2); // shown by the note panel only, which keeps the note but has no chat to show

        expect(forget).toHaveBeenCalledWith(2);
      });
    });

    it("is not kept for an AI panel that follows, which shows whatever note the user has open", () => {
      const store = gridStore([note(1)]);
      store.openNote(1);
      const [notePanel] = panelIds(mainWindow(store).layout);
      const following = store.splitPanel(notePanel, "right")!;
      store.setPanelKind(following, "ai");
      store.setPanelState(following, { noteId: 1, follow: true }); // left over from when it was pinned
      store.closePanel(notePanel);

      store.removeNote(1);

      expect(store.getSnapshot().deleted).toEqual([]);
    });
  });
});
