import fs from "node:fs";
import path from "node:path";
import type {
  CompositionApi,
  MoveGroupResult,
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
import { closeDb } from "./db";
import { parseFavorites, type Favorites } from "./favorites";
import * as frontmatter from "./frontmatter";
import * as groupsRepo from "./groupsRepo";
import { GroupNotEmptyError, InvalidGroupMoveError } from "./groupsRepo";
import type { Group } from "./groupsRepo";
import * as images from "./images";
import { clampEditorRatio, clampSidebarWidth, type Layout } from "./layout";
import * as notesRepo from "./notesRepo";
import type { Note } from "./notesRepo";
import { defaultDatabasePath, expandHome } from "./paths";
import * as searchIndex from "./searchIndex";
import {
  cachedSunSchedule,
  geocodeCity,
  loadSunEvents,
  resolveSunSchedule,
  todaysSunTimes,
  type SunSchedule,
} from "./sunTimes";
import { sunThemeAttributes } from "./sunSchedule";
import { isThemeName } from "./themes";
import { loadWebSettings, resolvedDbPath, saveWebSettings, type WebSettings } from "./webSettings";

/**
 * The framework-free implementation of CompositionApi. No `next/*` imports
 * belong here: the web app wraps these in Server Actions (actions.ts) and the
 * desktop app calls them from Electron's main process.
 */

/**
 * Indexing is derived state (docs/architecture/search.md): a Meilisearch outage
 * must never fail or roll back a write, so errors are logged and swallowed.
 */
async function bestEffortIndex(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error("[search] indexing failed:", error);
  }
}

