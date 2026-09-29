import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_APP_DATA_DIR, defaultDatabasePath } from "./paths";

/**
 * Fixed, well-known location for the web app's own settings, deliberately
 * outside `appDataDir` so it survives a relocation of the very setting it
 * stores, and deliberately a different file from the CLI's own
 * `~/.composition/settings.yaml` (the two apps keep independent settings).
 */
export const WEB_SETTINGS_PATH = path.join(
  os.homedir(),
  ".composition-web",
  "settings.json",
);

export type WebSettings = {
  appDataDir: string;
  dbPath?: string;
};

const DEFAULT_SETTINGS: WebSettings = { appDataDir: DEFAULT_APP_DATA_DIR };

export function loadWebSettings(): WebSettings {
  try {
    const raw = fs.readFileSync(WEB_SETTINGS_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data?.appDataDir !== "string" || data.appDataDir === "") {
      return DEFAULT_SETTINGS;
    }
    const settings: WebSettings = { appDataDir: data.appDataDir };
    if (typeof data.dbPath === "string" && data.dbPath !== "") {
      settings.dbPath = data.dbPath;
    }
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveWebSettings(settings: WebSettings): void {
  const dir = path.dirname(WEB_SETTINGS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryPath = path.join(dir, `.${path.basename(WEB_SETTINGS_PATH)}.tmp`);
  fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2));
  fs.renameSync(temporaryPath, WEB_SETTINGS_PATH);
}

export function resolvedDbPath(settings: WebSettings): string {
  return settings.dbPath || defaultDatabasePath(settings.appDataDir);
}
