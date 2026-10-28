import type { Note } from "./notesRepo";

/**
 * What the desktop app's panels exchange with the backend. Types only, so it is safe to import anywhere (renderer,
 * preload, main). The document is the renderer's own business (see components/panels/panelsDocument.ts): the
 * backend keeps it whole, as a JSON object, and hands it back.
 */
export interface PanelsApi {
  /** How the panels were arranged last time, or undefined if they never were. */
  loadPanels(): Promise<unknown>;
  /** Replaces the saved arrangement; anything that is not a JSON object forgets it. */
  savePanels(document: unknown): Promise<void>;
  /** The notes with these ids that are in the Trash Can (the others are left out), as they were deleted. */
  loadTrashedNotes(noteIds: number[]): Promise<Note[]>;
}

/** Every method of PanelsApi, as data, so the preload script and the main process can't drift from it. */
export const PANELS_METHODS = [
  "loadPanels",
  "savePanels",
  "loadTrashedNotes",
] as const satisfies readonly (keyof PanelsApi)[];

export type PanelsMethod = (typeof PANELS_METHODS)[number];
