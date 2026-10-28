import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAssistantSettings, type AssistantSettings } from "./assistant/settings";
import { NO_FAVORITES, parseFavorites, type Favorites } from "./favorites";
import { DEFAULT_HOME_SETTINGS, parseHomeSettings, type HomeSettings } from "./home";
import { clampCliSidebarColumns, clampEditorRatio, clampSidebarWidth, DEFAULT_LAYOUT } from "./layout";
import { DEFAULT_APP_DATA_DIR, defaultDatabasePath } from "./paths";
import { DEFAULT_EDITOR_FONT, isEditorFontName, type EditorFontName } from "./editorFonts";
import { DEFAULT_NOTE_BACKGROUND, isNoteBackgroundName, type NoteBackgroundName } from "./noteBackgrounds";
import { DEFAULT_PREVIEW_FONT, isPreviewFontName, type PreviewFontName } from "./previewFonts";
import type { SavedLocation } from "./sunTimes";
import { DEFAULT_WRITING_SETTINGS, parseWritingSettings, type WritingSettings } from "./writing";
import { DEFAULT_THEME, isThemeName, type ThemeName } from "./themes";

/**
 * Fixed, well-known location for the web app's own settings, deliberately
 * outside `appDataDir` so it survives a relocation of the very setting it
 * stores, and deliberately a different file from the CLI's own
 * `~/.composition/settings.yaml` (the apps keep independent settings).
 */
const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".composition-web", "settings.json");

/**
 * `COMPOSITION_SETTINGS_PATH` lets another host of this code (the desktop app,
 * which keeps its settings under Electron's per-app data folder) own its
 * settings file. Read on every call so it can be set after import.
 */
export function settingsPath(): string {
  return process.env.COMPOSITION_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
}

/**
 * Where the desktop and terminal apps, which share one database, agree on where it is.
 * Their settings files are separate (color scheme, columns and favorites stay per app), so
 * the data location alone is also written here whenever either app changes it, and read from
 * here ahead of the app's own setting. It sits beside neither app's settings and outside
 * `appDataDir`, so a relocation cannot strand it.
 */
export function defaultSharedLocationPath(home: string): string {
  return path.join(home, ".composition-location.json");
}

/**
 * Opt-in, like `COMPOSITION_SETTINGS_PATH`: only a host that sets
 * `COMPOSITION_SHARED_LOCATION_PATH` takes part. The web app does not, so it keeps
 * answering to its own settings alone. Read on every call so it can be set after import.
 */
export function sharedLocationPath(): string | undefined {
  return process.env.COMPOSITION_SHARED_LOCATION_PATH || undefined;
}

type DataLocation = Pick<WebSettings, "appDataDir" | "dbPath">;

export type WebSettings = {
  appDataDir: string;
  dbPath?: string;
  theme: ThemeName;
  /** Font of a note's preview. */
  previewFont: PreviewFontName;
  /** Font of the Markdown editor. */
  editorFont: EditorFontName;
  /** Pattern drawn behind the window. */
  noteBackground: NoteBackgroundName;
  /** The editor's ruler and reflow. */
  writing: WritingSettings;
  /** The home page's layout. */
  home: HomeSettings;
  /** City whose sunrise and sunset drive the "auto" color scheme. */
  location?: SavedLocation;
  sidebarWidth: number;
  editorRatio: number;
  /** The terminal app's sidebar width in columns; absent until the CLI saves one (see layout.ts). */
  cliSidebarColumns?: number;
  /** Pinned groups and notes, in pin order. */
  favorites: Favorites;
  /** The AI helper's Ollama server and context size; absent until they are first saved. */
  assistant?: AssistantSettings;
  /**
   * How the desktop app's panels were arranged when it last ran, as the renderer saved it (its own versioned document,
   * which only the renderer reads: see components/panels/panelsDocument.ts). Absent until first saved.
   */
  panels?: Record<string, unknown>;
};

