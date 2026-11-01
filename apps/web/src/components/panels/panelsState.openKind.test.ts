import { describe, expect, it } from "vitest";
import { KINDS } from "./kinds";
import { panelIds } from "./layoutTree";
import { MAIN_WINDOW, closeWindow, focusPanel, focusedPanelId, initialPanels, movePanelToNewWindow, openKind, setPanelKind, splitPanel, type PanelsState } from "./panelsState";

function counter() {
  let n = 0;
  return () => `p${++n}`;
}

/** One empty panel, p1, which is focused. */
const start = () => {
  const newId = counter();
  return { panels: initialPanels(newId), newId };
};

const kindsOf = (panels: PanelsState, windowId = MAIN_WINDOW) => panelIds(panels.windows[windowId].layout).map((id) => panels.byId[id].kind);
const focused = (panels: PanelsState, windowId = MAIN_WINDOW) => focusedPanelId(panels.windows[windowId]);

describe("opening a kind of panel", () => {
  it("turns the focused panel into it when that is empty", () => {
    const { panels, newId } = start();

    const opened = openKind(panels, MAIN_WINDOW, "rss", newId)!;

    expect(opened.panelId).toBe("p1");
    expect(kindsOf(opened.panels)).toEqual(["rss"]);
    expect(opened.panels.byId.p1.state).toEqual(KINDS.rss.initialState());
    expect(focused(opened.panels)).toBe("p1");
  });

  it("puts it in a new panel to the right of the focused one, focused, when that is not empty", () => {
    const { panels, newId } = start();
    const withNote = setPanelKind(panels, "p1", "notes-browser");

    const opened = openKind(withNote, MAIN_WINDOW, "todo", newId)!;

    expect(kindsOf(opened.panels)).toEqual(["notes-browser", "todo"]);
    expect(focused(opened.panels)).toBe(opened.panelId);
    expect(opened.panels.byId[opened.panelId].state).toEqual(KINDS.todo.initialState());
  });

  it("splits beside the focused panel, wherever that is in the row", () => {
    const { panels, newId } = start();
    let state = setPanelKind(panels, "p1", "ai");
    state = splitPanel(state, "p1", "right", { id: "m2", kind: "notes-browser", state: KINDS["notes-browser"].initialState() });
    state = focusPanel(state, "p1");

    const opened = openKind(state, MAIN_WINDOW, "todo", newId)!;

    expect(kindsOf(opened.panels)).toEqual(["ai", "todo", "notes-browser"]);
  });

  it("goes to the panel of the kind the window already has, instead of making another", () => {
    const { panels, newId } = start();
    const first = openKind(setPanelKind(panels, "p1", "notes-browser"), MAIN_WINDOW, "rss", newId)!;
    const elsewhere = focusPanel(first.panels, "p1");

    const again = openKind(elsewhere, MAIN_WINDOW, "rss", newId)!;

    expect(again.panelId).toBe(first.panelId);
    expect(kindsOf(again.panels)).toEqual(["notes-browser", "rss"]);
    expect(focused(again.panels)).toBe(first.panelId);
  });

  it("goes to the one used last when there are two", () => {
    const { panels, newId } = start();
    let state = setPanelKind(panels, "p1", "todo");
    state = splitPanel(state, "p1", "right", { id: "m2", kind: "todo", state: KINDS.todo.initialState() });
    state = splitPanel(state, "m2", "right", { id: "m3", kind: "ai", state: KINDS.ai.initialState() });

    const opened = openKind(state, MAIN_WINDOW, "todo", newId)!;

    expect(opened.panelId).toBe("m2");
    expect(focused(opened.panels)).toBe("m2");
  });

  it("goes to an AI panel whichever way it follows the note", () => {
    const { panels, newId } = start();
    const pinned = setPanelKind(panels, "p1", "ai");
    const state = { ...pinned, byId: { ...pinned.byId, p1: { ...pinned.byId.p1, state: { noteId: 7, follow: false } } } };

    const opened = openKind(state, MAIN_WINDOW, "ai", newId)!;

    expect(opened.panelId).toBe("p1");
    expect(opened.panels).toBe(state);
  });

  it("changes nothing when the panel is already the focused one", () => {
    const { panels, newId } = start();
    const state = setPanelKind(panels, "p1", "rss");

    expect(openKind(state, MAIN_WINDOW, "rss", newId)!.panels).toBe(state);
  });

  it("makes a second notes browser every time, since that is what the kind is for", () => {
    const { panels, newId } = start();
    const one = openKind(panels, MAIN_WINDOW, "notes-browser", newId)!;

    const two = openKind(one.panels, MAIN_WINDOW, "notes-browser", newId)!;
    const three = openKind(two.panels, MAIN_WINDOW, "notes-browser", newId)!;

    expect(kindsOf(three.panels)).toEqual(["notes-browser", "notes-browser", "notes-browser"]);
    expect(new Set([one.panelId, two.panelId, three.panelId]).size).toBe(3);
  });

  it("looks only at its own window: a pop-out's panel of the kind does not count in the main window", () => {
    const { panels, newId } = start();
    let state = setPanelKind(panels, "p1", "notes-browser");
    state = splitPanel(state, "p1", "right", { id: "m2", kind: "rss", state: KINDS.rss.initialState() });
    state = movePanelToNewWindow(state, "m2", "w1", { id: "m3", kind: "empty", state: null });

    const inMain = openKind(state, MAIN_WINDOW, "rss", newId)!;
    const inPopout = openKind(state, "w1", "rss", newId)!;

    expect(inMain.panelId).not.toBe("m2");
    expect(kindsOf(inMain.panels)).toEqual(["notes-browser", "rss"]);
    expect(inPopout.panelId).toBe("m2");
    expect(inPopout.panels).toBe(state);
  });

  it("does nothing for a window that is gone", () => {
    const { panels, newId } = start();
    const state = closeWindow(movePanelToNewWindow(setPanelKind(panels, "p1", "ai"), "p1", "w1", { id: "m2", kind: "empty", state: null }), "w1");

    expect(openKind(state, "w1", "rss", newId)).toBeNull();
    expect(openKind(panels, "nope", "rss", newId)).toBeNull();
  });
});
