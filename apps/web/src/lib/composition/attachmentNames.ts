/**
 * Pure helpers for attachment file names and sizes. No Node imports, so the
 * renderer can use `formatBytes` and the main process the rest.
 */

/** Folder inside the application data directory that holds attached files. */
export const ATTACHMENT_DIR_NAME = "attachments";

/** Largest file the app attaches. The bytes sit on disk, not in the database, so this is a sanity limit, not a storage one. */
export const MAX_ATTACHMENT_BYTES = 1_000_000_000;

const MAX_STORED_NAME_LENGTH = 100;

/**
 * The name a file is stored under: `<unique prefix>-<original name, made safe>`.
 * The prefix keeps two attachments of the same name apart. The original name's
 * extension survives so Finder still knows what kind of file it is; anything
 * outside `A-Za-z0-9_-` (including path separators) becomes `_`, and the stem
 * can't start with a dot, so the stored file is never hidden.
 */
export function storedFileName(uniquePrefix: string, fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  // A leading dot (".env") is part of the stem, not an extension.
  const rawStem = dot > 0 ? base.slice(0, dot) : base;
  const rawExt = dot > 0 ? base.slice(dot + 1) : "";

  const clean = (text: string) => text.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_");
  const ext = clean(rawExt).replace(/^_+|_+$/g, "").slice(0, 20);
  const stem = clean(rawStem).replace(/^[._]+/, "").slice(0, MAX_STORED_NAME_LENGTH) || "file";
  return `${uniquePrefix}-${stem}${ext ? `.${ext}` : ""}`;
}

/** The file name to show for a path the user picked. */
export function displayName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "file";
}

/** `1.4 MB`, `812 B`: decimal units, which is what Finder shows. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/**
 * A `Content-Disposition` value that makes a browser save the file under
 * `fileName` instead of showing it. `attachment` is the point: served inline, an
 * attached `.html` or `.svg` would run script on the app's own origin. The
 * quoted ASCII form is for old clients; `filename*` carries the real name.
 */
export function attachmentDisposition(fileName: string): string {
  const name = displayName(fileName).replace(/[\u0000-\u001f\u007f]/g, "");
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
