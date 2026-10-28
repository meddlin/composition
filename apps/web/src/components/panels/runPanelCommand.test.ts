import { describe, expect, it, vi } from "vitest";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "../notes/workspaceStore";
import type { Note } from "../notes/types";
import { panelIds } from "./layoutTree";
import { MAIN_WINDOW, focusedPanelId } from "./panelsState";
import { runPanelCommand } from "./runPanelCommand";
import type { PanelCommandId } from "./panelCommands";

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

/** A workspace with panels, two notes, and nothing else faked. */
function setup() {
  const deps = { saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...note(id), content })) } as unknown as WorkspaceDeps;
  return createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, deps, undefined, { panels: {} });
}

const windowOf = (store: WorkspaceStore, windowId: string) => store.getSnapshot().panels.windows[windowId];
const panelsIn = (store: WorkspaceStore, windowId: string) => panelIds(windowOf(store, windowId).layout);
const focusedIn = (store: WorkspaceStore, windowId: string) => focusedPanelId(windowOf(store, windowId));
const kindOf = (store: WorkspaceStore, panelId: string) => store.getSnapshot().panels.byId[panelId].kind;
const windowIds = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);

const ALL: PanelCommandId[] = ["split-right", "split-down", "close-panel", "next-panel", "previous-panel", "move-to-new-window", "move-to-main-window"];

describe("running a panel command", () => {
  describe("split right and split down", () => {
    it("put a new empty panel beside the focused one, on the side asked for, and focus it", () => {
      const store = setup();
      const [first] = panelsIn(store, MAIN_WINDOW);

      runPanelCommand(store, MAIN_WINDOW, "split-right");
      const [, right] = panelsIn(store, MAIN_WINDOW);
      expect(kindOf(store, right)).toBe("empty");
      expect(windowOf(store, MAIN_WINDOW).layout).toMatchObject({ direction: "row" });
      expect(focusedIn(store, MAIN_WINDOW)).toBe(right);

      store.focusPanel(first);
      runPanelCommand(store, MAIN_WINDOW, "split-down");
      expect(panelsIn(store, MAIN_WINDOW)).toHaveLength(3);
      expect(focusedIn(store, MAIN_WINDOW)).not.toBe(right);
      expect(kindOf(store, focusedIn(store, MAIN_WINDOW))).toBe("empty");
    });

    it("put it next to the focused panel, not at the end of the window", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      store.focusPanel(a);

      runPanelCommand(store, MAIN_WINDOW, "split-right");

      const order = panelsIn(store, MAIN_WINDOW);
      expect(order[0]).toBe(a);
      expect(order[2]).toBe(b);
      expect(order[1]).toBe(focusedIn(store, MAIN_WINDOW));
    });

    it("work in a pop-out, on its own panels", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const popout = store.movePanelToNewWindow(b)!;

      runPanelCommand(store, popout, "split-right");

      expect(panelsIn(store, popout)).toHaveLength(2);
      expect(panelsIn(store, MAIN_WINDOW)).toEqual([a]);
    });
  });

  describe("close panel", () => {
    it("closes the focused panel and focuses the one used before it", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const c = store.splitPanel(b, "right")!;
      store.focusPanel(a);
      store.focusPanel(c); // used c, then a, then b

      runPanelCommand(store, MAIN_WINDOW, "close-panel");

      expect(panelsIn(store, MAIN_WINDOW)).toEqual([a, b]);
      expect(focusedIn(store, MAIN_WINDOW)).toBe(a);
    });

    it("turns a main window's only note panel into an empty one, and leaves an only empty one", () => {
      const store = setup();
      store.openNote(1);
      const [only] = panelsIn(store, MAIN_WINDOW);

      runPanelCommand(store, MAIN_WINDOW, "close-panel");
      const [left] = panelsIn(store, MAIN_WINDOW);
      expect(left).not.toBe(only);
      expect(kindOf(store, left)).toBe("empty");

      const before = store.getSnapshot().panels;
      runPanelCommand(store, MAIN_WINDOW, "close-panel");
      expect(store.getSnapshot().panels).toBe(before);
    });

    it("closes a pop-out when its last panel is closed", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const popout = store.movePanelToNewWindow(b)!;

      runPanelCommand(store, popout, "close-panel");

      expect(windowIds(store)).toEqual([MAIN_WINDOW]);
    });
  });

  describe("next and previous panel", () => {
    it("move focus through the window's panels in layout order", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const c = store.splitPanel(b, "right")!;
      store.focusPanel(a);

      runPanelCommand(store, MAIN_WINDOW, "next-panel");
      expect(focusedIn(store, MAIN_WINDOW)).toBe(b);
      runPanelCommand(store, MAIN_WINDOW, "next-panel");
      expect(focusedIn(store, MAIN_WINDOW)).toBe(c);
      runPanelCommand(store, MAIN_WINDOW, "previous-panel");
      expect(focusedIn(store, MAIN_WINDOW)).toBe(b);
      runPanelCommand(store, MAIN_WINDOW, "previous-panel");
      runPanelCommand(store, MAIN_WINDOW, "previous-panel");
      expect(focusedIn(store, MAIN_WINDOW)).toBe(c); // wrapped round from the first
    });
  });

  describe("move to new window", () => {
    it("takes the focused panel into a window of its own", () => {
      const store = setup();
      store.openNote(2);
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;

      runPanelCommand(store, MAIN_WINDOW, "move-to-new-window");

      const [popout] = windowIds(store).filter((id) => id !== MAIN_WINDOW);
      expect(panelsIn(store, popout)).toEqual([b]);
      expect(panelsIn(store, MAIN_WINDOW)).toEqual([a]);
    });

    it("does nothing for the only panel of a pop-out, which would only trade one window for another", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const popout = store.movePanelToNewWindow(b)!;
      const before = store.getSnapshot().panels;

      runPanelCommand(store, popout, "move-to-new-window");

      expect(store.getSnapshot().panels).toBe(before);
    });
  });

  describe("move to main window", () => {
    it("brings the focused panel of a pop-out back, beside the panel used last in the main window", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const popout = store.movePanelToNewWindow(b)!;

      runPanelCommand(store, popout, "move-to-main-window");

      expect(panelsIn(store, MAIN_WINDOW)).toEqual([a, b]);
      expect(windowIds(store)).toEqual([MAIN_WINDOW]); // it was the pop-out's last panel
    });

    it("leaves the rest of a pop-out where it is", () => {
      const store = setup();
      const [a] = panelsIn(store, MAIN_WINDOW);
      const b = store.splitPanel(a, "right")!;
      const popout = store.movePanelToNewWindow(b)!;
      const c = store.splitPanel(b, "right")!; // the pop-out's focused panel

      runPanelCommand(store, popout, "move-to-main-window");

      expect(panelsIn(store, popout)).toEqual([b]);
      expect(panelsIn(store, MAIN_WINDOW)).toContain(c);
    });

    it("does nothing in the main window", () => {
      const store = setup();
      const before = store.getSnapshot().panels;

      runPanelCommand(store, MAIN_WINDOW, "move-to-main-window");

      expect(store.getSnapshot().panels).toBe(before);
    });
  });

  it("does nothing, whichever command, for a window that is not there", () => {
    const store = setup();
    const before = store.getSnapshot().panels;

    for (const id of ALL) runPanelCommand(store, "w99", id);

    expect(store.getSnapshot().panels).toBe(before);
  });
});
