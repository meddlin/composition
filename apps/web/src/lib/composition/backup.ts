import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { ATTACHMENT_DIR_NAME } from "./attachmentNames";
import type { BackupCounts } from "./backupApi";
import { IMAGE_DIR_NAME, isImageName } from "./imageRefs";
import { ArchiveError, readArchive, writeArchive, type ArchiveSource } from "./tarArchive";
import { parseWebSettings, type WebSettings } from "./webSettings";

/**
 * Backing up and restoring everything Composition keeps: the notes database
 * (notes, groups, the Trash Can, attachment records), the pasted images, the
 * attached files, and the settings that belong to the user rather than to this
 * machine. Framework-free, like the rest of the service layer.
 *
 * A backup is one `.tar.gz`, readable by any `tar`:
 *
 *   composition-backup.json   what this is, which format version, when, counts
 *   settings.json             color scheme, city, column sizes, favorites
 *   composition.db            a consistent snapshot of the database (VACUUM INTO)
 *   app_data/<image>          every pasted image
 *   attachments/<file>        every attached file
 *
 * Deliberately not in it: the search index (derived, rebuilt after a restore),
 * and the data location (`appDataDir`, `dbPath`). Those say where *this*
 * machine keeps its files; restoring a backup made elsewhere must not repoint
 * the app.
 *
 * Restoring is two steps so that nothing is touched until the file is known to
 * be good: `stageBackup` unpacks and checks it in a scratch folder, and
 * `applyStagedBackup` swaps it in, with a rollback if anything fails halfway.
 */

export const BACKUP_FORMAT = "composition-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = ".tar.gz";

const MANIFEST_NAME = "composition-backup.json";
const SETTINGS_NAME = "settings.json";
const DATABASE_NAME = "composition.db";
/** SQLite's side files; present only while a connection is open, or after a crash. */
const DATABASE_SUFFIXES = ["-wal", "-shm", "-journal"];
/** A stored file's name is one path segment; this is the strictest shape the app ever generates, relaxed for extensions. */
const STORED_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Manifest and settings are small; anything bigger is not one. */
const MAX_JSON_BYTES = 1024 * 1024;

export type Manifest = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  counts: BackupCounts;
};

export type BackupSummary = { file: string; bytes: number; createdAt: string; counts: BackupCounts };

/** Where backups go unless the user says otherwise (the CLI and web app offer this as the default). */
export function defaultBackupDir(): string {
  return path.join(os.homedir(), "Composition Backups");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `composition-backup-2026-10-02-153045.tar.gz`, in local time so it sorts as the user would expect. */
export function backupFileName(now: Date = new Date(), kind: "backup" | "pre-restore" = "backup"): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `composition-${kind}-${stamp}${BACKUP_EXTENSION}`;
}

// --- reading what is in a database -----------------------------------------

const COUNTED_TABLES = {
  notes: "notes",
  groups: "groups",
  trashedNotes: "trashed_notes",
  trashedGroups: "trashed_groups",
  attachments: "attachments",
} as const;

/** Row counts of a database file, opened read-only. A table an older version never created counts as 0. */
function countRows(databaseFile: string): Pick<BackupCounts, keyof typeof COUNTED_TABLES> {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const count = (table: string): number => {
      try {
        return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      } catch {
        return 0;
      }
    };
    return {
      notes: count(COUNTED_TABLES.notes),
      groups: count(COUNTED_TABLES.groups),
      trashedNotes: count(COUNTED_TABLES.trashedNotes),
      trashedGroups: count(COUNTED_TABLES.trashedGroups),
      attachments: count(COUNTED_TABLES.attachments),
    };
  } finally {
    db.close();
  }
}

