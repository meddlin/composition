/**
 * Custom MIME types so drop targets can tell a dragged note or group apart from
 * any other draggable content a browser might offer.
 */
export const NOTE_DRAG_TYPE = "application/x-composition-note-id";
export const GROUP_DRAG_TYPE = "application/x-composition-group-id";
export const NOTEBOOK_DRAG_TYPE = "application/x-composition-notebook-id";

/**
 * A note dragged by the header of the pane it is open in. Kept apart from
 * NOTE_DRAG_TYPE so the sidebar's groups, which file a dragged note, ignore it.
 */
export const PANE_DRAG_TYPE = "application/x-composition-pane-note-id";

export function hasDraggedNote(types: readonly string[]): boolean {
  return types.includes(NOTE_DRAG_TYPE) || types.includes(PANE_DRAG_TYPE);
}

/** The note id in a drop's payload, from the sidebar or a pane header; null if there is none. */
export function draggedNoteId(data: Pick<DataTransfer, "types" | "getData">): number | null {
  const types = Array.from(data.types);
  for (const type of [NOTE_DRAG_TYPE, PANE_DRAG_TYPE]) {
    if (!types.includes(type)) continue;
    const raw = data.getData(type);
    const id = Number(raw);
    if (raw !== "" && Number.isInteger(id)) return id;
  }
  return null;
}

/**
 * A panel dragged by its header (the desktop app's grid). It carries the panel's id, not a note's, and works within
 * one window.
 */
export const PANEL_DRAG_TYPE = "application/x-composition-panel-id";

export function hasDraggedPanel(types: readonly string[]): boolean {
  return types.includes(PANEL_DRAG_TYPE);
}

/** The panel id in a drop's payload; null if there is none. */
export function draggedPanelId(data: Pick<DataTransfer, "types" | "getData">): string | null {
  if (!Array.from(data.types).includes(PANEL_DRAG_TYPE)) return null;
  return data.getData(PANEL_DRAG_TYPE) || null;
}
