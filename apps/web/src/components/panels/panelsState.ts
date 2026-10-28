import { BESIDE_VIEW, KINDS, noteIdOf, type AssistantPanelState, type NotePanelState } from "./kinds";
import {
  closePanel as closeLayout,
  movePanel as moveLayout,
  panelIds,
  splitPanel as splitLayout,
  withSizes,
  type DropZone,
  type Edge,
  type LayoutNode,
  type PanelId,
  type SplitPath,
} from "./layoutTree";

/** What a panel can show. A kind is added here and in `kinds.ts`, which says how its state is made and read back. */
export type KindId = "empty" | "note" | "notes-browser" | "ai";

export type WindowId = string;
export const MAIN_WINDOW: WindowId = "main";

/** One panel: what it shows, and that kind's own state (saved as it is, and handed back to the kind to read). */
export type PanelRecord = { id: PanelId; kind: KindId; state: unknown };

export type WindowPanels = {
  layout: LayoutNode;
  /** Every panel of the window, the one the user last used first; the first is the focused panel. */
  focusOrder: PanelId[];
};

/** Every window's arrangement, and the panels in them. Only the main window exists until pop-outs are built. */
export type PanelsState = {
  windows: Record<WindowId, WindowPanels>;
  byId: Record<PanelId, PanelRecord>;
};

/** A window with one empty panel, which is where a window starts and what closing its last panel leaves. */
export function initialPanels(newId: () => PanelId): PanelsState {
  const id = newId();
  return {
    windows: { [MAIN_WINDOW]: { layout: { type: "panel", id }, focusOrder: [id] } },
    byId: { [id]: { id, kind: "empty", state: null } },
  };
}

/** The panel the user is working in. */
export function focusedPanelId(window: WindowPanels): PanelId {
  return window.focusOrder[0];
}

/** The window a panel is in. */
export function windowOf(panels: PanelsState, panelId: PanelId): WindowId | undefined {
  return Object.keys(panels.windows).find((id) => panelIds(panels.windows[id].layout).includes(panelId));
}

/** Puts a new panel beside `panelId` and focuses it. Unchanged if there is no such panel. */
export function splitPanel(panels: PanelsState, panelId: PanelId, edge: Edge, added: PanelRecord): PanelsState {
  const windowId = windowOf(panels, panelId);
  if (windowId === undefined) return panels;

  const window = panels.windows[windowId];
  return {
    windows: {
      ...panels.windows,
      [windowId]: { layout: splitLayout(window.layout, panelId, edge, added.id), focusOrder: [added.id, ...window.focusOrder] },
    },
    byId: { ...panels.byId, [added.id]: added },
  };
}

/** Makes a panel the focused one in its window. Unchanged if it is not in one, or already focused. */
export function focusPanel(panels: PanelsState, panelId: PanelId): PanelsState {
  const windowId = windowOf(panels, panelId);
  if (windowId === undefined || panels.windows[windowId].focusOrder[0] === panelId) return panels;

  const window = panels.windows[windowId];
  const focusOrder = [panelId, ...window.focusOrder.filter((id) => id !== panelId)];
  return { ...panels, windows: { ...panels.windows, [windowId]: { ...window, focusOrder } } };
}

/**
 * Focuses the panel after the focused one (`delta` 1) or before it (-1) in the order the window's panels are laid out,
 * left to right and top to bottom, wrapping round at either end. Unchanged for a window with one panel or none.
 */
export function focusNeighbour(panels: PanelsState, windowId: WindowId, delta: 1 | -1): PanelsState {
  const window = panels.windows[windowId];
  if (!window) return panels;

  const ids = panelIds(window.layout);
  if (ids.length < 2) return panels;
  const at = ids.indexOf(focusedPanelId(window));
  return focusPanel(panels, ids[(at + delta + ids.length) % ids.length]);
}

/**
 * Closes a panel and focuses the one used before it. The main window always has a panel, so closing its last one leaves
 * a new empty panel, `replacement` (and closing an only panel that is already empty changes nothing); closing the last
 * panel of a pop-out closes the pop-out.
 */
