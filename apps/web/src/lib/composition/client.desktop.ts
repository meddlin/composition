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
export const createNote: CompositionApi["createNote"] = (title, groupId, notebookId) =>
  bridge().createNote(title, groupId, notebookId);
export const saveNoteContent: CompositionApi["saveNoteContent"] = (noteId, content) =>
  bridge().saveNoteContent(noteId, content);
export const saveImage: CompositionApi["saveImage"] = (input) => bridge().saveImage(input);
export const listImages: CompositionApi["listImages"] = () => bridge().listImages();
export const deleteNote: CompositionApi["deleteNote"] = (id) => bridge().deleteNote(id);
export const moveGroup: CompositionApi["moveGroup"] = (id, parentId) =>
  bridge().moveGroup(id, parentId);
export const moveNoteToGroup: CompositionApi["moveNoteToGroup"] = (noteId, groupId) =>
  bridge().moveNoteToGroup(noteId, groupId);
export const placeNote: CompositionApi["placeNote"] = (noteId, groupId, beforeNoteId) =>
  bridge().placeNote(noteId, groupId, beforeNoteId);
export const placeGroup: CompositionApi["placeGroup"] = (id, parentId, beforeGroupId) =>
  bridge().placeGroup(id, parentId, beforeGroupId);
export const createGroup: CompositionApi["createGroup"] = (name, parentId, notebookId) =>
  bridge().createGroup(name, parentId, notebookId);
export const createNotebook: CompositionApi["createNotebook"] = (name) =>
  bridge().createNotebook(name);
export const renameNotebook: CompositionApi["renameNotebook"] = (id, name) =>
  bridge().renameNotebook(id, name);
export const deleteNotebook: CompositionApi["deleteNotebook"] = (id) =>
  bridge().deleteNotebook(id);
export const moveGroupToNotebook: CompositionApi["moveGroupToNotebook"] = (id, notebookId) =>
  bridge().moveGroupToNotebook(id, notebookId);
export const renameGroup: CompositionApi["renameGroup"] = (id, name) =>
  bridge().renameGroup(id, name);
export const deleteGroup: CompositionApi["deleteGroup"] = (id) => bridge().deleteGroup(id);
export const loadTrash: CompositionApi["loadTrash"] = () => bridge().loadTrash();
export const restoreNote: CompositionApi["restoreNote"] = (id) => bridge().restoreNote(id);
export const restoreGroup: CompositionApi["restoreGroup"] = (id) => bridge().restoreGroup(id);
export const permanentlyDeleteNote: CompositionApi["permanentlyDeleteNote"] = (id) =>
  bridge().permanentlyDeleteNote(id);
export const permanentlyDeleteGroup: CompositionApi["permanentlyDeleteGroup"] = (id) =>
  bridge().permanentlyDeleteGroup(id);
export const saveLayout: CompositionApi["saveLayout"] = (layout) => bridge().saveLayout(layout);
export const saveFavorites: CompositionApi["saveFavorites"] = (favorites) =>
  bridge().saveFavorites(favorites);
export const saveSettings: CompositionApi["saveSettings"] = (input) =>
  bridge().saveSettings(input);
export const saveTheme: CompositionApi["saveTheme"] = (theme) => bridge().saveTheme(theme);
export const savePreviewFont: CompositionApi["savePreviewFont"] = (font) =>
  bridge().savePreviewFont(font);
export const saveAssistantSettings: CompositionApi["saveAssistantSettings"] = (input) =>
  bridge().saveAssistantSettings(input);
export const listAssistantModels: CompositionApi["listAssistantModels"] = () => bridge().listAssistantModels();
export const saveLocation: CompositionApi["saveLocation"] = (city) => bridge().saveLocation(city);
export const loadSunSchedule: CompositionApi["loadSunSchedule"] = () =>
  bridge().loadSunSchedule();

export type {
  AssistantModels,
  ImageInfo,
  ImageUse,
  MoveGroupResult,
  SaveAssistantSettingsInput,
  SaveAssistantSettingsResult,
  SaveImageInput,
  SaveImageResult,
  SaveLocationResult,
  SaveSettingsInput,
  SaveSettingsResult,
  SearchHit,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "./api";
export type { RestoreResult, Trash, TrashedGroup, TrashedNote } from "./trash";

// Same exports as client.ts, checked against the contract.
const _implementsApi: CompositionApi = {
  loadWorkspace,
  loadSettings,
  searchNotes,
  createNote,
  saveNoteContent,
  saveImage,
  listImages,
  deleteNote,
  moveNoteToGroup,
  placeNote,
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
  placeGroup,
  createNotebook,
  renameNotebook,
  deleteNotebook,
  moveGroupToNotebook,
  loadTrash,
  restoreNote,
  restoreGroup,
  permanentlyDeleteNote,
  permanentlyDeleteGroup,
  saveLayout,
  saveFavorites,
  saveSettings,
  saveTheme,
  savePreviewFont,
  saveAssistantSettings,
  listAssistantModels,
  saveLocation,
  loadSunSchedule,
};
void _implementsApi;
