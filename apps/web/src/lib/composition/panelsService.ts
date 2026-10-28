import type { PanelsApi } from "./panelsApi";
import * as trashRepo from "./trashRepo";
import { isPlainObject, loadWebSettings, saveWebSettings } from "./webSettings";

/** The desktop app's panels: their arrangement lives in the settings file, beside the other things it remembers. */

export const loadPanels: PanelsApi["loadPanels"] = async () => loadWebSettings().panels;

export const savePanels: PanelsApi["savePanels"] = async (document) => {
  // Merged into the stored settings, so everything else in them survives.
  saveWebSettings({ ...loadWebSettings(), panels: isPlainObject(document) ? document : undefined });
};

export const loadTrashedNotes: PanelsApi["loadTrashedNotes"] = async (noteIds) => trashRepo.getTrashedNotes(noteIds);
