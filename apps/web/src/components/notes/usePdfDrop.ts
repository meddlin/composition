import { useState, type DragEvent } from "react";
import { dragMayBePdf } from "./pdfFiles";

/**
 * Makes a window a drop target for PDFs dragged in from the operating system. `active` is true while one is over it, for drawing
 * a hint. The handlers go on the window's root and run before anything inside it (the note editor takes a dropped file as text,
 * and would swallow the drop), except over a zone that marks itself `data-pdf-drop-zone`, such as a group in the sidebar, which
 * takes the drop for its own group: those events are left to bubble to it.
 */
export function usePdfDrop(options: { enabled: boolean; onDrop: (data: DataTransfer) => void }) {
  const { enabled, onDrop } = options;
  const [active, setActive] = useState(false);

  const carriesPdf = (event: DragEvent<HTMLElement>) => enabled && dragMayBePdf(event.dataTransfer);
  const overZone = (event: DragEvent<HTMLElement>) => event.target instanceof Element && event.target.closest("[data-pdf-drop-zone]") !== null;

  const handlers = {
    onDragEnterCapture(event: DragEvent<HTMLElement>) {
      if (carriesPdf(event)) setActive(!overZone(event));
    },
    onDragOverCapture(event: DragEvent<HTMLElement>) {
      if (!carriesPdf(event)) return;
      // A zone shows its own highlight, so the window's hint steps aside while the pointer is over one.
      setActive(!overZone(event));
      if (overZone(event)) return;
      // The browser allows a drop only where dragover is cancelled.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeaveCapture(event: DragEvent<HTMLElement>) {
      // Moving onto another element of the window also fires dragleave; only leaving the window ends the hint.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setActive(false);
    },
    onDropCapture(event: DragEvent<HTMLElement>) {
      setActive(false);
      if (!carriesPdf(event) || overZone(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onDrop(event.dataTransfer);
    },
  };

  return { active, handlers };
}
