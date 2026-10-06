import type { DesktopBackupApi } from "../../../web/src/lib/composition/backupApi";
import { backupFileName } from "../../../web/src/lib/composition/backup";
import type { service as Service } from "./backend";

/**
 * The desktop-only DesktopBackupApi (see apps/web/src/lib/composition/backupApi.ts).
 *
 * Like attachments.ts: the operating system's dialogs choose the files, and the
 * renderer only says "back up" or "restore". A compromised page therefore can't
 * make the app write a backup to, or restore from, a path of its choosing. What
 * a dialog returns is handed straight to the service.
 */

/** The native pieces this needs, as plain functions, so tests don't need Electron. */
export type BackupUi = {
  /** Where the user wants the backup saved, or null if they cancelled. */
  pickSavePath(defaultName: string): Promise<string | null>;
  /** The backup file the user chose, or null if they cancelled. */
  pickBackupFile(): Promise<string | null>;
};

type BackupService = Pick<typeof Service, "createBackupAt" | "restoreBackup">;

export function createBackupApi(service: BackupService, ui: BackupUi, now: () => Date = () => new Date()): DesktopBackupApi {
  return {
    async createBackup() {
      const destination = await ui.pickSavePath(backupFileName(now()));
      if (!destination) return { canceled: true };
      return service.createBackupAt(destination);
    },

    async restoreBackup() {
      const file = await ui.pickBackupFile();
      if (!file) return { canceled: true };
      return service.restoreBackup(file);
    },
  };
}
