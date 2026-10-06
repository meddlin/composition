"use server";

import { revalidatePath } from "next/cache";
import type { BackupResult } from "./backupApi";
import * as service from "./service";

/**
 * The web app's transport for backup and restore: Server Actions that take the
 * path the person typed on the Settings page (the web app is their own local
 * server; see backupApi.ts). Deliberately not in CompositionApi, which the
 * desktop app also exposes over IPC, where a renderer must never name a path.
 */

export async function createBackup(directory: string): Promise<BackupResult> {
  return service.createBackup(directory);
}

export async function restoreBackup(file: string): Promise<BackupResult> {
  const result = await service.restoreBackup(file);
  // Everything the app renders just changed.
  if (!result.error) revalidatePath("/", "layout");
  return result;
}
