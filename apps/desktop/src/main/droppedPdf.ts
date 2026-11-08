import fs from "node:fs";
import path from "node:path";

/**
 * Whether a file dropped on the window may be imported as a PDF. The path comes from the preload script, which reads it from a File
 * the operating system handed to this window (Electron's `webUtils.getPathForFile`); the page never sees it, and a File the page
 * makes up has none. This is the main process's own check of it, before `service.importPdf` looks inside the file (a real file, at
 * most 1 GB, starting with `%PDF-`).
 */
export type DroppedPdfCheck = { ok: true; path: string } | { ok: false; error: string };

/** True when `file` is `folder` or anything inside it. Both must already be real paths (symlinks resolved). */
export function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const NOT_A_DISK_FILE = "Drop a PDF file from your computer.";

export async function checkDroppedPdf(candidate: unknown, dataFolder: string): Promise<DroppedPdfCheck> {
  // A File made by the page (or one dragged out of a web page) has no path.
  if (typeof candidate !== "string" || candidate === "" || candidate.includes("\0") || !path.isAbsolute(candidate)) {
    return { ok: false, error: NOT_A_DISK_FILE };
  }
  const name = path.basename(candidate);
  if (path.extname(name).toLowerCase() !== ".pdf") return { ok: false, error: `${name}: only PDF files can be dropped here.` };

  // The real file: a link is followed, so the checks below are about what would be read.
  const real = await fs.promises.realpath(candidate).catch(() => null);
  const stats = real && (await fs.promises.stat(real).catch(() => null));
  if (!real || !stats) return { ok: false, error: `${name}: could not be read.` };
  if (!stats.isFile()) return { ok: false, error: `${name}: only files can be imported, not folders.` };

  // Importing from the library's own folder would copy the app's files (the database, other PDFs, attachments) into itself.
  const data = await fs.promises.realpath(dataFolder).catch(() => dataFolder);
  if (isInside(data, real)) return { ok: false, error: `${name}: this is already inside Composition's own data folder.` };
  // What was dropped (with the name the user gave it) is what gets imported; `real` was only for looking.
  return { ok: true, path: candidate };
}