export function closePanel(panels: PanelsState, panelId: PanelId, replacement: PanelRecord): PanelsState {
  const windowId = windowOf(panels, panelId);
  if (windowId === undefined) return panels;

  const window = panels.windows[windowId];
  const layout = closeLayout(window.layout, panelId);
  const byId = { ...panels.byId };
  delete byId[panelId];
  if (layout === null) {
    if (windowId !== MAIN_WINDOW) {
      // A pop-out with nothing in it has no reason to stay open.
      const windows = { ...panels.windows };
      delete windows[windowId];
      return { windows, byId };
    }
    if (panels.byId[panelId].kind === "empty") return panels;
    return {
      windows: { ...panels.windows, [windowId]: { layout: { type: "panel", id: replacement.id }, focusOrder: [replacement.id] } },
      byId: { ...byId, [replacement.id]: replacement },
    };
  }
  const focusOrder = window.focusOrder.filter((id) => id !== panelId);
  return { windows: { ...panels.windows, [windowId]: { layout, focusOrder } }, byId };
}

/** Turns a panel into another kind, with that kind's starting state. */
export function setPanelKind(panels: PanelsState, panelId: PanelId, kind: KindId): PanelsState {
  const panel = panels.byId[panelId];
  if (!panel || panel.kind === kind) return panels;
  return { ...panels, byId: { ...panels.byId, [panelId]: { id: panelId, kind, state: KINDS[kind].initialState() } } };
}

/** Replaces the state a panel saves; the kind decides what it means. */
export function setPanelState(panels: PanelsState, panelId: PanelId, state: unknown): PanelsState {
  const panel = panels.byId[panelId];
  if (!panel) return panels;
  return { ...panels, byId: { ...panels.byId, [panelId]: { ...panel, state } } };
}

/** Shows the note in a note panel (keeping its tab) or an empty one (which becomes a note panel), and focuses it. */
function showNote(panels: PanelsState, panelId: PanelId, noteId: number): PanelsState {
  const panel = panels.byId[panelId];
  const state: NotePanelState = panel.kind === "note" ? { ...(panel.state as NotePanelState), noteId } : { noteId, view: "split" };
  return focusPanel({ ...panels, byId: { ...panels.byId, [panelId]: { id: panelId, kind: "note", state } } }, panelId);
}

/**
 * Shows a note the way picking it in the sidebar does: focus the panel that already shows it, otherwise put it in
 * the focused panel if that is a note or empty one, or else in the note panel used last, or else in a new note
 * panel to the right of the focused one.
 */
export function openNote(panels: PanelsState, windowId: WindowId, noteId: number, newId: () => PanelId): PanelsState {
  const window = panels.windows[windowId];
  if (!window) return panels;

  const showing = window.focusOrder.find((id) => noteIdOf(panels.byId[id]) === noteId);
  if (showing !== undefined) return focusPanel(panels, showing);

  const focused = panels.byId[focusedPanelId(window)];
  const target =
    focused.kind === "empty" || focused.kind === "note"
      ? focused.id
      : window.focusOrder.find((id) => panels.byId[id].kind === "note");
  if (target !== undefined) return showNote(panels, target, noteId);

  const state: NotePanelState = { noteId, view: BESIDE_VIEW };
  return splitPanel(panels, focused.id, "right", { id: newId(), kind: "note", state });
}

/** A new note panel beside `panelId` showing the note, on the editor tab, focused. */
function noteBeside(panels: PanelsState, panelId: PanelId, edge: Edge, noteId: number, newId: () => PanelId): PanelsState {
  const state: NotePanelState = { noteId, view: BESIDE_VIEW };
  return splitPanel(panels, panelId, edge, { id: newId(), kind: "note", state });
}

/**
 * The sidebar's "Open to the side": a new note panel to the right of the focused one, even if the note is open in
 * another, since it was asked for. Like picking a note when nothing is open, it takes a lone empty panel.
 */
export function openNoteBeside(panels: PanelsState, windowId: WindowId, noteId: number, newId: () => PanelId): PanelsState {
  const window = panels.windows[windowId];
  if (!window) return panels;

  const focused = panels.byId[focusedPanelId(window)];
  if (focused.kind === "empty" && window.focusOrder.length === 1) return showNote(panels, focused.id, noteId);
  return noteBeside(panels, focused.id, "right", noteId, newId);
}

/**
 * A note dropped on a panel: on its middle it fills an empty panel or replaces a note panel's note (a panel of
 * another kind can't show it, so nothing happens), and on a side it makes a new note panel there.
 */
export function dropNote(panels: PanelsState, noteId: number, panelId: PanelId, zone: DropZone, newId: () => PanelId): PanelsState {
  const panel = panels.byId[panelId];
  if (!panel) return panels;
  if (zone !== "center") return noteBeside(panels, panelId, zone, noteId, newId);
  return panel.kind === "empty" || panel.kind === "note" ? showNote(panels, panelId, noteId) : panels;
}

