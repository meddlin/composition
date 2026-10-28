import type { WorkspaceStore } from "../notes/workspaceStore";
import { panelIds } from "./layoutTree";
import { MAIN_WINDOW, type WindowId } from "./panelsState";

/** The part of a browser `Window` the controller uses. */
export type PopoutHandle = { readonly closed: boolean; close(): void };

/**
 * Keeps the real windows in step with the workspace's pop-outs: it opens one for each pop-out the workspace has (at
 * launch, those it was saved with) and closes the one of a pop-out that leaves it. The workspace holds the data (which
 * panels are in which window); only this makes the operating system's windows, with `open`, which must be called from
 * the main window's page so the new page can reach the workspace through `window.opener`.
 *
 * A window that cannot be opened does not lose its panels: they go back to the main window. A window the user closed
 * tells the workspace itself (its page does, as it is left). A window that has merely gone is not taken for one the user
 * closed: the app destroys pop-outs, without their pages being told, when the main window closes or the app quits,
 * and they are meant to come back at the next launch.
 */
export function createPopoutController(store: WorkspaceStore, open: (windowId: WindowId) => PopoutHandle | null) {
  const handles = new Map<WindowId, PopoutHandle>();
  let stopped = false;
  let reconciling = false;
  let again = false;

  function reconcile(): void {
    // Changing the workspace in the middle of this (bringing panels back) comes round to it again.
    if (reconciling) {
      again = true;
      return;
    }
    reconciling = true;
    try {
      do {
        again = false;
        const windows = store.getSnapshot().panels.windows;
        const wanted = Object.keys(windows).filter((id) => id !== MAIN_WINDOW);

        for (const id of wanted) {
          if (handles.has(id)) continue;
          const handle = open(id);
          if (handle) {
            handles.set(id, handle);
          } else {
            for (const panelId of panelIds(windows[id].layout)) store.movePanelToWindow(panelId, MAIN_WINDOW);
          }
        }
        for (const [id, handle] of [...handles]) {
          if (wanted.includes(id)) continue;
          handles.delete(id);
          if (!handle.closed) handle.close();
        }
      } while (again);
    } finally {
      reconciling = false;
    }
  }

  const unsubscribe = store.subscribe(() => {
    if (!stopped) reconcile();
  });
  reconcile();

  return {
    stop(): void {
      stopped = true;
      unsubscribe();
    },
  };
}
