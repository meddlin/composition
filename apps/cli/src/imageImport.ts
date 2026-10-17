import fs from "node:fs";
import path from "node:path";
import type { Api } from "./api";
import { parsePaths } from "./attachmentFiles";
import { IMAGE_DIR_NAME } from "./backend";

/**
 * Getting an image into a note from a terminal, which cannot receive picture bytes from a paste:
 * the image is a file on this machine, named by its path, and goes through the same `saveImage`
 * the web and desktop apps use when they paste one.
 */

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

/** Markdown image syntax is `![alt](path)`, so brackets in the alt text must go. */
const altTextFor = (fileName: string) => fileName.replace(/\.[^.]*$/, "").replace(/[[\]\r\n]+/g, " ").trim() || "image";

function isImageFile(file: string): boolean {
  try {
    return IMAGE_FILE.test(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The image files named by pasted or typed text, or null when it is anything else. Every path
 * must be an existing PNG, JPEG, GIF or WebP file, so a paste that merely mentions one is typed
 * into the note as the text it is.
 */
export function imagePathsIn(text: string, cwd: string): string[] | null {
  const paths = parsePaths(text, cwd);
  return paths.length > 0 && paths.every(isImageFile) ? paths : null;
}

export type ImportResult = { markdown: string; errors: string[] };

/**
 * Stores each image and returns the Markdown that shows them, one per line. An image that can't be
 * stored (not really an image, unreadable) is named in `errors` and the others still go in.
 */
export async function importImages(api: Pick<Api, "saveImage">, noteId: number, files: readonly string[]): Promise<ImportResult> {
  const lines: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const fileName = path.basename(file);
    try {
      const result = await api.saveImage({ noteId, fileName, data: new Uint8Array(await fs.promises.readFile(file)) });
      if (result.name) lines.push(`![${altTextFor(fileName)}](${IMAGE_DIR_NAME}/${result.name})`);
      else errors.push(`${fileName}: ${result.error ?? "could not be added."}`);
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { markdown: lines.join("\n"), errors };
}
