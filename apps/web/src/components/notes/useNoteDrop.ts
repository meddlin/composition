import { useState, type DragEvent } from "react";
import { draggedNoteId, hasDraggedNote } from "./dragTypes";
import { dropZoneAt, type DropZone } from "./panes";

type Options = {
  /** Whether the left and right edges are separate zones; otherwise everything is "center". */
  edges: boolean;
  onDrop: (noteId: number, zone: DropZone) => void;
};

/**
 * Makes an element a drop target for a dragged note (from the sidebar or a pane
 * header). `zone` is where the pointer is while a note is dragged over it, and
 * null otherwise, for drawing the drop indicator.
 */
export function useNoteDrop({ edges, onDrop }: Options) {
  const [zone, setZone] = useState<DropZone | null>(null);

  function zoneFor(event: DragEvent<HTMLElement>): DropZone {
    return edges ? dropZoneAt(event.clientX, event.currentTarget.getBoundingClientRect()) : "center";
  }

  /** Accepts a dragged note: the browser only allows a drop where this was cancelled. */
  function accept(event: DragEvent<HTMLElement>) {
    if (!hasDraggedNote(Array.from(event.dataTransfer.types))) return;
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
      const noteId = draggedNoteId(event.dataTransfer);
      if (noteId === null) return;
      event.preventDefault();
      onDrop(noteId, zoneFor(event));
    },
    // The browser sends no pointer events during a drag, so one means the drag
    // ended without a drop here (Escape, say) and the indicator is stale.
    onPointerMove: zone ? () => setZone(null) : undefined,
    onPointerDown: zone ? () => setZone(null) : undefined,
  };

  return { zone, handlers };
}
