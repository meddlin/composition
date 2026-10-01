import type { Favorites } from "./favorites";
import type { Group } from "./groupsRepo";
import type { Layout } from "./layout";
import type { Note } from "./notesRepo";
import type { SunSchedule } from "./sunTimes";
import type { ThemeName } from "./themes";

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

export type SearchHit = { id: number; title: string; description: string };

export type SearchResult = { hits: SearchHit[]; error?: string };

/** Everything the notes workspace needs to render for the first time. */
export type Workspace = {
  notes: Note[];
  groups: Group[];
  layout: Layout;
  favorites: Favorites;
};

/** What the Settings screen shows; computed where the files actually are. */
export type SettingsSnapshot = {
  theme: ThemeName;
  appDataDir: string;
  /** The database file in use (override if set, otherwise derived). */
  dbPath: string;
  /** The explicit override, or "" when the derived default is in use. */
  dbPathOverride: string;
  /** What the database path would be without an override. */
  derivedDbPath: string;
  dirWritable: boolean;
  dbExists: boolean;
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

/** An image pasted into a note; `fileName` is the original name, used only to name the stored copy. */
export type SaveImageInput = { noteId: number; fileName: string; data: Uint8Array };

/** `name` is the stored file; the note refers to it as `imageRef(name)` (imageRefs.ts). */
export type SaveImageResult = { name?: string; error?: string };

export interface CompositionApi {
  loadWorkspace(): Promise<Workspace>;
  loadSettings(): Promise<SettingsSnapshot>;

  searchNotes(query: string): Promise<SearchResult>;

  createNote(title: string, groupId?: number | null): Promise<Note>;
  saveNoteContent(noteId: number, content: string): Promise<Note>;
  /** Stores a pasted image in `<application data>/app_data/`. Served back by `app_data/<name>`, which is not part of this contract. */
  saveImage(input: SaveImageInput): Promise<SaveImageResult>;
  deleteNote(id: number): Promise<void>;
  moveNoteToGroup(noteId: number, groupId: number | null): Promise<Note>;

  createGroup(name: string, parentId: number | null): Promise<Group>;
  renameGroup(id: number, name: string): Promise<Group>;
  deleteGroup(id: number): Promise<{ error?: string }>;
  moveGroup(id: number, parentId: number | null): Promise<MoveGroupResult>;

  saveLayout(layout: Layout): Promise<void>;
  /** Replaces the pinned list (the sidebar's Favorites section). */
  saveFavorites(favorites: Favorites): Promise<void>;
  saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult>;
  saveTheme(theme: string): Promise<{ error?: string }>;

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
  "deleteNote",
  "moveNoteToGroup",
  "createGroup",
  "renameGroup",
  "deleteGroup",
  "moveGroup",
  "saveLayout",
  "saveFavorites",
  "saveSettings",
  "saveTheme",
  "saveLocation",
  "loadSunSchedule",
] as const satisfies readonly (keyof CompositionApi)[];

export type ApiMethod = (typeof API_METHODS)[number];

type MissingFromApiMethods = Exclude<keyof CompositionApi, ApiMethod>;
const _everyMethodListed: [MissingFromApiMethods] extends [never] ? true : never = true;
void _everyMethodListed;
