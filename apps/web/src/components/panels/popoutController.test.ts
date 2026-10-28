import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../notes/types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "../notes/workspaceStore";
import { panelIds } from "./layoutTree";
import { createPopoutController } from "./popoutController";

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function gridStore(saved?: unknown): WorkspaceStore {
  return createWorkspaceStore({ notes: [note(1), note(2)], groups: [] }, {} as WorkspaceDeps, undefined, { panels: { saved } });
}

/** Stands in for `window.open`: hands out a handle per window, which a test can close as the user would. */
function fakeOpen(refuse: string[] = []) {
  const handles = new Map<string, { closed: boolean; close: ReturnType<typeof vi.fn> }>();
  const open = vi.fn((windowId: string) => {
    if (refuse.includes(windowId)) return null;
    const handle = {
      closed: false,
      close: vi.fn(function (this: { closed: boolean }) {
        this.closed = true;
      }),
    };
    handles.set(windowId, handle);
    return handle;
  });
  return { open, handles };
}

const windowIds = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);
const main = (store: WorkspaceStore) => store.getSnapshot().panels.windows.main;

/** The main window with two panels, a and b. */
function twoPanels(store: WorkspaceStore) {
  const [a] = panelIds(main(store).layout);
  const b = store.splitPanel(a, "right")!;
  return { a, b };
}

describe("the pop-out controller", () => {
  it("opens a real window for every pop-out the workspace already has, as when the app starts", () => {
    const empty = { kind: "empty", state: null };
    const leaf = (id: string) => ({ type: "panel", id });
    const store = gridStore({
      version: 1,
      windows: {
        main: { layout: leaf("p1"), panels: { p1: empty } },
        w1: { layout: leaf("p2"), panels: { p2: empty } },
        w2: { layout: leaf("p3"), panels: { p3: empty } },
      },
    });
    const { open } = fakeOpen();

    createPopoutController(store, open);

    expect(windowIds(store)).toEqual(["main", "w1", "w2"]);
    expect(open.mock.calls).toEqual([["w1"], ["w2"]]);
  });

  it("opens one real window when a panel is moved into a new window, and no more however the workspace changes", () => {
    const store = gridStore();
    const { open } = fakeOpen();
    createPopoutController(store, open);
    const { a, b } = twoPanels(store);

    const popout = store.movePanelToNewWindow(b)!;
    store.splitPanel(a, "bottom");
    store.focusPanel(a);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(popout);
  });

  it("closes the real window when its window leaves the workspace, whether its panels were closed or moved back", () => {
    const store = gridStore();
    const { open, handles } = fakeOpen();
    createPopoutController(store, open);
    const { b } = twoPanels(store);
    const first = store.movePanelToNewWindow(b)!;
    const c = store.splitPanel(panelIds(main(store).layout)[0], "right")!;
    const second = store.movePanelToNewWindow(c)!;

    store.closePanel(b);
    store.movePanelToWindow(c, "main");

    expect(handles.get(first)!.close).toHaveBeenCalledTimes(1);
    expect(handles.get(second)!.close).toHaveBeenCalledTimes(1);
  });

  it("leaves a real window alone that the user has already closed", () => {
    const store = gridStore();
    const { open, handles } = fakeOpen();
    createPopoutController(store, open);
    const { b } = twoPanels(store);
    const popout = store.movePanelToNewWindow(b)!;
    handles.get(popout)!.closed = true;

    store.closeWindow(popout);

    expect(handles.get(popout)!.close).not.toHaveBeenCalled();
  });

  it("brings a pop-out's panels back to the main window when its real window cannot be opened, rather than losing them", () => {
    const store = gridStore();
    const { open } = fakeOpen(["w1"]);
    createPopoutController(store, open);
    const { b } = twoPanels(store);

    store.movePanelToNewWindow(b);

    expect(windowIds(store)).toEqual(["main"]);
    expect(panelIds(main(store).layout)).toContain(b);
  });

  it("does not take a real window that has gone for one the user closed: the app destroys them as it quits, and they must come back", () => {
    const store = gridStore();
    const { open, handles } = fakeOpen();
    createPopoutController(store, open);
    const { b } = twoPanels(store);
    const popout = store.movePanelToNewWindow(b)!;

    handles.get(popout)!.closed = true; // destroyed by the app; its page never got to say anything
    vi.advanceTimersByTime(60_000);

    expect(windowIds(store)).toEqual(["main", popout]);
  });

  it("stops watching the workspace when told to", () => {
    const store = gridStore();
    const { open, handles } = fakeOpen();
    const controller = createPopoutController(store, open);
    const { b } = twoPanels(store);
    controller.stop();

    const popout = store.movePanelToNewWindow(b)!;
    vi.advanceTimersByTime(5000);

    expect(open).not.toHaveBeenCalled();
    expect(handles.has(popout)).toBe(false);
  });
});
