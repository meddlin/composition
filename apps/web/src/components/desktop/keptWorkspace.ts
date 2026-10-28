import type { WorkspaceData, WorkspaceStore } from "@/components/notes/workspaceStore";

/**
 * The desktop app's workspace, made once and kept for as long as the window's page lives. Settings and Images are
 * separate screens reached by client-side navigation, so the page (and this module) survives a visit to them, and
 * the open panes and AI chats can too.
 */
let kept: WorkspaceStore | null = null;

/**
 * The kept workspace, made from `fresh` on first use. On every later visit it is brought up to date with `fresh`
 * (read from the database a moment ago) instead of being thrown away, because Settings can restore notes from the
 * Trash Can, restore a backup or move the data while the workspace was out of sight.
 */
export function keepWorkspace(fresh: WorkspaceData, make: (data: WorkspaceData) => WorkspaceStore): WorkspaceStore {
  if (kept) {
    kept.reconcile(fresh);
  } else {
    const made = make(fresh);
    // No screen unmounts when the window is closed or the app quits, so the page itself sends what was typed but is
    // still waiting for its autosave. (A window of any kind goes through here: pop-outs edit this workspace.)
    window.addEventListener("pagehide", () => made.flushSaves());
    kept = made;
  }
  return kept;
}

/** For tests: the next `keepWorkspace` makes a new one. */
export function forgetKeptWorkspace(): void {
  kept = null;
}
