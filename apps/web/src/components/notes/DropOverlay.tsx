import { cn } from "@/lib/utils";
import type { DropZone } from "../panels/layoutTree";

/**
 * Shows where a dragged note will land: half of the pane for beside it (where the
 * new pane will go), all of it for onto it. Purely visual, so it never takes the drop.
 */
export function DropOverlay({ zone }: { zone: DropZone }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
      <div
        data-drop-zone={zone}
        className={cn(
          "absolute border-2 border-brand bg-brand/15 transition-[left,width] duration-100",
          zone === "left" && "inset-y-0 left-0 w-1/2",
          zone === "right" && "inset-y-0 left-1/2 w-1/2",
          zone === "center" && "inset-y-0 left-0 w-full",
          // Above and below belong to the desktop app's grid, where panels also stack.
          zone === "top" && "inset-x-0 top-0 h-1/2",
          zone === "bottom" && "inset-x-0 bottom-0 h-1/2",
        )}
      />
    </div>
  );
}
