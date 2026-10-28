import type { PanelsApi } from "./panelsApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's panels, reached over Electron IPC through the preload script's `window.composition`. Only the
 * desktop build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): PanelsApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. Panels only run inside the desktop app.");
  }
  return api;
}

export const loadPanels: PanelsApi["loadPanels"] = () => bridge().loadPanels();
export const savePanels: PanelsApi["savePanels"] = (document) => bridge().savePanels(document);
export const loadTrashedNotes: PanelsApi["loadTrashedNotes"] = (noteIds) => bridge().loadTrashedNotes(noteIds);
