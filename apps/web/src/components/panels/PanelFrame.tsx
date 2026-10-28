"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL_DRAG_TYPE } from "../notes/dragTypes";
import { DropOverlay } from "../notes/DropOverlay";
import type { WorkspaceStore } from "../notes/workspaceStore";
import type { DropZone, PanelId } from "./layoutTree";
import type { WindowId } from "./panelsState";
import { PanelMenu } from "./PanelMenu";
import { usePanelDrop } from "./usePanelDrop";

type Props = {
  store: WorkspaceStore;
  panelId: PanelId;
  /** The panel's accessible name. */
  label: string;
  focused: boolean;
  canClose: boolean;
  windowId: WindowId;
  windows: readonly WindowId[];
  alone: boolean;
  /** A note was dropped on the panel (the workspace may ask first). */
  onDropNote: (noteId: number, zone: DropZone) => void;
  /** The kind's own header, in place of the plain one (a note panel's has its find, diagram and view tools). */
  header?: ReactNode;
  /** The plain header's icon and title. */
  icon?: ReactNode;
  title?: string;
  /** Buttons for the plain header, before the panel menu. */
  extras?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * What every panel shares: it takes focus when used, is dragged by its header, and is a place to drop a note or
 * another panel. A kind supplies what is inside.
 */
export function PanelFrame({ store, panelId, label, focused, canClose, windowId, windows, alone, onDropNote, header, icon, title, extras, className, children }: Props) {
  const drop = usePanelDrop({
    onNote: onDropNote,
    onPanel: (movedId, zone) => store.movePanel(movedId, panelId, zone),
  });

  return (
    <section
      aria-label={label}
      aria-current={focused ? "true" : undefined}
      data-panel-id={panelId}
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}
      onPointerDownCapture={() => store.focusPanel(panelId)}
      onFocusCapture={() => store.focusPanel(panelId)}
      {...drop.handlers}
    >
      {header ?? (
        <header
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(PANEL_DRAG_TYPE, panelId);
            event.dataTransfer.effectAllowed = "move";
          }}
          title="Drag to move this panel"
          className="flex shrink-0 cursor-grab items-center gap-1 border-b py-1 pl-4 pr-2 active:cursor-grabbing"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-muted-foreground">
            {icon}
            <span className="truncate">{title}</span>
          </span>
          {extras}
          <PanelMenu store={store} panelId={panelId} canClose={canClose} windowId={windowId} windows={windows} alone={alone} />
        </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {drop.zone && <DropOverlay zone={drop.zone} />}
    </section>
  );
}
