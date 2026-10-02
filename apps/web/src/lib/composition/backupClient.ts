import { createBackup as createBackupAction, restoreBackup as restoreBackupAction } from "./backupActions";
import type { BackupResult } from "./backupApi";

/**
 * What the Settings page imports to back up and restore. In the web build these
 * are Server Actions that take a path the person typed; the desktop build
 * resolves `backupClient.desktop.ts` instead (next.config.ts), whose functions
 * take none, because the main process asks with a native dialog.
 */

/** Whether the person types the path (web), or a native dialog asks for it (desktop). */
export const BACKUP_NEEDS_PATH = true;

export const createBackup = (directory?: string): Promise<BackupResult> => createBackupAction(directory ?? "");
export const restoreBackup = (file?: string): Promise<BackupResult> => restoreBackupAction(file ?? "");

export type { BackupCounts, BackupResult } from "./backupApi";