export async function loadWorkspace(): Promise<Workspace> {
  const { sidebarWidth, editorRatio, favorites } = loadWebSettings();
  return {
    notes: notesRepo.listNotes(),
    groups: groupsRepo.listGroups(),
    layout: { sidebarWidth, editorRatio },
    favorites,
  };
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export async function loadSettings(): Promise<SettingsSnapshot> {
  const settings = loadWebSettings();
  const dbPath = resolvedDbPath(settings);
  const { location } = settings;
  return {
    theme: settings.theme,
    appDataDir: settings.appDataDir,
    dbPath,
    dbPathOverride: settings.dbPath ?? "",
    derivedDbPath: defaultDatabasePath(settings.appDataDir),
    dirWritable: isWritableDir(settings.appDataDir),
    dbExists: fs.existsSync(dbPath),
    city: location?.name ?? "",
    sunTimes: location
      ? todaysSunTimes(await loadSunEvents(location), location.timezone)
      : undefined,
  };
}

/**
 * Never throws: an unreachable Meilisearch comes back as `error` (no hits) so
 * the UI can say "unavailable" instead of a misleading "No matches".
 */
export async function searchNotes(query: string): Promise<SearchResult> {
  try {
    const ids = await searchIndex.searchNoteIds(query);
    const hits: SearchHit[] = [];
    for (const id of ids) {
      const note = notesRepo.getNote(id);
      if (note) hits.push({ id: note.id, title: note.title, description: note.description });
    }
    return { hits };
  } catch (error) {
    console.error("[search] query failed:", error);
    return {
      hits: [],
      error: searchIndex.unavailableMessage(),
    };
  }
}

/**
 * Mirrors EditorScreen._save() / docs/architecture/note-lifecycle.md: parse
 * whatever frontmatter the user is currently typing and reconcile it back
 * into the Note row, without ever crashing on a mid-edit YAML block.
 */
export async function saveNoteContent(noteId: number, content: string): Promise<Note> {
  const [fm, body] = frontmatter.parse(content);

  if (fm === null) {
    notesRepo.updateNoteContent(noteId, content);
  } else {
    const previous = notesRepo.getNote(noteId);
    if (!previous) throw new Error(`Note ${noteId} not found`);

    const reconciled: frontmatter.Frontmatter = {
      title: fm.title || previous.title,
      description: fm.description,
      tags: fm.tags,
      createdAt: fm.createdAt || previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const rendered = frontmatter.render(reconciled, body);
    notesRepo.updateNote(noteId, rendered, {
      title: reconciled.title,
      tags: frontmatter.tagsToString(reconciled.tags),
      description: reconciled.description,
    });
  }

  const note = notesRepo.getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  await bestEffortIndex(() => searchIndex.indexNote(note));
  return note;
}

/**
 * Stores a pasted image under the current application data directory, named
 * after the note it was pasted into. A bad image comes back as `error` so the
 * editor can say why instead of failing the action.
 */
export async function saveImage({ noteId, fileName, data }: SaveImageInput): Promise<SaveImageResult> {
  const note = notesRepo.getNote(noteId);
  if (!note) return { error: "That note no longer exists." };
  return images.storeImage(loadWebSettings().appDataDir, { noteTitle: note.title, fileName, data });
}

/**
 * Not part of CompositionApi: the web app's `/app_data/<name>` route and the
 * desktop app's `app://` handler both serve images through this, following the
 * application data directory as it is configured right now.
 */
export async function readImage(name: string): Promise<images.StoredImage | null> {
  return images.readImage(loadWebSettings().appDataDir, name);
}

export async function createNote(
  title: string,
  groupId: number | null = null,
): Promise<Note> {
  const note = notesRepo.createNote(title, "", groupId);
  await bestEffortIndex(() => searchIndex.indexNote(note));
  return note;
}

export async function deleteNote(id: number): Promise<void> {
  notesRepo.deleteNote(id);
  await bestEffortIndex(() => searchIndex.deleteNoteFromIndex(id));
}

export async function createGroup(
  name: string,
  parentId: number | null,
): Promise<Group> {
  return groupsRepo.createGroup(name, parentId);
}

export async function renameGroup(id: number, name: string): Promise<Group> {
  groupsRepo.renameGroup(id, name);
  const group = groupsRepo.getGroup(id);
  if (!group) throw new Error(`Group ${id} not found`);
  return group;
}

/**
 * Returns an error message instead of throwing on GroupNotEmptyError, so a
 * race (another window added a note to this group mid-delete) surfaces as
 * inline feedback rather than a crashed action.
 */
export async function deleteGroup(id: number): Promise<{ error?: string }> {
  try {
    groupsRepo.deleteGroup(id);
  } catch (error) {
    if (error instanceof GroupNotEmptyError) {
      return { error: "This group still has sub-groups or notes — empty it first." };
    }
    throw error;
  }
  return {};
}

/**
 * Returns an error message instead of throwing on an invalid move (into itself
 * or a descendant, or a group another window deleted), so the UI can roll back
 * its optimistic update with inline feedback.
 */
export async function moveGroup(
  id: number,
  parentId: number | null,
): Promise<MoveGroupResult> {
  try {
    groupsRepo.moveGroup(id, parentId);
  } catch (error) {
    if (error instanceof InvalidGroupMoveError) {
      return { error: "That group can't be moved there." };
    }
    throw error;
  }
  const group = groupsRepo.getGroup(id);
  if (!group) throw new Error(`Group ${id} not found`);
  return { group };
}

export async function moveNoteToGroup(
  noteId: number,
  groupId: number | null,
): Promise<Note> {
  notesRepo.setNoteGroup(noteId, groupId);
  const note = notesRepo.getNote(noteId);
  if (!note) throw new Error(`Note ${noteId} not found`);
  return note;
}

/**
 * Persists the dragged column sizes. Re-clamped here rather than trusting the
 * client; merged into the stored settings so theme and data location survive.
 */
export async function saveLayout(layout: Layout): Promise<void> {
  saveWebSettings({
    ...loadWebSettings(),
    sidebarWidth: clampSidebarWidth(layout.sidebarWidth),
    editorRatio: clampEditorRatio(layout.editorRatio),
  });
}

/** Re-validated here rather than trusting the client; merged so the other settings survive. */
export async function saveFavorites(favorites: Favorites): Promise<void> {
  saveWebSettings({ ...loadWebSettings(), favorites: parseFavorites(favorites) });
}

export async function saveSettings(input: SaveSettingsInput): Promise<SaveSettingsResult> {
  const rawAppDataDir = input.appDataDir.trim();
  const rawDbPath = input.dbPath.trim();

  if (rawAppDataDir === "") {
    return { error: "Application data directory is required." };
  }

  const appDataDir = expandHome(rawAppDataDir);
  const dbPath = rawDbPath === "" ? undefined : expandHome(rawDbPath);

  try {
    fs.mkdirSync(appDataDir, { recursive: true });
    if (dbPath) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not create or write to that location: ${message}` };
  }

  // Spread the stored settings so fields this form doesn't edit (theme, layout)
  // survive; an undefined dbPath is dropped when the file is serialized.
  const settings: WebSettings = { ...loadWebSettings(), appDataDir, dbPath };
  saveWebSettings(settings);
  closeDb();

  return {
    success: true,
    appDataDir,
    dbPath: resolvedDbPath(settings),
  };
}

export async function saveTheme(theme: string): Promise<{ error?: string }> {
  if (!isThemeName(theme)) {
    return { error: "Unknown color scheme." };
  }
  // Replace only the theme so an unsaved data-location edit isn't persisted.
  saveWebSettings({ ...loadWebSettings(), theme });
  return {};
}

export async function saveLocation(city: string): Promise<SaveLocationResult> {
  const query = city.trim();

  if (query === "") {
    // Forgetting the city leaves "auto" running on stand-in times.
    const settings = loadWebSettings();
    delete settings.location;
    saveWebSettings(settings);
    return {};
  }

  let location;
  try {
    location = await geocodeCity(query);
  } catch {
    return { error: "Couldn't reach the city lookup service. Check your connection and try again." };
  }
  if (!location) {
    return {
      error: `Couldn't find a city matching "${query}". Try "City, State" or "City, Country".`,
    };
  }

  saveWebSettings({ ...loadWebSettings(), location });
  const times = todaysSunTimes(await loadSunEvents(location), location.timezone);
  return { saved: { name: location.name, ...times } };
}

export async function loadSunSchedule(): Promise<SunSchedule | null> {
  const { theme, location } = loadWebSettings();
  return theme === "auto" ? resolveSunSchedule(location) : null;
}

/**
 * For the very first paint, which can't wait on the network: the "auto" scheme's
 * attributes from whatever sun times are already cached, else stand-in times.
 * Undefined when another scheme is selected.
 */
export function initialSunTheme(): { tone: "light" | "dark"; autoLight: string } | undefined {
  const { theme, location } = loadWebSettings();
  return theme === "auto" ? sunThemeAttributes(cachedSunSchedule(location).level) : undefined;
}

// Compile-time proof that this module implements the whole contract.
const _implementsApi: CompositionApi = {
  loadWorkspace,
  loadSettings,
  searchNotes,
  createNote,
  saveNoteContent,
  saveImage,
  deleteNote,
  moveNoteToGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  moveGroup,
  saveLayout,
  saveFavorites,
  saveSettings,
  saveTheme,
  saveLocation,
  loadSunSchedule,
};
void _implementsApi;
