import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { expandHome, themes } from "./backend";

/**
 * One-time import of the Python CLI's `~/.composition/settings.yaml` into the new
 * settings file (`~/.composition-cli/settings.json`, web's settings model).
 *
 * Only the data location and the color scheme existed back then. The old file is left
 * alone and never read again once the new one exists, so this can run on every start.
 * Nothing here ever throws: a settings file that can't be read is simply not imported.
 */

/** The Python CLI named its schemes after Textual themes. */
const LEGACY_THEMES: Record<string, string> = {
  "textual-dark": "dark",
  "composition-light": "light",
  "composition-forest": "forest",
};

const DATABASE_NAME = "composition.db";

function mapTheme(value: unknown): string {
  if (typeof value !== "string") return "dark";
  if (value in LEGACY_THEMES) return LEGACY_THEMES[value];
  return themes.isThemeName(value) ? value : "dark";
}

function readLegacy(file: string): Record<string, unknown> | null {
  try {
    const data = yaml.load(fs.readFileSync(file, "utf-8"));
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Returns whether anything was imported. */
export function importLegacySettings({ target, legacy }: { target: string; legacy: string }): boolean {
  if (fs.existsSync(target)) return false;
  const old = readLegacy(legacy);
  if (!old) return false;

  const imported: Record<string, unknown> = {};
  if (typeof old.app_data_dir === "string" && old.app_data_dir !== "") {
    imported.appDataDir = path.resolve(expandHome(old.app_data_dir));
  } else if (typeof old.db_path === "string" && old.db_path !== "") {
    // Settings from before application data shared one directory: the data sat beside the database.
    const database = path.resolve(expandHome(old.db_path));
    imported.appDataDir = path.dirname(database);
    if (path.basename(database) !== DATABASE_NAME) imported.dbPath = database;
  }
  if (!("appDataDir" in imported) && !("theme" in old)) return false;
  imported.theme = mapTheme(old.theme);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(imported, null, 2));
  fs.renameSync(temporary, target);
  return true;
}
