import { KINDS, type RestoreContext } from "./kinds";
import { panelIds, restoreLayout, type LayoutNode, type PanelId } from "./layoutTree";
import { MAIN_WINDOW, type KindId, type PanelRecord, type PanelsState, type WindowId } from "./panelsState";

/** The version of the saved layout. A document with another version is not read, so the app can change it freely. */
export const PANELS_VERSION = 1;

/** What is saved of the panels: each window's arrangement, and for each panel its kind and the kind's own state. */
export type PanelsDocument = {
  version: typeof PANELS_VERSION;
  windows: Record<WindowId, { layout: LayoutNode; panels: Record<PanelId, { kind: KindId; state: unknown }> }>;
};

/** The part of the panels worth saving. Which panel was focused last is not. */
export function toDocument(panels: PanelsState): PanelsDocument {
  const windows: PanelsDocument["windows"] = {};
  for (const [windowId, { layout, focusOrder }] of Object.entries(panels.windows)) {
    windows[windowId] = {
      layout,
      panels: Object.fromEntries(focusOrder.map((id) => [id, { kind: panels.byId[id].kind, state: panels.byId[id].state }])),
    };
  }
  return { version: PANELS_VERSION, windows };
}

/** The ids the store makes (`p1`, `p2`, ...). Nothing else is read back, so an id is never something like `__proto__`. */
const PANEL_ID = /^p\d+$/;
/** Likewise for pop-out windows (`w1`, `w2`, ...); the main window is `main`. */
const POPOUT_ID = /^w\d+$/;

/** The highest number in the panel ids, for the store to carry on counting from. */
export function highestPanelNumber(panels: PanelsState): number {
  return Math.max(0, ...Object.keys(panels.byId).map((id) => Number(id.slice(1))));
}

/** The highest number in the pop-out window ids, likewise. */
export function highestWindowNumber(panels: PanelsState): number {
  return Math.max(0, ...Object.keys(panels.windows).filter((id) => id !== MAIN_WINDOW).map((id) => Number(id.slice(1))));
}

/**
 * Reads the panels back from what was saved (any JSON value), or null when that is not a document of this version,
 * or its main window cannot be read, so the caller starts again with one empty panel. A panel that cannot be brought
 * back is an empty panel in its place; the rest of the arrangement stays. A pop-out that cannot be read is dropped
 * without the others noticing.
 */
export function fromDocument(saved: unknown, context: RestoreContext): PanelsState | null {
  if (typeof saved !== "object" || saved === null) return null;
  const { version, windows: savedWindows } = saved as { version?: unknown; windows?: unknown };
  if (version !== PANELS_VERSION || typeof savedWindows !== "object" || savedWindows === null) return null;

  const state: PanelsState = { windows: {}, byId: {} };
  // The main window first, then the pop-outs in the order they were saved.
  const ids = [MAIN_WINDOW, ...Object.keys(savedWindows).filter((id) => id !== MAIN_WINDOW && POPOUT_ID.test(id))];
  for (const windowId of ids) {
    const read = readWindow((savedWindows as Record<string, unknown>)[windowId], state.byId, context);
    if (read) {
      state.windows[windowId] = { layout: read.layout, focusOrder: panelIds(read.layout) };
      Object.assign(state.byId, read.byId);
    } else if (windowId === MAIN_WINDOW) {
      return null;
    }
  }
  return state;
}

/** One window's arrangement and panels, or null if it cannot be read or reuses a panel id already `taken`. */
function readWindow(
  saved: unknown,
  taken: Record<PanelId, PanelRecord>,
  context: RestoreContext,
): { layout: LayoutNode; byId: Record<PanelId, PanelRecord> } | null {
  if (typeof saved !== "object" || saved === null) return null;
  const { layout: savedLayout, panels: records } = saved as { layout?: unknown; panels?: unknown };

  const layout = restoreLayout(savedLayout);
  if (!layout) return null;
  const ids = panelIds(layout);
  if (!ids.every((id) => PANEL_ID.test(id) && !Object.hasOwn(taken, id))) return null;

  const byId: Record<PanelId, PanelRecord> = {};
  for (const id of ids) {
    const record = typeof records === "object" && records !== null ? (records as Record<string, unknown>)[id] : undefined;
    const { kind, state } = (typeof record === "object" && record !== null ? record : {}) as { kind?: unknown; state?: unknown };
    const restored = typeof kind === "string" && Object.hasOwn(KINDS, kind) ? KINDS[kind as KindId].restore(state, context) : null;
    byId[id] = restored === null ? { id, kind: "empty", state: null } : { id, kind: kind as KindId, state: restored };
  }
  return { layout, byId };
}
