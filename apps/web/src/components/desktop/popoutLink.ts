import type { WorkspaceStore } from "../notes/workspaceStore";
import type { PopoutHandle } from "../panels/popoutController";
import type { WritingSettings } from "@/lib/composition/writing";

/**
 * What the main window shares with the pop-outs it opens. Every window is a page with its own copies of the libraries,
 * but they work on one workspace, held by the main window's page: it publishes it here, and a pop-out reaches it through
 * `window.opener` (see docs/panel-system-plan.md, "A′"). Only plain data and functions cross: no DOM nodes, and no
 * `instanceof` on what comes out of the store (an array made in the main window is not an `Array` of this one).
 */
export type SharedWorkspace = {
  store: WorkspaceStore;
  /** The editor's ruler and reflow, as the main window read them when the workspace loaded. */
  writing: WritingSettings;
};

declare global {
  interface Window {
    __workspace?: SharedWorkspace;
  }
}

/** Called by the main window's page, whenever it has loaded the workspace. */
export function publishWorkspace(shared: SharedWorkspace): void {
  window.__workspace = shared;
}

/** The workspace the window that opened this one published, or null if this page was not opened by one. */
export function sharedWorkspaceFromOpener(): SharedWorkspace | null {
  try {
    return window.opener?.__workspace ?? null;
  } catch {
    // An opener of another origin cannot be read.
    return null;
  }
}

/** The address of a pop-out's page. The main process lets exactly this shape be opened (see `popoutWindows.ts`). */
export function popoutUrl(windowId: string): string {
  return `${window.location.origin}/popout/?w=${encodeURIComponent(windowId)}`;
}

/** Opens a pop-out's real window. Must be called from the main window's page, so the new page has an opener. */
export function openPopoutWindow(windowId: string): PopoutHandle | null {
  // Named for the window, so asking again for one that is open finds it rather than making a second.
  return window.open(popoutUrl(windowId), `composition-${windowId}`);
}

/**
 * Takes a pop-out's window out of the workspace when the app says the user closed it (after sending what was typed in it),
 * and returns what stops listening. The pop-out's page cannot say so itself: it runs its unload events when the app
 * tears it down as well, as it does when the main window closes or the app quits, and then the workspace must keep
 * the window so it comes back at the next launch.
 */
export function forgetPopoutsTheUserCloses(store: WorkspaceStore): () => void {
  return window.composition?.onPopoutClosed((windowId) => store.closeWindow(windowId)) ?? (() => {});
}
