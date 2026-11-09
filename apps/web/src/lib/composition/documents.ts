import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { displayName, formatBytes, storedFileName } from "./attachmentNames";
import { DOCUMENT_DIR_NAME, looksLikePdf, MAX_DOCUMENT_BYTES, PDF_HEADER_WINDOW } from "./documentNames";
import * as repo from "./documentsRepo";
import { DocumentOwnerError, type StoredDocument } from "./documentsRepo";

/**
 * Storage for the PDFs notes own (docs/pdf-markup-plan.md): plain files in `<application data>/documents/`, one row per
 * file in the `documents` table. Framework-free, like attachments.ts, which it follows closely; the difference is that
 * a PDF is read by the app (pdf.js), so its bytes are served to the reader, and that it is hashed on the way in so a
 * second import of the same file can be spotted (P16).
 */

export function documentDir(appDataDir: string): string {
  return path.join(appDataDir, DOCUMENT_DIR_NAME);
}

/**
 * What an import came to. `refused` is for something the person can fix (not a PDF, too large, the note already has
 * one); the message is safe to show. `duplicate` lists the PDFs with exactly these bytes and nothing was copied:
 * the caller offers to open one, or imports again with `allowDuplicate` for a separate copy.
 */
export type ImportDocumentResult =
  | { status: "added"; document: StoredDocument }
  | { status: "duplicate"; existing: StoredDocument[] }
  | { status: "refused"; error: string };

/**
 * Copies a PDF into the documents folder and gives it to the note. `pageCount` is what the caller counted (the
 * reader's job, so 0 is allowed and means not counted yet). Copy-then-rename, so a file is never visible half
 * written, and the hash is taken from the bytes as they are copied, not from a second read.
 */
export async function importDocument(
  appDataDir: string,
  noteId: number,
  sourcePath: string,
  options: { pageCount?: number; allowDuplicate?: boolean } = {},
): Promise<ImportDocumentResult> {
  const fileName = displayName(sourcePath);
  const stats = await fs.promises.stat(sourcePath).catch(() => null);
  if (!stats) return { status: "refused", error: `${fileName}: could not be read.` };
  if (!stats.isFile()) return { status: "refused", error: `${fileName}: only files can be imported, not folders.` };
  if (stats.size > MAX_DOCUMENT_BYTES) return { status: "refused", error: `${fileName}: files can be at most ${formatBytes(MAX_DOCUMENT_BYTES)}.` };

  const owner = repo.getDocumentForNote(noteId);
  if (owner) return { status: "refused", error: "That note already has a PDF." };

  const handle = await fs.promises.open(sourcePath, "r").catch(() => null);
  if (!handle) return { status: "refused", error: `${fileName}: could not be read.` };
  try {
    const head = Buffer.alloc(Math.min(stats.size, PDF_HEADER_WINDOW));
    await handle.read(head, 0, head.length, 0);
    if (!looksLikePdf(head)) return { status: "refused", error: `${fileName}: this doesn't look like a PDF.` };
  } finally {
    await handle.close();
  }

  const dir = documentDir(appDataDir);
  const storedName = storedFileName(crypto.randomBytes(6).toString("hex"), fileName);
  const target = path.join(dir, storedName);
  const temporary = path.join(dir, `.${storedName}.tmp`);
  await fs.promises.mkdir(dir, { recursive: true });

  const hash = crypto.createHash("sha256");
  let size = 0;
  const tee = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  try {
    await pipeline(fs.createReadStream(sourcePath), tee, fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    const sha256 = hash.digest("hex");

    if (!options.allowDuplicate) {
      const existing = repo.findDocumentsBySha256(sha256);
      if (existing.length > 0) {
        await fs.promises.rm(temporary, { force: true });
        return { status: "duplicate", existing };
      }
    }
    await fs.promises.rename(temporary, target);
    try {
      const document = repo.addDocument({ noteId, fileName, storedName, sha256, size, pageCount: options.pageCount ?? 0 });
      return { status: "added", document };
    } catch (error) {
      await fs.promises.rm(target, { force: true });
      if (error instanceof DocumentOwnerError) return { status: "refused", error: error.message };
      throw error;
    }
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Where a PDF's bytes are, or null when the row is gone or the file has been deleted behind the app's back. The path is
 * built from the stored name the app generated, never from anything the renderer sent.
 */
export function documentPath(appDataDir: string, id: number): { path: string; document: StoredDocument } | null {
  const document = repo.getDocument(id);
  if (!document) return null;
  const file = path.join(documentDir(appDataDir), document.storedName);
  return fs.existsSync(file) ? { path: file, document } : null;
}

async function removeFiles(appDataDir: string, documents: readonly StoredDocument[]): Promise<void> {
  const dir = documentDir(appDataDir);
  for (const { storedName } of documents) {
    // `force` so a file that is already gone isn't an error.
    await fs.promises.rm(path.join(dir, storedName), { force: true }).catch(() => {});
  }
}

/** Deletes a PDF, its marks, its bookmarks and its stored file. Returns false when there was no such PDF. */
export async function removeDocument(appDataDir: string, id: number): Promise<boolean> {
  const document = repo.deleteDocument(id);
  if (!document) return false;
  await removeFiles(appDataDir, [document]);
  return true;
}

/**
 * Deletes the PDFs (rows, marks, bookmarks and stored files) of notes that no longer exist anywhere, trashed or not.
 * Run after a note is permanently deleted, by hand or because it outlived the Trash Can's retention window, and by the
 * CLI's deletes, which have no Trash Can: the next sweep finds the file.
 */
export async function removeOrphans(appDataDir: string): Promise<void> {
  await removeFiles(appDataDir, repo.deleteOrphanedDocuments());
}
