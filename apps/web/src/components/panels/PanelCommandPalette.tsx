"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Keys } from "../shortcuts/ShortcutList";
import { useIsMac } from "../shortcuts/useIsMac";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { focusPanelElement } from "./focusPanelElement";
import { isPaletteShortcut, panelCommandForKey, searchPanelCommands, type PanelCommandId } from "./panelCommands";
import { focusedPanelId, type WindowId } from "./panelsState";
import { runPanelCommand } from "./runPanelCommand";

/**
 * The panel commands of one window: their keys, and the command palette that lists them. Mounted once in each window
 * (the main one and every pop-out), so a command acts on the window the user is in.
 */
export function PanelCommandPalette({ store, windowId }: { store: WorkspaceStore; windowId: WindowId }) {
  const [open, setOpen] = useState(false);

  /** Moves the cursor into the window's focused panel, which a command may have changed. */
  const focusFocusedPanel = () => {
    const window = store.getSnapshot().panels.windows[windowId];
    if (window) focusPanelElement(focusedPanelId(window));
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      // Behind the palette, a key for a command would change a window the user cannot see.
      if (open) return;
      const command = panelCommandForKey(event);
      if (command === null) return;
      event.preventDefault();
      runPanelCommand(store, windowId, command);
      // The panel is drawn on the next frame.
      requestAnimationFrame(focusFocusedPanel);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[20%] max-w-lg translate-y-0 gap-2 p-2"
        // Closing would put the cursor back in the panel it was in, which a command may have moved away from.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusFocusedPanel();
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to find a panel command, then press Enter to run it.</DialogDescription>
        <Palette
          onRun={(command) => {
            runPanelCommand(store, windowId, command);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The search box and the list of commands it narrows. It is made fresh each time the palette opens. */
function Palette({ onRun }: { onRun: (command: PanelCommandId) => void }) {
  const isMac = useIsMac();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listboxId = useId();
  const matches = useMemo(() => searchPanelCommands(query), [query]);
  const optionId = (index: number) => `${listboxId}-${index}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((at) => (at + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((at) => (at - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onRun(matches[highlighted].id);
    }
  }

  return (
    <>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Type a command…"
        aria-label="Search commands"
        role="combobox"
        aria-expanded
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={matches.length > 0 ? optionId(highlighted) : undefined}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <ul id={listboxId} role="listbox" aria-label="Commands" className="max-h-72 overflow-y-auto">
        {matches.map((command, index) => (
          <li
            key={command.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === highlighted}
            onMouseMove={() => setHighlighted(index)}
            onClick={() => onRun(command.id)}
            className={cn("flex cursor-default items-center justify-between gap-4 rounded-md px-3 py-2", index === highlighted && "bg-muted")}
          >
            <span>{command.label}</span>
            {command.shortcut && <Keys combo={command.shortcut.keys} isMac={isMac} />}
          </li>
        ))}
        {matches.length === 0 && <li className="px-3 py-2 text-muted-foreground">No matching command</li>}
      </ul>
    </>
  );
}
