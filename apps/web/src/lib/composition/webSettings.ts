import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NO_FAVORITES, parseFavorites, type Favorites } from "./favorites";
import { clampEditorRatio, clampSidebarWidth, DEFAULT_LAYOUT } from "./layout";
import { DEFAULT_APP_DATA_DIR, defaultDatabasePath } from "./paths";
import type { SavedLocation } from "./sunTimes";
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

export type WebSettings = {
  appDataDir: string;
  dbPath?: string;
  theme: ThemeName;
  /** City whose sunrise and sunset drive the "auto" color scheme. */
  location?: SavedLocation;
  sidebarWidth: number;
  editorRatio: number;
  /** Pinned groups and notes, in pin order. */
  favorites: Favorites;
};

const DEFAULT_SETTINGS: WebSettings = {
  appDataDir: DEFAULT_APP_DATA_DIR,
  theme: DEFAULT_THEME,
  ...DEFAULT_LAYOUT,
  favorites: NO_FAVORITES,
};

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
    sidebarWidth: clampSidebarWidth(value.sidebarWidth),
    editorRatio: clampEditorRatio(value.editorRatio),
    favorites: parseFavorites(value.favorites),
  };
  if (typeof value.dbPath === "string" && value.dbPath !== "") {
    settings.dbPath = value.dbPath;
  }
  const location = parseLocation(value.location);
  if (location) settings.location = location;
  return settings;
}

export function loadWebSettings(): WebSettings {
  try {
    return parseWebSettings(JSON.parse(fs.readFileSync(settingsPath(), "utf-8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveWebSettings(settings: WebSettings): void {
  const file = settingsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = path.join(dir, `.${path.basename(file)}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2));
  fs.renameSync(temporaryPath, file);
}

export function resolvedDbPath(settings: WebSettings): string {
  return settings.dbPath || defaultDatabasePath(settings.appDataDir);
}
