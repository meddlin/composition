import type { WorkspaceStore } from "../notes/workspaceStore";
import type { PanelId } from "./layoutTree";
import { isLauncherKind } from "./launchers";
import type { PanelCommandId } from "./panelCommands";
import { MAIN_WINDOW, focusedPanelId, type KindId, type WindowId } from "./panelsState";

/**
 * Does what a panel command says to the focused panel of a window. A command that does not apply (moving the main
 * window's panel to the main window, or any command for a window that is gone) changes nothing. An Open command says
 * which panel it opened or went to, and is null for the others, and for one that opened nothing (its plugin is off).
 */
export function runPanelCommand(store: WorkspaceStore, windowId: WindowId, id: PanelCommandId): PanelId | null {
  const window = store.getSnapshot().panels.windows[windowId];
  if (!window) return null;

  if (id.startsWith("open:")) {
    const kind = id.slice("open:".length) as KindId;
    return isLauncherKind(kind) ? store.openKind(kind, windowId) : null;
  }
  const panelId = focusedPanelId(window);

  switch (id) {
    case "split-right":
      store.splitPanel(panelId, "right");
      break;
    case "split-down":
      store.splitPanel(panelId, "bottom");
      break;
    case "close-panel":
      store.closePanel(panelId);
      break;
    case "next-panel":
      store.focusNeighbour(1, windowId);
      break;
    case "previous-panel":
      store.focusNeighbour(-1, windowId);
      break;
    case "move-to-new-window":
      store.movePanelToNewWindow(panelId);
      break;
    case "move-to-main-window":
      store.movePanelToWindow(panelId, MAIN_WINDOW);
      break;
  }
  return null;
}
