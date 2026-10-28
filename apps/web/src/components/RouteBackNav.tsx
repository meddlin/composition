"use client";

import { useBackForward } from "@/components/notes/useBackForward";

/**
 * Makes the mouse's Back button leave a full-page screen (Settings, Images) the way
 * its "Back to notes" link does. Renders nothing.
 *
 * Plain `window.history` rather than the router: Next follows it either way, and the
 * screens render outside an app router in tests.
 */
export function RouteBackNav() {
  useBackForward(
    () => {
      // Nothing behind this screen (it was opened directly): stay, rather than leave the app.
      if (window.history.length > 1) window.history.back();
    },
    () => window.history.forward(),
  );
  return null;
}
