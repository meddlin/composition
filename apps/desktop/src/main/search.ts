import fs from "node:fs";
import path from "node:path";
import type { listNotes as ListNotes, searchIndex as SearchIndex } from "./backend";
import { MeiliProcessManager } from "./meili";

/**
 * Where the Meilisearch binary comes from, in order:
 *   1. COMPOSITION_MEILI_BIN, if set (tests, and anyone who wants their own build);
 *   2. packaged app: the copy bundled under Resources/meilisearch;
 *   3. development: `meilisearch` on PATH (e.g. `brew install meilisearch`).
 */
export function resolveMeiliBinary(options: {
  env: NodeJS.ProcessEnv;
  packaged: boolean;
  resourcesPath: string;
  platform: NodeJS.Platform;
  isExecutable: (file: string) => boolean;
}): string | null {
  const { env, packaged, resourcesPath, platform, isExecutable } = options;
  const name = platform === "win32" ? "meilisearch.exe" : "meilisearch";

  if (env.COMPOSITION_MEILI_BIN) {
    return isExecutable(env.COMPOSITION_MEILI_BIN) ? env.COMPOSITION_MEILI_BIN : null;
  }
  if (packaged) {
    const bundled = path.join(resourcesPath, "meilisearch", name);
    return isExecutable(bundled) ? bundled : null;
  }
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Owns the app's Meilisearch: starts it, points the shared search code at it,
 * keeps its index in step with SQLite, and stops it on quit.
 *
 * Search is derived data (docs/architecture/search.md): every failure here
 * degrades to a clear "search is unavailable" message in the UI and never
 * prevents the notes themselves from working.
 */
export class SearchSidecar {
  private manager: MeiliProcessManager | null = null;

  constructor(
    private readonly deps: {
      binary: string | null;
      dir: string;
      searchIndex: typeof SearchIndex;
      listNotes: typeof ListNotes;
      log: (message: string, detail?: unknown) => void;
    },
  ) {}

  /** Never rejects. Returns once search is either ready or marked unavailable. */
  async start(): Promise<void> {
    const { binary, dir, searchIndex, log } = this.deps;
    // Until the server is up, say so rather than letting a query reach
    // whatever happens to be listening on the default port.
    searchIndex.disableSearch("Search is starting…");

    if (!binary) {
      searchIndex.disableSearch(
        "Search is unavailable: the Meilisearch binary wasn't found. Reinstall Composition, or set COMPOSITION_MEILI_BIN.",
      );
      log("[search] no Meilisearch binary found");
      return;
    }

    const manager = new MeiliProcessManager({
      binary,
      dataDir: path.join(dir, "meili_data"),
      logPath: path.join(dir, "meili.log"),
      keyPath: path.join(dir, "meili_master_key"),
      pidPath: path.join(dir, "meili.pid"),
      onUnexpectedExit: ({ code, signal }) => {
        log("[search] Meilisearch exited unexpectedly", { code, signal });
        searchIndex.disableSearch(
          "Search stopped unexpectedly. Restart Composition to bring it back.",
        );
      },
    });

    try {
      const { url, masterKey } = await manager.start();
      this.manager = manager;
      searchIndex.configureSearch({ host: url, apiKey: masterKey });
      log("[search] Meilisearch ready", url);
      void this.reindex();
    } catch (error) {
      log("[search] failed to start", error);
      searchIndex.disableSearch(
        `Search is unavailable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
  }

  /**
   * Rebuilds the index from SQLite. Needed at start (this app's index is its
   * own, so it misses edits made in the CLI while the app was closed) and after
   * the data location changes.
   */
  async reindex(): Promise<void> {
    if (!this.manager?.running) return;
    try {
      await this.deps.searchIndex.reindexAll(this.deps.listNotes());
    } catch (error) {
      this.deps.log("[search] reindex failed", error);
    }
  }

  async stop(): Promise<void> {
    await this.manager?.stop();
    this.manager = null;
  }
}