/**
 * A note made from another one (an AI answer), opened to the right of the panel showing that other note, or, if
 * none does, the way "Open to the side" would.
 */
export function openNoteBesideNote(panels: PanelsState, fromNoteId: number, noteId: number, newId: () => PanelId): PanelsState {
  const source = Object.values(panels.byId).find((panel) => noteIdOf(panel) === fromNoteId);
  if (source) return noteBeside(panels, source.id, "right", noteId, newId);
  return openNoteBeside(panels, MAIN_WINDOW, noteId, newId);
}

/**
 * A link followed in the preview of the note in `fromPanelId`: the panel already showing the linked note is
 * focused (a link never makes a second panel for it); otherwise the note opens to the right of the panel, or, when
 * not asked to open beside, replaces the note in it.
 */
export function openLinkedNote(panels: PanelsState, fromPanelId: PanelId, noteId: number, beside: boolean, newId: () => PanelId): PanelsState {
  const windowId = windowOf(panels, fromPanelId);
  if (windowId === undefined) return panels;

  const showing = panels.windows[windowId].focusOrder.find((id) => noteIdOf(panels.byId[id]) === noteId);
  if (showing !== undefined) return focusPanel(panels, showing);
  return beside ? noteBeside(panels, fromPanelId, "right", noteId, newId) : showNote(panels, fromPanelId, noteId);
}

/**
 * The AI helper for the note in a note panel: the AI panel of that window pinned to the note, focused, or else a new
 * one to the right of the note panel. Null for a panel that shows no note, which has nothing to ask about. Also says
 * which panel it is.
 */
export function openAssistantFor(
  panels: PanelsState,
  panelId: PanelId,
  newId: () => PanelId,
): { panels: PanelsState; assistantId: PanelId } | null {
  const windowId = windowOf(panels, panelId);
  const noteId = windowId === undefined ? null : noteIdOf(panels.byId[panelId]);
  if (windowId === undefined || noteId === null) return null;

  const pinned = panels.windows[windowId].focusOrder.find((id) => {
    const panel = panels.byId[id];
    const state = panel.state as AssistantPanelState;
    return panel.kind === "ai" && !state.follow && state.noteId === noteId;
  });
  if (pinned !== undefined) return { panels: focusPanel(panels, pinned), assistantId: pinned };

  const state: AssistantPanelState = { noteId, follow: false };
  const assistantId = newId();
  return { panels: splitPanel(panels, panelId, "right", { id: assistantId, kind: "ai", state }), assistantId };
}

/** The note in the note panel the user used last in the window, skipping note panels that show none yet. */
function lastNoteIn(panels: PanelsState, windowId: WindowId): number | null {
  for (const id of panels.windows[windowId]?.focusOrder ?? []) {
    const noteId = noteIdOf(panels.byId[id]);
    if (noteId !== null) return noteId;
  }
  return null;
}

/**
 * The note an AI panel is about: its own when it is pinned; when it follows, the note the user last worked in, looking
 * in the AI panel's window first and then in the main window. Null for a panel that is not an AI panel, or when no
 * note panel shows a note.
 */
export function assistantSubject(panels: PanelsState, panelId: PanelId): number | null {
  const panel = panels.byId[panelId];
  const windowId = windowOf(panels, panelId);
  if (!panel || panel.kind !== "ai" || windowId === undefined) return null;

  const state = panel.state as AssistantPanelState;
  if (!state.follow) return state.noteId;
  return lastNoteIn(panels, windowId) ?? (windowId === MAIN_WINDOW ? null : lastNoteIn(panels, MAIN_WINDOW));
}

/**
 * Turns following on or off for an AI panel. Off pins it to the note it is about now; with none to pin to, it keeps
 * following. On forgets that note. Unchanged for a panel that is not an AI panel.
 */
export function setAssistantFollow(panels: PanelsState, panelId: PanelId, follow: boolean): PanelsState {
  const panel = panels.byId[panelId];
  if (!panel || panel.kind !== "ai" || (panel.state as AssistantPanelState).follow === follow) return panels;

  const noteId = follow ? null : assistantSubject(panels, panelId);
  if (!follow && noteId === null) return panels;
  return setPanelState(panels, panelId, { noteId, follow } satisfies AssistantPanelState);
}

