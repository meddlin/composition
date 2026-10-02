import type { BackupResult, DesktopBackupApi } from "./backupApi";
import type {} from "./desktopBridge";

/**
 * Desktop build's replacement for `backupClient.ts` (see next.config.ts): the
 * same functions, carried over Electron IPC by the preload script's
 * `window.composition`. They take no path; the main process opens the save and
 * open dialogs.
 */
function bridge(): DesktopBackupApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error(
      "The Composition desktop bridge is unavailable. This build only runs inside the desktop app.",
    );
  }
  return api;
}

export const BACKUP_NEEDS_PATH = false;

export const createBackup = (): Promise<BackupResult> => bridge().createBackup();
export const restoreBackup = (): Promise<BackupResult> => bridge().restoreBackup();

export type { BackupCounts, BackupResult } from "./backupApi";
