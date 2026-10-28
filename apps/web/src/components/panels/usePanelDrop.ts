import { useState, type DragEvent } from "react";
import { draggedNoteId, draggedPanelId, hasDraggedNote, hasDraggedPanel } from "../notes/dragTypes";
import { dropZoneAt, type DropZone, type PanelId } from "./layoutTree";

type Options = {
  /** A note was dropped (from the sidebar, or by the header of an open note). */
  onNote: (noteId: number, zone: DropZone) => void;
  /** A panel was dropped by its header. */
  onPanel: (panelId: PanelId, zone: DropZone) => void;
};

/**
 * Makes a panel a drop target for a dragged note or panel. `zone` is the side of the panel the pointer is nearest, or
 * its middle, while something is dragged over it, and null otherwise, for drawing the drop indicator.
 */
export function usePanelDrop({ onNote, onPanel }: Options) {
  const [zone, setZone] = useState<DropZone | null>(null);

  function zoneFor(event: DragEvent<HTMLElement>): DropZone {
    return dropZoneAt({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect());
  }

  /** Accepts a dragged note or panel: the browser only allows a drop where this was cancelled. */
  function accept(event: DragEvent<HTMLElement>) {
    const types = Array.from(event.dataTransfer.types);
    if (!hasDraggedNote(types) && !hasDraggedPanel(types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setZone(zoneFor(event));
  }

  const handlers = {
    // Both, so a drop right after entering is accepted without waiting for the next dragover.
    onDragEnter: accept,
    onDragOver: accept,
    onDragLeave(event: DragEvent<HTMLElement>) {
      // Moving onto a child of the target also fires dragleave, but not out of its bounds.
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
      const inside = event.clientX >= left && event.clientX < right && event.clientY >= top && event.clientY < bottom;
      if (!inside) setZone(null);
    },
    onDrop(event: DragEvent<HTMLElement>) {
      setZone(null);
      const panelId = draggedPanelId(event.dataTransfer);
      const noteId = panelId === null ? draggedNoteId(event.dataTransfer) : null;
      if (panelId === null && noteId === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (panelId !== null) onPanel(panelId, zoneFor(event));
      else onNote(noteId!, zoneFor(event));
    },
    // The browser sends no pointer events during a drag, so one means the drag
    // ended without a drop here (Escape, say) and the indicator is stale.
    onPointerMove: zone ? () => setZone(null) : undefined,
    onPointerDown: zone ? () => setZone(null) : undefined,
  };

  return { zone, handlers };
}
