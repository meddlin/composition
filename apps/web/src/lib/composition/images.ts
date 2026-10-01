import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_DIR_NAME,
  isImageName,
  MAX_IMAGE_BYTES,
  type ImageExtension,
} from "./imageRefs";

/**
 * Storage for images pasted into notes: plain files in
 * `<application data>/app_data/`, referenced from a note's Markdown by name
 * (imageRefs.ts). Framework-free, like the rest of the service layer.
 */

export function imageDir(appDataDir: string): string {
  return path.join(appDataDir, IMAGE_DIR_NAME);
}

const startsWith = (data: Uint8Array, bytes: readonly number[], offset = 0) =>
  bytes.every((byte, i) => data[offset + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** What the bytes actually are, whatever the file claims. SVG is deliberately unsupported (it can carry script). */
export function sniffImage(data: Uint8Array): ImageExtension | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(data, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(data, ascii("GIF87a")) || startsWith(data, ascii("GIF89a"))) return "gif";
  if (startsWith(data, ascii("RIFF")) && startsWith(data, ascii("WEBP"), 8)) return "webp";
  return null;
}

function slug(text: string, maxLength: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** `<note title>-<image file name>-<content hash>.<ext>`, e.g. `trip-plan-map-3f9c2a71b0de.png`. */
export function imageFileName(noteTitle: string, fileName: string, data: Uint8Array, ext: ImageExtension): string {
  const stem = (fileName.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  const hash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 12);
  return `${slug(noteTitle, 40) || "note"}-${slug(stem, 40) || "image"}-${hash}.${ext}`;
}

export type StoreImageInput = { noteTitle: string; fileName: string; data: Uint8Array };

export type StoreImageResult = { name: string; error?: undefined } | { name?: undefined; error: string };

/**
 * Writes the image under a name derived from the note and file names, plus a
 * hash of the bytes so two different images can never share one. Pasting the
 * same image into the same note again reuses the file instead of duplicating it.
 * `maxBytes` is the size limit, or null for none.
 */
export function storeImage(
  appDataDir: string,
  input: StoreImageInput,
  maxBytes: number | null = MAX_IMAGE_BYTES,
): StoreImageResult {
  const { noteTitle, fileName, data } = input;
  if (data.byteLength === 0) return { error: "That image is empty." };
  if (maxBytes !== null && data.byteLength > maxBytes) {
    return { error: `Images can be at most ${maxBytes / (1024 * 1024)} MB.` };
  }
  const ext = sniffImage(data);
  if (!ext) return { error: "Only PNG, JPEG, GIF, and WebP images are supported." };

  const name = imageFileName(noteTitle, fileName, data, ext);
  const dir = imageDir(appDataDir);
  const target = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) {
      // Write-then-rename, so a request can never be served a half-written file.
      const temporary = path.join(dir, `.${name}.tmp`);
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, target);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not save the image: ${message}` };
  }
  return { name };
}

export type StoredImage = { data: Buffer; contentType: string };

/** The stored image called `name`, or null when the name is malformed or the file is missing. */
export async function readImage(appDataDir: string, name: string): Promise<StoredImage | null> {
  if (!isImageName(name)) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPES[(ext === "jpeg" ? "jpg" : ext) as ImageExtension];
  try {
    return { data: await fs.promises.readFile(path.join(imageDir(appDataDir), name)), contentType };
  } catch {
    return null;
  }
}

/** Headers for serving a stored image. Names embed a content hash, so a cached copy never goes stale. */
export const IMAGE_RESPONSE_HEADERS = {
  "cache-control": "private, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
} as const;
