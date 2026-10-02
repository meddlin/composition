import { service } from "./backend";

/**
 * What the UI asks of the shared data layer. Components take this as a prop (defaulting to
 * the real thing), so tests can swap one method, such as search, without a mocking library.
 */
export type Api = Pick<
  typeof service,
  | "loadWorkspace"
  | "createNote"
  | "createGroup"
  | "renameGroup"
  | "deleteNote"
  | "deleteGroup"
  | "moveNoteToGroup"
  | "saveNoteContent"
  | "readImage"
  | "searchNotes"
  | "loadTrash"
  | "restoreNote"
  | "restoreGroup"
  | "permanentlyDeleteNote"
  | "permanentlyDeleteGroup"
  | "moveGroup"
  | "saveFavorites"
  | "saveTheme"
  | "saveLocation"
  | "loadSettings"
  | "loadSunSchedule"
>;

export const defaultApi: Api = service;
