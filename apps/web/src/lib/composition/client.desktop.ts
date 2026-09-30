import type { CompositionApi } from "./api";
import type {} from "./desktopBridge";

/**
 * Desktop build's replacement for `client.ts` (see next.config.ts): the same
 * contract, carried over Electron IPC by the preload script's
 * `window.composition` instead of Server Actions.
 */

function bridge(): CompositionApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error(
      "The Composition desktop bridge is unavailable. This build only runs inside the desktop app.",
    );
  }
  return api;
}

export const loadWorkspace: CompositionApi["loadWorkspace"] = () => bridge().loadWorkspace();
export const loadSettings: CompositionApi["loadSettings"] = () => bridge().loadSettings();
export const searchNotes: CompositionApi["searchNotes"] = (query) => bridge().searchNotes(query);
export const createNote: CompositionApi["createNote"] = (title, groupId) =>
  bridge().createNote(title, groupId);
export const saveNoteContent: CompositionApi["saveNoteContent"] = (noteId, content) =>
  bridge().saveNoteContent(noteId, content);
export const deleteNote: CompositionApi["deleteNote"] = (id) => bridge().deleteNote(id);
export const moveGroup: CompositionApi["moveGroup"] = (id, parentId) =>
  bridge().moveGroup(id, parentId);
export const moveNoteToGroup: CompositionApi["moveNoteToGroup"] = (noteId, groupId) =>
  bridge().moveNoteToGroup(noteId, groupId);
export const createGroup: CompositionApi["createGroup"] = (name, parentId) =>
  bridge().createGroup(name, parentId);
export const renameGroup: CompositionApi["renameGroup"] = (id, name) =>
  bridge().renameGroup(id, name);
export const deleteGroup: CompositionApi["deleteGroup"] = (id) => bridge().deleteGroup(id);
export const saveLayout: CompositionApi["saveLayout"] = (layout) => bridge().saveLayout(layout);
export const saveSettings: CompositionApi["saveSettings"] = (input) =>
  bridge().saveSettings(input);
export const saveTheme: CompositionApi["saveTheme"] = (theme) => bridge().saveTheme(theme);
export const saveLocation: CompositionApi["saveLocation"] = (city) => bridge().saveLocation(city);
export const loadSunSchedule: CompositionApi["loadSunSchedule"] = () =>
  bridge().loadSunSchedule();

export type {
  MoveGroupResult,
  SaveLocationResult,
  SaveSettingsInput,
  SaveSettingsResult,
  SearchHit,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "./api";

// Same exports as client.ts, checked against the contract.
const _implementsApi: CompositionApi = {
  loadWorkspace,
  loadSettings,
  searchNotes,
  createNote,
  saveNoteContent,
  deleteNote,
  moveNoteToGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
  saveLayout,
  saveSettings,
  saveTheme,
  saveLocation,
  loadSunSchedule,
};
void _implementsApi;
