"use client";

import { MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PanelId } from "./layoutTree";
import { MAIN_WINDOW, type WindowId } from "./panelsState";
import type { WorkspaceStore } from "../notes/workspaceStore";

type Props = {
  store: WorkspaceStore;
  panelId: PanelId;
  /** Whether closing does anything: the main window's only panel, if it is empty already, has nothing to close. */
  canClose: boolean;
  /** The window the panel is in, and every window there is (the main one first). */
  windowId: WindowId;
  windows: readonly WindowId[];
  /** Whether it is the only panel of its window, which a pop-out gains nothing from being moved out of. */
  alone: boolean;
};

/** What a window is called in a menu: the main one, or a pop-out by its place among the pop-outs. */
export function windowLabel(windowId: WindowId, windows: readonly WindowId[]): string {
  if (windowId === MAIN_WINDOW) return "Main window";
  return `Window ${windows.filter((id) => id !== MAIN_WINDOW).indexOf(windowId) + 1}`;
}

/** The buttons at the end of a panel's header: new panel, its menu, and close. */
export function PanelMenu({ store, panelId, canClose, windowId, windows, alone }: Props) {
  const inPopout = windowId !== MAIN_WINDOW;
  // Other pop-outs it can be moved to: the main window has its own item, and only a pop-out needs it.
  const otherPopouts = windows.filter((id) => id !== MAIN_WINDOW && id !== windowId);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(event) => store.splitPanel(panelId, event.altKey ? "bottom" : "right")}
        aria-label="New panel"
        title="New panel to the right (Option-click: below)"
        className="text-muted-foreground hover:text-foreground"
      >
        <PlusIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Panel options"
            title="Panel options"
            className="text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => store.splitPanel(panelId, "right")}>Split right</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => store.splitPanel(panelId, "bottom")}>Split down</DropdownMenuItem>
          <DropdownMenuSeparator />
          {!(inPopout && alone) && (
            <DropdownMenuItem onSelect={() => store.movePanelToNewWindow(panelId)}>Move to new window</DropdownMenuItem>
          )}
          {otherPopouts.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to window</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherPopouts.map((id) => (
                  <DropdownMenuItem key={id} onSelect={() => store.movePanelToWindow(panelId, id)}>
                    {windowLabel(id, windows)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {inPopout && (
            <DropdownMenuItem onSelect={() => store.movePanelToWindow(panelId, MAIN_WINDOW)}>Move back to main window</DropdownMenuItem>
          )}
          {canClose && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => store.closePanel(panelId)}>Close</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => store.closePanel(panelId)}
          aria-label="Close panel"
          title="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <XIcon />
        </Button>
      )}
    </>
  );
}
