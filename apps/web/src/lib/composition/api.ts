import type { Group } from "./groupsRepo";
import type { Layout } from "./layout";
import type { Note } from "./notesRepo";
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
};

export type SaveSettingsInput = { appDataDir: string; dbPath: string };

export type SaveSettingsResult = {
  error?: string;
  success?: boolean;
  appDataDir?: string;
  dbPath?: string;
};

export interface CompositionApi {
  loadWorkspace(): Promise<Workspace>;
  loadSettings(): Promise<SettingsSnapshot>;

  searchNotes(query: string): Promise<SearchResult>;

  createNote(title: string, groupId?: number | null): Promise<Note>;
  saveNoteContent(noteId: number, content: string): Promise<Note>;
  deleteNote(id: number): Promise<void>;
  moveNoteToGroup(noteId: number, groupId: number | null): Promise<Note>;

  createGroup(name: string, parentId: number | null): Promise<Group>;
  renameGroup(id: number, name: string): Promise<Group>;
  deleteGroup(id: number): Promise<{ error?: string }>;

  saveLayout(layout: Layout): Promise<void>;
  saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult>;
  saveTheme(theme: string): Promise<{ error?: string }>;
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
  "deleteNote",
  "moveNoteToGroup",
  "createGroup",
  "renameGroup",
  "deleteGroup",
  "saveLayout",
  "saveSettings",
  "saveTheme",
] as const satisfies readonly (keyof CompositionApi)[];

export type ApiMethod = (typeof API_METHODS)[number];

type MissingFromApiMethods = Exclude<keyof CompositionApi, ApiMethod>;
const _everyMethodListed: [MissingFromApiMethods] extends [never] ? true : never = true;
void _everyMethodListed;
