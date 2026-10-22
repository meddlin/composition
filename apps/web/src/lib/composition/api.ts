import type { ModelSummary } from "./assistant/models";
import type { AssistantSettings } from "./assistant/settings";
import type { ChatErrorKind } from "./assistant/types";
import type { Favorites } from "./favorites";
import type { Group } from "./groupsRepo";
import type { Layout } from "./layout";
import type { Notebook } from "./notebooksRepo";
import type { Note } from "./notesRepo";
import type { PreviewFontName } from "./previewFonts";
import type { SunSchedule } from "./sunTimes";
import type { ThemeName } from "./themes";
import type { RestoreResult, Trash } from "./trash";

/**
 * The contract between the notes UI and whatever stores the data. Two
 * transports implement it:
 *
 *   web     -> Next.js Server Actions   (lib/composition/actions.ts)
 *   desktop -> Electron IPC             (apps/desktop, see client.desktop.ts)
 *
 * Both end at the framework-free implementation in `service.ts`. Types only
 * here, apart from API_METHODS, so this file is safe to import anywhere
 * (renderer, preload, main).
 */

export type SearchHit = {
  id: number;
  title: string;
  description: string;
  /** Names of the note's group and its ancestors, outermost first; empty when the note is ungrouped. */
  groupPath: string[];
};

export type SearchResult = { hits: SearchHit[]; error?: string };

/** Everything the notes workspace needs to render for the first time. */
export type Workspace = {
  notes: Note[];
  groups: Group[];
  notebooks: Notebook[];
  layout: Layout;
  favorites: Favorites;
};

/** What the Settings screen shows; computed where the files actually are. */
export type SettingsSnapshot = {
  theme: ThemeName;
  previewFont: PreviewFontName;
  appDataDir: string;
  /** The database file in use (override if set, otherwise derived). */
  dbPath: string;
  /** The explicit override, or "" when the derived default is in use. */
  dbPathOverride: string;
  /** What the database path would be without an override. */
  derivedDbPath: string;
  dirWritable: boolean;
  dbExists: boolean;
  /** Where "Create backup" offers to save by default (the web app and the CLI; the desktop app asks in a dialog). */
  backupDir: string;
  /** The Trash Can's contents (empty when there is no database yet). */
  trash: Trash;
  /** The AI helper's saved Ollama server and context size (the defaults until some are saved). */
  assistant: AssistantSettings;
  /** The saved city for the "Follow the sun" scheme, or "". */
  city: string;
  /** Today's sunrise and sunset there, formatted in its own timezone (when a city is saved and reachable). */
  sunTimes?: SunTimesToday;
};

export type SunTimesToday = { sunrise?: string; sunset?: string };

/** `saved` is absent when the city was cleared or couldn't be saved (then `error` may say why). */
export type SaveLocationResult = {
  error?: string;
  saved?: { name: string } & SunTimesToday;
};

/** A refused move (into itself or a descendant, or a group that's gone) comes back as `error`. */
export type MoveGroupResult = { group?: Group; error?: string };

export type SaveSettingsInput = { appDataDir: string; dbPath: string };

export type SaveSettingsResult = {
  error?: string;
  success?: boolean;
  appDataDir?: string;
  dbPath?: string;
};

export type SaveAssistantSettingsInput = { serverUrl: string; contextTokens: number };

/** `settings` is what was saved, normalized; absent with `error` when nothing was. */
export type SaveAssistantSettingsResult = { error?: string; settings?: AssistantSettings };

/** The models the saved Ollama server offers the AI helper. */
export type AssistantModels = {
  /** The address that was asked, so the UI can show where the text will go. */
  serverUrl: string;
  /** Whether that address is this machine; if not, notes sent there cross a network. */
  local: boolean;
  /** The context size the helper asks the server for, from the saved settings. */
  contextTokens: number;
  models: ModelSummary[];
  /** How many models were left out because they would run on Ollama's cloud rather than that server. */
  hiddenCloud: number;
  /** Why the list could not be read, in a sentence a person can act on. */
  error?: { kind: ChatErrorKind; message: string };
};

/** An image pasted into a note; `fileName` is the original name, used only to name the stored copy. */
export type SaveImageInput = { noteId: number; fileName: string; data: Uint8Array };

/** `name` is the stored file; the note refers to it as `imageRef(name)` (imageRefs.ts). */
export type SaveImageResult = { name?: string; error?: string };

/** A note that refers to a stored image. */
export type ImageUse = { id: number; title: string };

/** One image in `<application data>/app_data/`, and where it is still used. */
export type ImageInfo = {
  /** The stored file's name; a note refers to it as `imageRef(name)` (imageRefs.ts). */
  name: string;
  /** Size in bytes. */
  size: number;
  /** When the file was first stored (ISO 8601). */
  modifiedAt: string;
  /** The notes whose text points at it, which is empty once the last reference has been deleted. */
  usedIn: ImageUse[];
};

export interface CompositionApi {
  loadWorkspace(): Promise<Workspace>;
  loadSettings(): Promise<SettingsSnapshot>;

  searchNotes(query: string): Promise<SearchResult>;

