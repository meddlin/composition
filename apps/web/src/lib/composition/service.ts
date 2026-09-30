import fs from "node:fs";
import path from "node:path";
import type {
  CompositionApi,
  SaveSettingsInput,
  SaveSettingsResult,
  SearchHit,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "./api";
import { closeDb } from "./db";
import * as frontmatter from "./frontmatter";
import * as groupsRepo from "./groupsRepo";
import { GroupNotEmptyError } from "./groupsRepo";
import type { Group } from "./groupsRepo";
import { clampEditorRatio, clampSidebarWidth, type Layout } from "./layout";
import * as notesRepo from "./notesRepo";
import type { Note } from "./notesRepo";
import { defaultDatabasePath, expandHome } from "./paths";
import * as searchIndex from "./searchIndex";
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
  const { sidebarWidth, editorRatio } = loadWebSettings();
  return {
    notes: notesRepo.listNotes(),
    groups: groupsRepo.listGroups(),
    layout: { sidebarWidth, editorRatio },
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
  return {
    theme: settings.theme,
    appDataDir: settings.appDataDir,
    dbPath,
    dbPathOverride: settings.dbPath ?? "",
    derivedDbPath: defaultDatabasePath(settings.appDataDir),
    dirWritable: isWritableDir(settings.appDataDir),
    dbExists: fs.existsSync(dbPath),
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

// Compile-time proof that this module implements the whole contract.
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
  saveLayout,
  saveSettings,
  saveTheme,
};
void _implementsApi;
