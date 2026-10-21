"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShortcutList } from "./ShortcutList";

type Helper = { show: () => void };

const HelperContext = createContext<Helper>({ show: () => {} });

/** Lets any screen pop the shortcuts window up, e.g. the Settings section's button. */
export const useShortcutsHelper = () => useContext(HelperContext);

/** Whether typing into this element would make a bare key (like "?") a character, not a command. */
function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Cmd/Ctrl+/ from anywhere, or a bare "?" when not typing; not Alt, not a key held down. */
export function isShortcutsShortcut(event: KeyboardEvent) {
  if (event.altKey || event.repeat || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return event.key === "/" && !event.shiftKey;
  return event.key === "?" && !isTyping(event.target);
}

/**
 * Mounted once in the root layout so the shortcut works on every screen. The list is shown in a
 * floating window over whatever is underneath, and the same list appears in Settings.
 */
export function ShortcutsHelper({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const helper = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !isShortcutsShortcut(event)) return;
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <HelperContext.Provider value={helper}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Press Esc to close.</DialogDescription>
          </DialogHeader>
          <ShortcutList />
        </DialogContent>
      </Dialog>
    </HelperContext.Provider>
  );
}
