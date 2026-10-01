/**
 * How a note's Markdown points at a stored image. Pure string handling, so the
 * renderer, the web route, and Electron's main process can all import it.
 *
 * Images live in `<application data>/app_data/` (see images.ts). A note refers
 * to one by the same relative path, which keeps the text meaningful on its own:
 *
 *   ![diagram](app_data/architecture-diagram-3f9c2a71b0de.png)
 */

/** The folder inside the application data directory, and the prefix in a note's image path. */
export const IMAGE_DIR_NAME = "app_data";

/** Largest image the web app accepts. The desktop app has no limit (see imageLimit.ts). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Stored images only ever have these extensions; what is on disk is sniffed, not trusted. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "gif", "webp"] as const;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

export const IMAGE_CONTENT_TYPES: Record<ImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// A single path segment: no separators, so a name can never leave the folder.
const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_NAME.test(name);
}

/** The Markdown path for a stored image's file name. */
export function imageRef(name: string): string {
  return `${IMAGE_DIR_NAME}/${name}`;
}

/** The file name a Markdown image path refers to, or null when it isn't a stored image. */
export function imageNameFromRef(src: string): string | null {
  const prefix = `${IMAGE_DIR_NAME}/`;
  const rest = src.startsWith(`./${prefix}`) ? src.slice(2 + prefix.length) : src.startsWith(prefix) ? src.slice(prefix.length) : null;
  return rest !== null && isImageName(rest) ? rest : null;
}
