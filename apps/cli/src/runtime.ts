import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDb,
  isExecutableFile,
  listNotes,
  loadWebSettings,
  resolveMeiliBinary,
  searchIndex,
  SearchSidecar,
} from "./backend";
import { moveApplicationData } from "./dataLocation";
import { importLegacySettings } from "./legacySettings";

/**
 * Everything the terminal app starts before it draws, and stops when it quits: the
 * settings file, the shared database, and this app's own Meilisearch.
 *
 * Search is derived data (docs/architecture/search.md), so a missing or crashed
 * Meilisearch never stops the app: notes keep working and a search says why it can't.
 * (The Python CLI refused to start without Meilisearch.)
 */

export type Runtime = {
  /**
   * Moves every piece of application data to `destination` and reopens it there.
   * Throws ApplicationDataMoveError if it can't, after putting everything back.
   */
  moveDataLocation(destination: string): Promise<void>;
  stop(): Promise<void>;
};

export type RuntimeOptions = {
  /** Where `~` is; only tests change this. */
  home?: string;
};

/** The CLI's own settings, apart from web's and desktop's. */
export function defaultSettingsPath(home: string): string {
  return path.join(home, ".composition-cli", "settings.json");
}

/** Where the Python CLI kept its settings; read once, to import them. */
function legacySettingsPath(home: string): string {
  return path.join(home, ".composition", "settings.yaml");
}

function makeLogger(file: string) {
  return (message: string, detail?: unknown) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const text = detail === undefined ? "" : ` ${detail instanceof Error ? detail.stack : String(detail)}`;
      fs.appendFileSync(file, `${new Date().toISOString()} ${message}${text}\n`);
    } catch {
      // a log that can't be written must never take the app down
    }
  };
}

export async function startRuntime({ home = os.homedir() }: RuntimeOptions = {}): Promise<Runtime> {
  // The shared data layer reads this on every call, so it can be set after import.
  const settingsFile = (process.env.COMPOSITION_SETTINGS_PATH ??= defaultSettingsPath(home));
  importLegacySettings({ target: settingsFile, legacy: legacySettingsPath(home) });
  const log = makeLogger(path.join(path.dirname(settingsFile), "cli.log"));

  const binary = resolveMeiliBinary({
    env: process.env,
    packaged: false,
    resourcesPath: "",
    platform: process.platform,
    isExecutable: isExecutableFile,
  });

  let sidecar: SearchSidecar | null = null;
  const startSearch = async (dir: string) => {
    sidecar = new SearchSidecar({ binary, dir, searchIndex, listNotes, log });
    await sidecar.start();
  };
  const stopSearch = async () => {
    await sidecar?.stop();
    sidecar = null;
  };

  await startSearch(loadWebSettings().appDataDir);

  return {
    async moveDataLocation(destination) {
      const before = loadWebSettings();
      // Nothing may hold a file open while it moves.
      await stopSearch();
      closeDb();
      try {
        const after = moveApplicationData(before, destination);
        await startSearch(after.appDataDir);
      } catch (error) {
        await startSearch(before.appDataDir);
        throw error;
      }
    },
    async stop() {
      await stopSearch();
      closeDb();
    },
  };
}
