import fs from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_DIR_NAME,
  expandHome,
  IMAGE_DIR_NAME,
  resolvedDbPath,
  saveWebSettings,
  type WebSettings,
} from "./backend";

/**
 * Moving the application data to another folder, from Settings.
 *
 * Web and desktop only repoint to a new folder; the CLI has always moved the files
 * for you, so it still does (with a rollback if anything fails halfway). Beyond the
 * database and the search index the Python CLI moved, this also carries the folders
 * web and desktop keep beside the database: the pasted images (notes link to them) and the
 * attachments. Leaving those behind would break every image in every note. Their names come
 * from the web app's own constants, so they cannot drift.
 *
 * The caller closes the database and stops Meilisearch first, and reopens them after.
 */

export class ApplicationDataMoveError extends Error {}

const DATABASE_NAME = "composition.db";
/** SQLite's side files; present only while a connection is open or after a crash. */
const DATABASE_SUFFIXES = ["", "-wal", "-shm", "-journal"];
/** Everything else the app keeps in its data directory. */
const OTHER_ENTRIES = ["meili_data", "meili.log", "meili_master_key", ATTACHMENT_DIR_NAME, IMAGE_DIR_NAME];

type MoveDeps = {
  /** Persists the new settings; replaced in tests. */
  saveSettings?: (settings: WebSettings) => void;
};

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

function isWithin(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** A rename, falling back to copy-then-delete when the destination is another disk. */
function moveEntry(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function removeIfEmpty(directory: string): void {
  try {
    fs.rmdirSync(directory);
  } catch {
    // not empty, or already gone: leave it
  }
}

export function moveApplicationData(
  settings: WebSettings,
  destinationInput: string,
  { saveSettings = saveWebSettings }: MoveDeps = {},
): WebSettings {
  const sourceRoot = path.resolve(expandHome(settings.appDataDir));
  const destination = path.resolve(expandHome(destinationInput));
  if (samePath(destination, sourceRoot)) return settings;
  if (isWithin(destination, sourceRoot)) {
    throw new ApplicationDataMoveError(
      "The new application data location cannot be inside the current one.",
    );
  }
  if (exists(destination) && !fs.statSync(destination).isDirectory()) {
    throw new ApplicationDataMoveError(`Application data location is not a directory: ${destination}`);
  }

  // The database may sit outside the data directory (a `dbPath` override); it moves in.
  const sourceDatabase = resolvedDbPath(settings);
  const candidates: [string, string][] = [
    ...DATABASE_SUFFIXES.map((suffix): [string, string] => [
      sourceDatabase + suffix,
      path.join(destination, DATABASE_NAME + suffix),
    ]),
    ...OTHER_ENTRIES.map((name): [string, string] => [
      path.join(sourceRoot, name),
      path.join(destination, name),
    ]),
  ];
  const moves = candidates.filter(([source, target]) => exists(source) && !samePath(source, target));

  const conflicts = moves.map(([, target]) => target).filter(exists);
  if (conflicts.length > 0) {
    throw new ApplicationDataMoveError(
      `The new location already contains Composition data: ${conflicts.join(", ")}`,
    );
  }

  const newSettings: WebSettings = { ...settings, appDataDir: destination, dbPath: undefined };
  const destinationWasCreated = !exists(destination);
  fs.mkdirSync(destination, { recursive: true });

  const completed: [string, string][] = [];
  try {
    for (const [source, target] of moves) {
      moveEntry(source, target);
      completed.push([source, target]);
    }
    saveSettings(newSettings);
  } catch (error) {
    for (const [source, target] of completed.reverse()) {
      if (!exists(target)) continue;
      fs.mkdirSync(path.dirname(source), { recursive: true });
      moveEntry(target, source);
    }
    if (destinationWasCreated) removeIfEmpty(destination);
    if (error instanceof ApplicationDataMoveError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApplicationDataMoveError(`Could not move application data: ${message}`, { cause: error });
  }

  for (const directory of new Set([path.dirname(sourceDatabase), sourceRoot])) {
    removeIfEmpty(directory);
  }
  return newSettings;
}
