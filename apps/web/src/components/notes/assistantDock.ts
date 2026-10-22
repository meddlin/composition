/** The AI helper's dock beside a note: how wide it is, and when there is no room for it beside the note. */

export const DOCK_DEFAULT_WIDTH = 360;
export const DOCK_MIN_WIDTH = 280;
/** The least width the note keeps while the dock is beside it. */
export const NOTE_MIN_WIDTH_WITH_DOCK = 320;
const DOCK_MAX_SHARE = 0.6;

export type DockLayout = { mode: "beside"; width: number } | { mode: "over" };

/**
 * Where the dock goes in a pane `paneWidth` wide. Beside the note at `wanted` px, kept between the least it needs
 * and 60% of the pane, and never so wide that the note drops under 320 px. When the pane cannot hold both, the
 * dock covers the note (the way Split falls back to the editor in a narrow pane) and the toggle brings the note back.
 * An unmeasured pane (0) counts as wide, so nothing is hidden on a guess.
 */
export function dockLayout(paneWidth: number, wanted: number): DockLayout {
  if (paneWidth <= 0) return { mode: "beside", width: Math.max(DOCK_MIN_WIDTH, wanted) };
  if (paneWidth < NOTE_MIN_WIDTH_WITH_DOCK + DOCK_MIN_WIDTH) return { mode: "over" };
  const most = Math.min(paneWidth * DOCK_MAX_SHARE, paneWidth - NOTE_MIN_WIDTH_WITH_DOCK);
  return { mode: "beside", width: Math.round(Math.min(Math.max(wanted, DOCK_MIN_WIDTH), most)) };
}

/** The wanted width after the divider has moved `dxPx` from where the drag began (left is wider). */
export const dragDockWidth = (startWidth: number, dxPx: number): number => startWidth - dxPx;
