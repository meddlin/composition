import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_DIR_NAME,
  displayName,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  storedFileName,
} from "./attachmentNames";
import type { StoredAttachment } from "./attachmentsRepo";
import * as repo from "./attachmentsRepo";

/**
 * Storage for files attached to notes: plain files in
 * `<application data>/attachments/`, one row per file in the `attachments`
 * table. Framework-free, like images.ts. Only the desktop app calls the
 * adding side (see attachmentsApi.ts); removal is shared so that a note that is
 * gone for good, in any app, leaves no stored file behind.
 */

export function attachmentDir(appDataDir: string): string {
  return path.join(appDataDir, ATTACHMENT_DIR_NAME);
}

export type AddFilesResult = { added: StoredAttachment[]; errors: string[] };

/**
 * Copies each file into the attachment folder and records it against the note.
 * A file that can't be attached (a folder, too large, unreadable) is reported
 * by name and doesn't stop the others.
 */
export async function addFiles(
  appDataDir: string,
  noteId: number,
  sourcePaths: readonly string[],
): Promise<AddFilesResult> {
  const dir = attachmentDir(appDataDir);
  const added: StoredAttachment[] = [];
  const errors: string[] = [];

  for (const source of sourcePaths) {
    const fileName = displayName(source);
    try {
      const stats = await fs.promises.stat(source);
      if (!stats.isFile()) {
        errors.push(`${fileName}: only files can be attached, not folders.`);
        continue;
      }
      if (stats.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${fileName}: files can be at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
        continue;
      }

      const storedName = storedFileName(crypto.randomBytes(6).toString("hex"), fileName);
      const target = path.join(dir, storedName);
      await fs.promises.mkdir(dir, { recursive: true });
      // Copy-then-rename, so a file is never visible half-written.
      const temporary = path.join(dir, `.${storedName}.tmp`);
      try {
        await fs.promises.copyFile(source, temporary);
        await fs.promises.rename(temporary, target);
      } catch (error) {
        await fs.promises.rm(temporary, { force: true });
        throw error;
      }

      try {
        added.push(repo.addAttachment(noteId, fileName, storedName, stats.size));
      } catch (error) {
        await fs.promises.rm(target, { force: true });
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${fileName}: could not be attached (${message}).`);
    }
  }
  return { added, errors };
}

/**
 * Where an attachment's bytes are, or null when the row is gone or the file
 * has been deleted behind the app's back. The path is built from the stored
 * name the app generated, never from anything the renderer sent.
 */
export function attachmentPath(appDataDir: string, id: number): { path: string; attachment: StoredAttachment } | null {
  const attachment = repo.getAttachment(id);
  if (!attachment) return null;
  const file = path.join(attachmentDir(appDataDir), attachment.storedName);
  return fs.existsSync(file) ? { path: file, attachment } : null;
}

async function removeFiles(appDataDir: string, attachments: readonly StoredAttachment[]): Promise<void> {
  const dir = attachmentDir(appDataDir);
  for (const { storedName } of attachments) {
    // `force` so a file that is already gone isn't an error.
    await fs.promises.rm(path.join(dir, storedName), { force: true }).catch(() => {});
  }
}

/** Detaches one file and deletes its stored copy. Returns false when there was no such attachment. */
export async function removeAttachment(appDataDir: string, id: number): Promise<boolean> {
  const attachment = repo.getAttachment(id);
  if (!attachment) return false;
  repo.deleteAttachment(id);
  await removeFiles(appDataDir, [attachment]);
  return true;
}

/**
 * Deletes the attachments (rows and stored files) of notes that no longer exist
 * anywhere, trashed or not. Run after a note is permanently deleted, by hand or
 * because it outlived the Trash Can's retention window.
 */
export async function removeOrphans(appDataDir: string): Promise<void> {
  await removeFiles(appDataDir, repo.deleteOrphanedAttachments());
}