/** Throws unless `databaseFile` is an intact SQLite database with a notes table. */
function assertUsableDatabase(databaseFile: string): void {
  let db: Database.Database;
  try {
    db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  } catch {
    throw new ArchiveError("The database inside this backup can't be opened, so nothing was restored.");
  }
  try {
    const check = db.pragma("quick_check", { simple: true });
    const hasNotes = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'").get();
    if (check !== "ok" || !hasNotes) {
      throw new ArchiveError("The database inside this backup is damaged or isn't a Composition database, so nothing was restored.");
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("The database inside this backup is damaged, so nothing was restored.");
  } finally {
    db.close();
  }
}

// --- creating ---------------------------------------------------------------

/** The regular, non-hidden files of a folder; a missing folder has none. */
function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The settings a backup carries: everything but the two that say where this machine keeps its files. */
function portableSettings(settings: WebSettings): Omit<WebSettings, "appDataDir" | "dbPath"> {
  const { appDataDir: _appDataDir, dbPath: _dbPath, ...portable } = settings;
  void _appDataDir;
  void _dbPath;
  return portable;
}

/**
 * Writes the backup to `file`. `db` is the live connection: the snapshot is
 * taken with `VACUUM INTO`, which is consistent even while the app is writing
 * (a plain file copy of a WAL-mode database is not).
 */
export async function createBackup(options: {
  file: string;
  db: Database.Database;
  appDataDir: string;
  settings: WebSettings;
  now?: Date;
}): Promise<BackupSummary> {
  const { file, db, appDataDir, settings, now = new Date() } = options;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const scratch = await fs.promises.mkdtemp(path.join(path.dirname(file), ".composition-backup-"));
  try {
    const snapshot = path.join(scratch, DATABASE_NAME);
    db.prepare("VACUUM INTO ?").run(snapshot);
    const counts = countRows(snapshot);

    const images = listFiles(path.join(appDataDir, IMAGE_DIR_NAME)).filter(isImageName);
    const attachments = listFiles(path.join(appDataDir, ATTACHMENT_DIR_NAME)).filter((name) => STORED_NAME.test(name));
    const manifest: Manifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      createdAt: now.toISOString(),
      counts: { ...counts, images: images.length },
    };
    const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const sources: ArchiveSource[] = [
      { name: DATABASE_NAME, file: snapshot },
      ...images.map((name) => ({ name: `${IMAGE_DIR_NAME}/${name}`, file: path.join(appDataDir, IMAGE_DIR_NAME, name) })),
      ...attachments.map((name) => ({
        name: `${ATTACHMENT_DIR_NAME}/${name}`,
        file: path.join(appDataDir, ATTACHMENT_DIR_NAME, name),
      })),
    ];
    await writeArchive(
      file,
      new Map([
        [MANIFEST_NAME, json(manifest)],
        [SETTINGS_NAME, json(portableSettings(settings))],
      ]),
      sources,
    );
    const { size } = await fs.promises.stat(file);
    return { file, bytes: size, createdAt: manifest.createdAt, counts: manifest.counts };
  } finally {
    await fs.promises.rm(scratch, { recursive: true, force: true });
  }
}

// --- restoring --------------------------------------------------------------

export type StagedBackup = {
  /** The scratch folder holding the unpacked backup; remove it with `discardStagedBackup`. */
  dir: string;
  createdAt: string;
  counts: BackupCounts;
  /** The backup's settings, or null for a backup without any (the current ones are then kept). */
  settings: WebSettings | null;
  hasImages: boolean;
  hasAttachments: boolean;
};

async function readJson(data: AsyncIterable<Buffer>, size: number, what: string): Promise<unknown> {
  if (size > MAX_JSON_BYTES) throw new ArchiveError(`The backup's ${what} is too large to be real.`);
  const chunks: Buffer[] = [];
  for await (const chunk of data) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ArchiveError(`The backup's ${what} is damaged.`);
  }
}

function parseManifest(value: unknown): Manifest {
  const manifest = value as Partial<Manifest> | null;
  if (!manifest || manifest.format !== BACKUP_FORMAT || typeof manifest.version !== "number") {
    throw new ArchiveError("This is not a Composition backup.");
  }
  if (manifest.version > BACKUP_FORMAT_VERSION) {
    throw new ArchiveError(
      `This backup was made by a newer version of Composition (backup format ${manifest.version}); update Composition to restore it.`,
    );
  }
  return manifest as Manifest;
}

/**
 * Unpacks and validates the backup at `file` into a scratch folder inside
 * `appDataDir` (the same disk the files will end up on, so the swap is a
 * rename). Nothing outside the scratch folder is touched. Every entry name is
 * checked against the shapes the app itself generates, so a hostile archive
 * cannot write outside the folder or smuggle in a file the app would later
 * serve or open.
 */