const DEFAULT_SETTINGS: WebSettings = {
  appDataDir: DEFAULT_APP_DATA_DIR,
  theme: DEFAULT_THEME,
  previewFont: DEFAULT_PREVIEW_FONT,
  editorFont: DEFAULT_EDITOR_FONT,
  noteBackground: DEFAULT_NOTE_BACKGROUND,
  writing: DEFAULT_WRITING_SETTINGS,
  home: DEFAULT_HOME_SETTINGS,
  ...DEFAULT_LAYOUT,
  favorites: NO_FAVORITES,
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocation(value: unknown): SavedLocation | undefined {
  const data = value as Partial<Record<keyof SavedLocation, unknown>> | null;
  if (
    typeof data?.name !== "string" ||
    data.name === "" ||
    typeof data.timezone !== "string" ||
    data.timezone === "" ||
    typeof data.latitude !== "number" ||
    !(Math.abs(data.latitude) <= 90) ||
    typeof data.longitude !== "number" ||
    !(Math.abs(data.longitude) <= 180)
  ) {
    return undefined;
  }
  return {
    name: data.name,
    latitude: data.latitude,
    longitude: data.longitude,
    timezone: data.timezone,
  };
}

/** Reads settings from already-parsed JSON, falling back to the default for anything missing or invalid. */
export function parseWebSettings(data: unknown): WebSettings {
  const value = (data ?? {}) as Record<string, unknown>;
  const hasAppDataDir = typeof value.appDataDir === "string" && value.appDataDir !== "";
  const settings: WebSettings = {
    appDataDir: hasAppDataDir ? (value.appDataDir as string) : DEFAULT_APP_DATA_DIR,
    theme: isThemeName(value.theme) ? value.theme : DEFAULT_THEME,
    previewFont: isPreviewFontName(value.previewFont) ? value.previewFont : DEFAULT_PREVIEW_FONT,
    editorFont: isEditorFontName(value.editorFont) ? value.editorFont : DEFAULT_EDITOR_FONT,
    noteBackground: isNoteBackgroundName(value.noteBackground) ? value.noteBackground : DEFAULT_NOTE_BACKGROUND,
    writing: parseWritingSettings(value.writing),
    home: parseHomeSettings(value.home),
    sidebarWidth: clampSidebarWidth(value.sidebarWidth),
    editorRatio: clampEditorRatio(value.editorRatio),
    favorites: parseFavorites(value.favorites),
  };
  if (typeof value.dbPath === "string" && value.dbPath !== "") {
    settings.dbPath = value.dbPath;
  }
  if (value.cliSidebarColumns !== undefined) {
    settings.cliSidebarColumns = clampCliSidebarColumns(value.cliSidebarColumns);
  }
  const location = parseLocation(value.location);
  if (location) settings.location = location;
  if (value.assistant !== undefined) settings.assistant = parseAssistantSettings(value.assistant);
  if (isPlainObject(value.panels)) settings.panels = value.panels;
  return settings;
}

/** The agreed data location, or undefined when sharing is off or nothing has been agreed yet. */
function readSharedLocation(): DataLocation | undefined {
  const file = sharedLocationPath();
  if (!file) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    if (typeof value.appDataDir !== "string" || value.appDataDir === "") return undefined;
    const dbPath = typeof value.dbPath === "string" && value.dbPath !== "" ? value.dbPath : undefined;
    return { appDataDir: value.appDataDir, dbPath };
  } catch {
    return undefined;
  }
}

function readOwnSettings(): WebSettings {
  try {
    return parseWebSettings(JSON.parse(fs.readFileSync(settingsPath(), "utf-8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadWebSettings(): WebSettings {
  const settings = readOwnSettings();
  const shared = readSharedLocation();
  if (!shared) return settings;
  // The agreed location carries its own `dbPath` (or none), so this app's stale override
  // must not survive it. Destructuring also copies the shared fallback object.
  const { dbPath: _ownDbPath, ...rest } = settings;
  return shared.dbPath ? { ...rest, ...shared } : { ...rest, appDataDir: shared.appDataDir };
}

/** Whether two settings point at the same data, ignoring how the path is spelled. */
function sameLocation(a: DataLocation, b: DataLocation): boolean {
  const resolve = (value: string | undefined) => (value ? path.resolve(value) : "");
  return resolve(a.appDataDir) === resolve(b.appDataDir) && resolve(a.dbPath) === resolve(b.dbPath);
}

/** Atomically replaces `file` with `contents` (`undefined`: removes it). */
function writeFileAtomically(file: string, contents: string | undefined): void {
  if (contents === undefined) {
    fs.rmSync(file, { force: true });
    return;
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = path.join(dir, `.${path.basename(file)}.tmp`);
  fs.writeFileSync(temporaryPath, contents);
  fs.renameSync(temporaryPath, file);
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

export function saveWebSettings(settings: WebSettings): void {
  const shared = sharedLocationPath();
  // Only a change of location is announced to the other app. Saving the color scheme or a
  // favorite must not make this app's location the agreed one for a user whose two apps
  // have not been told to agree yet.
  const announce = shared !== undefined && !sameLocation(settings, loadWebSettings());
  const sharedBefore = shared && announce ? readIfExists(shared) : undefined;
  if (shared && announce) {
    const { appDataDir, dbPath } = settings;
    writeFileAtomically(shared, JSON.stringify({ appDataDir, ...(dbPath && { dbPath }) }, null, 2));
  }
  try {
    writeFileAtomically(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (error) {
    // Don't leave the other app agreeing to a location this app failed to record.
    if (shared && announce) writeFileAtomically(shared, sharedBefore);
    throw error;
  }
}

export function resolvedDbPath(settings: WebSettings): string {
  return settings.dbPath || defaultDatabasePath(settings.appDataDir);
}
