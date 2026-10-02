/**
 * What the Settings screen's Backup and Restore sections exchange with the
 * backend. Types and small pure helpers only, so it is safe to import anywhere
 * (renderer, preload, main).
 *
 * There are two shapes of transport, because they differ in who may name a path:
 *
 *   web, CLI   the person types a folder (to back up into) or a file (to restore
 *              from), and the server/process reads and writes it. The web app is
 *              the person's own local server, like the Application data
 *              directory field next to it.
 *   desktop    `DesktopBackupApi`: the renderer asks to "back up" or "restore",
 *              and the main process opens the operating system's save/open
 *              dialog. The renderer never supplies a path (the same rule as
 *              attachmentsApi.ts), so a compromised page can't make the app
 *              write to, or restore from, a file of its choosing.
 */

/** What is in a backup, or was just restored from one. */
export type BackupCounts = {
  notes: number;
  groups: number;
  trashedNotes: number;
  trashedGroups: number;
  /** Pasted images. */
  images: number;
  /** Attached files. */
  attachments: number;
};

/**
 * The outcome of a backup or restore. Failure is `error`, never a throw; a
 * dismissed dialog is `canceled` and not a failure.
 */
export type BackupResult = {
  error?: string;
  canceled?: boolean;
  /** Backup: the file written. Restore: the file restored from. */
  file?: string;
  /** Backup only: its size in bytes. */
  bytes?: number;
  /** When the backup was made. */
  createdAt?: string;
  counts?: BackupCounts;
  /** Restore only: where the data it replaced was saved first. */
  safetyBackup?: string;
};

/** The desktop app's contract: no paths cross the bridge (see the note at the top). */
export interface DesktopBackupApi {
  /** Asks where to save, then writes a backup there. */
  createBackup(): Promise<BackupResult>;
  /** Asks which backup to restore, then replaces everything with it. */
  restoreBackup(): Promise<BackupResult>;
}

/** Every method of DesktopBackupApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const BACKUP_METHODS = ["createBackup", "restoreBackup"] as const satisfies readonly (keyof DesktopBackupApi)[];

export type BackupMethod = (typeof BACKUP_METHODS)[number];

type MissingFromBackupMethods = Exclude<keyof DesktopBackupApi, BackupMethod>;
const _everyMethodListed: [MissingFromBackupMethods] extends [never] ? true : never = true;
void _everyMethodListed;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 notes, 3 groups, 4 images and 1 attached file", plus what the Trash Can holds, if anything. */
export function describeCounts(counts: BackupCounts): string {
  const parts = [
    plural(counts.notes, "note"),
    plural(counts.groups, "group"),
    plural(counts.images, "image"),
    `${counts.attachments} attached ${counts.attachments === 1 ? "file" : "files"}`,
  ];
  const text = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const trashed = counts.trashedNotes + counts.trashedGroups;
  return trashed > 0 ? `${text}, plus ${plural(trashed, "item")} in the Trash Can` : text;
}