export async function stageBackup(file: string, appDataDir: string): Promise<StagedBackup> {
  try {
    await fs.promises.access(file, fs.constants.R_OK);
  } catch {
    throw new ArchiveError(`Can't read ${file}.`);
  }
  await fs.promises.mkdir(appDataDir, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(appDataDir, ".restore-"));

  try {
    let manifest: Manifest | null = null;
    let settings: WebSettings | null = null;
    let hasDatabase = false;
    const seen = new Set<string>();
    let images = 0;
    let attachments = 0;

    await readArchive(file, async ({ name, size, data }) => {
      if (seen.has(name)) throw new ArchiveError(`The backup lists ${name} twice.`);
      seen.add(name);

      if (name === MANIFEST_NAME) {
        manifest = parseManifest(await readJson(data, size, "description"));
        return;
      }
      if (name === SETTINGS_NAME) {
        settings = parseWebSettings(await readJson(data, size, "settings"));
        return;
      }

      let target: string;
      if (name === DATABASE_NAME) {
        hasDatabase = true;
        target = path.join(dir, DATABASE_NAME);
      } else {
        const [folder, fileName, ...rest] = name.split("/");
        const valid =
          rest.length === 0 &&
          fileName !== undefined &&
          ((folder === IMAGE_DIR_NAME && isImageName(fileName)) ||
            (folder === ATTACHMENT_DIR_NAME && STORED_NAME.test(fileName)));
        if (!valid) throw new ArchiveError(`The backup contains a file Composition doesn't know (${name}), so it was not restored.`);
        if (folder === IMAGE_DIR_NAME) images += 1;
        else attachments += 1;
        await fs.promises.mkdir(path.join(dir, folder), { recursive: true });
        target = path.join(dir, folder, fileName);
      }
      await pipeline(data, fs.createWriteStream(target, { flags: "wx", mode: 0o600 }));
    });

    if (!manifest) throw new ArchiveError("This is not a Composition backup.");
    if (!hasDatabase) throw new ArchiveError("This backup has no database in it, so nothing was restored.");
    const stagedDatabase = path.join(dir, DATABASE_NAME);
    assertUsableDatabase(stagedDatabase);

    return {
      dir,
      createdAt: (manifest as Manifest).createdAt,
      counts: { ...countRows(stagedDatabase), images },
      settings,
      hasImages: images > 0,
      hasAttachments: attachments > 0,
    };
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function discardStagedBackup(staged: Pick<StagedBackup, "dir">): Promise<void> {
  await fs.promises.rm(staged.dir, { recursive: true, force: true });
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

/**
 * Replaces the current database, images and attachments with the staged ones,
 * then removes the scratch folder. What was there is set aside first, and put
 * back if anything fails, so the app is never left half restored. The caller
 * must have closed the database connection, and should have taken a backup of
 * the current data (service.restoreBackup does).
 */
export function applyStagedBackup(staged: StagedBackup, locations: { appDataDir: string; dbPath: string }): void {
  const { appDataDir, dbPath } = locations;
  const aside = path.join(staged.dir, "previous");
  fs.mkdirSync(aside);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // [where it lives now, what the staged copy replaces it with (null: nothing, the backup had none)]
  const swaps: [string, string | null][] = [
    [dbPath, path.join(staged.dir, DATABASE_NAME)],
    ...DATABASE_SUFFIXES.map((suffix): [string, string | null] => [dbPath + suffix, null]),
    [path.join(appDataDir, IMAGE_DIR_NAME), staged.hasImages ? path.join(staged.dir, IMAGE_DIR_NAME) : null],
    [path.join(appDataDir, ATTACHMENT_DIR_NAME), staged.hasAttachments ? path.join(staged.dir, ATTACHMENT_DIR_NAME) : null],
  ];

  const setAside: [string, string][] = [];
  const placed: string[] = [];
  try {
    swaps.forEach(([current], index) => {
      if (!exists(current)) return;
      const parked = path.join(aside, String(index));
      moveEntry(current, parked);
      setAside.push([current, parked]);
    });
    for (const [current, replacement] of swaps) {
      if (replacement === null) continue;
      moveEntry(replacement, current);
      placed.push(current);
    }
  } catch (error) {
    for (const file of placed.reverse()) fs.rmSync(file, { recursive: true, force: true });
    for (const [current, parked] of setAside.reverse()) {
      try {
        moveEntry(parked, current);
      } catch {
        // Nothing more can be done; the previous data stays in the scratch folder, which is kept for that reason.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ArchiveError(`Could not restore: ${message}. Your previous data was put back.`);
  }
  fs.rmSync(staged.dir, { recursive: true, force: true });
}