  /** In `groupId`'s notebook when it has a group; otherwise in `notebookId` (the first notebook when that is omitted too). */
  createNote(title: string, groupId?: number | null, notebookId?: number | null): Promise<Note>;
  saveNoteContent(noteId: number, content: string): Promise<Note>;
  /** Stores a pasted image in `<application data>/app_data/`. Served back by `app_data/<name>`, which is not part of this contract. */
  saveImage(input: SaveImageInput): Promise<SaveImageResult>;
  /** Every stored image, newest first, with the notes that still refer to it. Lets an image be found again after the text that pointed at it is gone. */
  listImages(): Promise<ImageInfo[]>;
  /** Moves the note to the Trash Can; it is not erased (see `permanentlyDeleteNote`). */
  deleteNote(id: number): Promise<void>;
  moveNoteToGroup(noteId: number, groupId: number | null): Promise<Note>;
  /**
   * Files the note in `groupId` (null = ungrouped) immediately before the sibling note
   * `beforeNoteId`, or last when that is null, and keeps the siblings in that order.
   */
  placeNote(noteId: number, groupId: number | null, beforeNoteId: number | null): Promise<Note>;

  /** A sub-group joins its parent's notebook; a top-level group goes in `notebookId` (the first notebook when omitted). */
  createGroup(name: string, parentId: number | null, notebookId?: number | null): Promise<Group>;
  renameGroup(id: number, name: string): Promise<Group>;
  /** Moves an empty group to the Trash Can; a group with notes or sub-groups comes back as `error`. */
  deleteGroup(id: number): Promise<{ error?: string }>;
  moveGroup(id: number, parentId: number | null): Promise<MoveGroupResult>;
  /** Like `placeNote`, for a group among its parent's sub-groups. Refuses the moves `moveGroup` does. */
  placeGroup(
    id: number,
    parentId: number | null,
    beforeGroupId: number | null,
  ): Promise<MoveGroupResult>;

  createNotebook(name: string): Promise<Notebook>;
  renameNotebook(id: number, name: string): Promise<Notebook>;
  /** Puts a notebook just before another in the list (last when `beforeNotebookId` is null); answers with the new order. */
  placeNotebook(id: number, beforeNotebookId: number | null): Promise<Notebook[]>;
  /** Deletes an empty notebook for good; one with groups or notes in it, or the last one, comes back as `error`. */
  deleteNotebook(id: number): Promise<{ error?: string }>;
  /** Moves a group (or sub-group) with everything in it to the top level of another notebook. */
  moveGroupToNotebook(id: number, notebookId: number): Promise<MoveGroupResult>;

  /** Recently deleted notes and groups. Anything older than `TRASH_RETENTION_DAYS` is permanently deleted first. */
  loadTrash(): Promise<Trash>;
  restoreNote(id: number): Promise<RestoreResult>;
  restoreGroup(id: number): Promise<RestoreResult>;
  permanentlyDeleteNote(id: number): Promise<void>;
  permanentlyDeleteGroup(id: number): Promise<void>;

  saveLayout(layout: Layout): Promise<void>;
  /** Replaces the pinned list (the sidebar's Favorites section). */
  saveFavorites(favorites: Favorites): Promise<void>;
  saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult>;
  saveTheme(theme: string): Promise<{ error?: string }>;
  /** Chooses the font a note's preview is shown in; a name not in `PREVIEW_FONT_CHOICES` comes back as `error`. */
  savePreviewFont(font: string): Promise<{ error?: string }>;

  /** Saves where the AI helper finds Ollama and how large a context window it asks for; a bad value comes back as `error`. */
  saveAssistantSettings(input: SaveAssistantSettingsInput): Promise<SaveAssistantSettingsResult>;
  /** Asks the saved Ollama server which models the AI helper can use. The renderer never supplies the address. */
  listAssistantModels(): Promise<AssistantModels>;

  /** Geocodes and saves the city that "Follow the sun" tracks; an empty string forgets it. */
  saveLocation(city: string): Promise<SaveLocationResult>;
  /** Sunrise/sunset events for the "auto" scheme, or null when another scheme is selected. */
  loadSunSchedule(): Promise<SunSchedule | null>;
}

/**
 * Every method of CompositionApi, as data, so a transport that has to
 * enumerate them (Electron's preload and main process) can't drift from the
 * interface: the check below fails to compile if a method is missing here.
 */
export const API_METHODS = [
  "loadWorkspace",
  "loadSettings",
  "searchNotes",
  "createNote",
  "saveNoteContent",
  "saveImage",
  "listImages",
  "deleteNote",
  "moveNoteToGroup",
  "placeNote",
  "createGroup",
  "renameGroup",
  "deleteGroup",
  "moveGroup",
  "placeGroup",
  "createNotebook",
  "renameNotebook",
  "placeNotebook",
  "deleteNotebook",
  "moveGroupToNotebook",
  "loadTrash",
  "restoreNote",
  "restoreGroup",
  "permanentlyDeleteNote",
  "permanentlyDeleteGroup",
  "saveLayout",
  "saveFavorites",
  "saveSettings",
  "saveTheme",
  "savePreviewFont",
  "saveAssistantSettings",
  "listAssistantModels",
  "saveLocation",
  "loadSunSchedule",
] as const satisfies readonly (keyof CompositionApi)[];

export type ApiMethod = (typeof API_METHODS)[number];

type MissingFromApiMethods = Exclude<keyof CompositionApi, ApiMethod>;
const _everyMethodListed: [MissingFromApiMethods] extends [never] ? true : never = true;
void _everyMethodListed;