/** Moves a panel to where it was dropped on another in the same window (see `movePanel` in `layoutTree.ts`), and focuses it. */
export function movePanel(panels: PanelsState, panelId: PanelId, targetId: PanelId, zone: DropZone): PanelsState {
  const windowId = windowOf(panels, panelId);
  if (windowId === undefined || windowId !== windowOf(panels, targetId)) return panels;

  const window = panels.windows[windowId];
  const layout = moveLayout(window.layout, panelId, targetId, zone);
  if (layout === window.layout) return panels;
  return focusPanel({ ...panels, windows: { ...panels.windows, [windowId]: { ...window, layout } } }, panelId);
}

/** Applies the sizes of a divider drag to the split at `path` in a window's layout. */
export function resizePanels(panels: PanelsState, windowId: WindowId, path: SplitPath, sizes: number[]): PanelsState {
  const window = panels.windows[windowId];
  if (!window) return panels;
  const layout = withSizes(window.layout, path, sizes);
  return layout === window.layout ? panels : { ...panels, windows: { ...panels.windows, [windowId]: { ...window, layout } } };
}

/** Whether a panel shows the note, apart from `exceptPanelId`. */
export function isNoteShown(panels: PanelsState, noteId: number, exceptPanelId?: PanelId): boolean {
  return Object.values(panels.byId).some((panel) => panel.id !== exceptPanelId && noteIdOf(panel) === noteId);
}

/**
 * Takes a panel out of the arrangement of its window, leaving its record where it is for the caller to put somewhere.
 * A window that is left with no panel is gone, if it is a pop-out, or gets `replacement` if it is the main window.
 */
function detachPanel(panels: PanelsState, panelId: PanelId, windowId: WindowId, replacement: PanelRecord): PanelsState {
  const window = panels.windows[windowId];
  const layout = closeLayout(window.layout, panelId);
  if (layout !== null) {
    const focusOrder = window.focusOrder.filter((id) => id !== panelId);
    return { ...panels, windows: { ...panels.windows, [windowId]: { layout, focusOrder } } };
  }
  if (windowId === MAIN_WINDOW) {
    return {
      windows: { ...panels.windows, [MAIN_WINDOW]: { layout: { type: "panel", id: replacement.id }, focusOrder: [replacement.id] } },
      byId: { ...panels.byId, [replacement.id]: replacement },
    };
  }
  const windows = { ...panels.windows };
  delete windows[windowId];
  return { ...panels, windows };
}

/**
 * Moves a panel into a new window of its own, `newWindowId`. Unchanged when there is no such panel, or it is the only
 * panel of a pop-out (it would only trade one window for another).
 */
export function movePanelToNewWindow(panels: PanelsState, panelId: PanelId, newWindowId: WindowId, replacement: PanelRecord): PanelsState {
  const from = windowOf(panels, panelId);
  if (from === undefined) return panels;
  if (from !== MAIN_WINDOW && panelIds(panels.windows[from].layout).length === 1) return panels;

  const detached = detachPanel(panels, panelId, from, replacement);
  return {
    ...detached,
    windows: { ...detached.windows, [newWindowId]: { layout: { type: "panel", id: panelId }, focusOrder: [panelId] } },
  };
}

/**
 * Moves a panel into another window, to the right of the panel used last there, and focuses it. Unchanged when either
 * is not there, or the panel is in that window already.
 */
export function movePanelToWindow(panels: PanelsState, panelId: PanelId, windowId: WindowId, replacement: PanelRecord): PanelsState {
  const from = windowOf(panels, panelId);
  const target = panels.windows[windowId];
  if (from === undefined || !target || from === windowId) return panels;

  const detached = detachPanel(panels, panelId, from, replacement);
  const arrival = detached.windows[windowId];
  return {
    ...detached,
    windows: {
      ...detached.windows,
      [windowId]: {
        layout: splitLayout(arrival.layout, focusedPanelId(arrival), "right", panelId),
        focusOrder: [panelId, ...arrival.focusOrder],
      },
    },
  };
}

/** Forgets a pop-out window and every panel in it (it was closed). The main window is never closed this way. */
export function closeWindow(panels: PanelsState, windowId: WindowId): PanelsState {
  const window = panels.windows[windowId];
  if (windowId === MAIN_WINDOW || !window) return panels;

  const windows = { ...panels.windows };
  delete windows[windowId];
  const byId = { ...panels.byId };
  for (const id of panelIds(window.layout)) delete byId[id];
  return { windows, byId };
}
