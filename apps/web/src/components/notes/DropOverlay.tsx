import { cn } from "@/lib/utils";
import type { DropZone } from "./panes";

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
          "absolute inset-y-0 border-2 border-brand bg-brand/15 transition-[left,width] duration-100",
          zone === "left" && "left-0 w-1/2",
          zone === "right" && "left-1/2 w-1/2",
          zone === "center" && "left-0 w-full",
        )}
      />
    </div>
  );
}
