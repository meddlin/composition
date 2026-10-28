import { useEffect, useRef } from "react";
import { useIsMac } from "@/components/shortcuts/useIsMac";

// The buttons on the side of a mouse, as `MouseEvent.button` numbers them.
const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

/** Whether a dialog is open: Back must not move the page out from under a question being asked. */
function dialogIsOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * Calls `onBack` and `onForward` for the mouse's Back and Forward buttons, and for the
 * keys that do the same elsewhere: Cmd+[ and Cmd+] on a Mac, Alt+Left and Alt+Right
 * otherwise.
 *
 * The browser would take those buttons itself and navigate away from the page, so the
 * presses are claimed here. Electron does not navigate on them, so this is also what
 * makes them do anything in the desktop app.
 */
export function useBackForward(onBack: () => void, onForward: () => void): void {
  const isMac = useIsMac();
  // The newest callbacks, so the listeners are attached once and never see stale state.
  const latest = useRef({ onBack, onForward });
  useEffect(() => {
    latest.current = { onBack, onForward };
  });

  useEffect(() => {
    function onMouse(event: MouseEvent) {
      if (event.button !== BACK_BUTTON && event.button !== FORWARD_BUTTON) return;
      // Claim every part of the press, or the browser still navigates on one of them.
      event.preventDefault();
      if (event.type !== "mouseup" || dialogIsOpen()) return;
      if (event.button === BACK_BUTTON) latest.current.onBack();
      else latest.current.onForward();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.shiftKey || event.ctrlKey) return;
      const direction = isMac
        ? event.metaKey && !event.altKey && (event.key === "[" ? -1 : event.key === "]" ? 1 : 0)
        : event.altKey && !event.metaKey && (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
      if (!direction) return;
      event.preventDefault();
      if (dialogIsOpen()) return;
      if (direction < 0) latest.current.onBack();
      else latest.current.onForward();
    }

    // Capture, so a field or widget that stops the event cannot hide it from here.
    const mouseEvents = ["mousedown", "mouseup", "auxclick"] as const;
    for (const type of mouseEvents) window.addEventListener(type, onMouse, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      for (const type of mouseEvents) window.removeEventListener(type, onMouse, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isMac]);
}
