/**
 * Which notes are open side by side. Each pane shows one note and a note is open
 * in at most one pane, so the note id doubles as the pane's identity. Panes sit
 * in a single row, like the columns of a split editor.
 *
 * Only the arrangement lives here and, like which note is open, it is not saved:
 * a reload starts again with one pane.
 */

/** What a pane shows of its note: the editor, the preview, or both beside each other. */
export type PaneView = "split" | "markdown" | "preview";

export type Pane = {
  noteId: number;
  /** Relative width: the panes share the row in proportion to their sizes. */
  size: number;
  /** What the user picked; see `shownView` for what a too-narrow pane shows instead. */
  view: PaneView;
};

export type PaneState = {
  panes: Pane[];
  /** The pane that sidebar picks and new notes open into; null only when no pane is open. */
  focusedId: number | null;
};

/** Where on a pane a dragged note was dropped: beside it, or onto it. */
export type DropZone = "left" | "right" | "center";

export const MIN_PANE_WIDTH = 240;

/** The least width that leaves room for the editor and preview to sit beside each other. */
export const SIDE_BY_SIDE_MIN_WIDTH = 480;

/** The share of a pane's width, from each side, that counts as dropping beside it. */
const EDGE_FRACTION = 0.3;

export function initialPanes(noteId: number | null): PaneState {
  return noteId === null
    ? { panes: [], focusedId: null }
    : { panes: [{ noteId, size: 1, view: "split" }], focusedId: noteId };
}

export function setPaneView(state: PaneState, noteId: number, view: PaneView): PaneState {
  if (!state.panes.some((p) => p.noteId === noteId && p.view !== view)) return state;
  return { ...state, panes: state.panes.map((p) => (p.noteId === noteId ? { ...p, view } : p)) };
}

/**
 * The view a pane actually shows. Side by side needs room, so a pane that is too
 * narrow for it shows the editor tab until it is widened again, rather than
 * stacking the preview under the editor.
 */
export function shownView(view: PaneView, wideEnough: boolean): PaneView {
  return view === "split" && !wideEnough ? "markdown" : view;
}

export function focusPane(state: PaneState, noteId: number): PaneState {
  if (state.focusedId === noteId || !state.panes.some((p) => p.noteId === noteId)) return state;
  return { ...state, focusedId: noteId };
}

/**
 * Shows a note the way picking it in the sidebar does: focus the pane it is
 * already in, otherwise put it in the focused pane (or a first pane). A pane
 * keeps its size and view when its note changes.
 */
export function openNote(state: PaneState, noteId: number): PaneState {
  if (state.panes.some((p) => p.noteId === noteId)) return focusPane(state, noteId);
  if (state.panes.length === 0) return initialPanes(noteId);

  const at = Math.max(0, state.panes.findIndex((p) => p.noteId === state.focusedId));
  return {
    panes: state.panes.map((p, i) => (i === at ? { ...p, noteId } : p)),
    focusedId: noteId,
  };
}

/** Closes a pane; its width goes to the pane after it (or before it, for the last). */
export function closePane(state: PaneState, noteId: number): PaneState {
  const at = state.panes.findIndex((p) => p.noteId === noteId);
  if (at === -1) return state;

  const closed = state.panes[at];
  const panes = state.panes.filter((_, i) => i !== at);
  const neighbour = at < panes.length ? at : at - 1;
  if (neighbour >= 0) panes[neighbour] = { ...panes[neighbour], size: panes[neighbour].size + closed.size };

  return {
    panes,
    focusedId: state.focusedId === noteId ? (panes[neighbour]?.noteId ?? null) : state.focusedId,
  };
}

/**
 * Drops a note on the pane showing `targetId`. Beside it, the note gets a new
 * pane that takes half the target's width. Onto it, the note replaces the
 * target's (keeping that pane's view). A note that was already open elsewhere
 * moves instead of duplicating, view and all: its pane is reordered beside the
 * target (every pane keeps its width), or, when dropped onto another pane,
 * trades places with it.
 */
export function dropNote(state: PaneState, noteId: number, targetId: number, zone: DropZone): PaneState {
  if (noteId === targetId) return focusPane(state, noteId);
  if (!state.panes.some((p) => p.noteId === targetId)) return state;

  const moving = state.panes.find((p) => p.noteId === noteId);

  if (zone === "center") {
    const target = state.panes.find((p) => p.noteId === targetId)!;
    return {
      panes: state.panes.map((p) => {
        // Sizes belong to the positions; the notes, and how each is viewed, trade.
        if (p === target) return { ...p, noteId, view: moving?.view ?? p.view };
        if (p === moving) return { ...p, noteId: targetId, view: target.view };
        return p;
      }),
      focusedId: noteId,
    };
  }

  const others = state.panes.filter((p) => p !== moving);
  const at = others.findIndex((p) => p.noteId === targetId);
  const beside = zone === "left" ? at : at + 1;

  if (moving) {
    others.splice(beside, 0, moving);
    return { panes: others, focusedId: noteId };
  }

  const half = others[at].size / 2;
  const panes = others.map((p, i) => (i === at ? { ...p, size: half } : p));
  panes.splice(beside, 0, { noteId, size: half, view: "split" });
  return { panes, focusedId: noteId };
}

/** Applies sizes from a divider drag; ignored if the panes changed since the drag began. */
export function withSizes(state: PaneState, sizes: number[]): PaneState {
  if (sizes.length !== state.panes.length) return state;
  return { ...state, panes: state.panes.map((p, i) => ({ ...p, size: sizes[i] })) };
}

/**
 * The sizes after dragging the divider between panes `index` and `index + 1` by
 * `dxPx`, measured from where `sizes` were when the drag began. Only those two
 * panes trade width, and neither shrinks below `minPx`. Unchanged when the row
 * has no measurable width.
 */
export function dragPaneSizes(
  sizes: number[],
  index: number,
  dxPx: number,
  rowWidthPx: number,
  minPx = MIN_PANE_WIDTH,
): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(rowWidthPx > 0) || !(total > 0) || index < 0 || index >= sizes.length - 1) return sizes;

  const pxPerUnit = rowWidthPx / total;
  const pair = sizes[index] + sizes[index + 1];
  // Two panes that can't both fit their minimum just split the pair evenly.
  const min = Math.min(minPx / pxPerUnit, pair / 2);
  const left = Math.min(pair - min, Math.max(min, sizes[index] + dxPx / pxPerUnit));
  return sizes.map((size, i) => (i === index ? left : i === index + 1 ? pair - left : size));
}

/** Which part of a pane (its horizontal extent) the pointer is over. */
export function dropZoneAt(x: number, rect: { left: number; width: number }): DropZone {
  if (!(rect.width > 0)) return "center";
  const share = (x - rect.left) / rect.width;
  if (share < EDGE_FRACTION) return "left";
  if (share > 1 - EDGE_FRACTION) return "right";
  return "center";
}
