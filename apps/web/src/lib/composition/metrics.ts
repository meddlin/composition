import fs from "node:fs";
import path from "node:path";
import { ATTACHMENT_DIR_NAME } from "./attachmentNames";
import { IMAGE_DIR_NAME } from "./imageRefs";

/** The "just for fun" numbers on the Settings screen. */
export type Metrics = {
  noteCount: number;
  /** Words across every note's text. */
  words: number;
  /** Characters across every note's text, spaces included. */
  characters: number;
  /** Words per note, rounded to the nearest whole word; 0 with no notes. */
  averageWords: number;
  /** Bytes used by the database file (and its write-ahead log). */
  databaseBytes: number;
  /** Bytes used by attachments. */
  assetsBytes: number;
  /** Bytes used by pasted images. */
  mediaBytes: number;
};

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Counts characters as a person sees them, so an emoji is one rather than two. */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** Total size of the files directly inside `dir`; a missing folder is 0. */
export function directoryBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        total += fs.statSync(path.join(dir, entry.name)).size;
      } catch {
        // Gone between the listing and the stat.
      }
    }
  } catch {
    return 0;
  }
  return total;
}

function fileBytes(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function computeMetrics(options: {
  contents: readonly string[];
  dbPath: string;
  appDataDir: string;
}): Metrics {
  const { contents, dbPath, appDataDir } = options;
  let words = 0;
  let characters = 0;
  for (const content of contents) {
    words += countWords(content);
    characters += countCharacters(content);
  }
  return {
    noteCount: contents.length,
    words,
    characters,
    averageWords: contents.length === 0 ? 0 : Math.round(words / contents.length),
    databaseBytes: fileBytes(dbPath) + fileBytes(`${dbPath}-wal`) + fileBytes(`${dbPath}-shm`),
    assetsBytes: directoryBytes(path.join(appDataDir, ATTACHMENT_DIR_NAME)),
    mediaBytes: directoryBytes(path.join(appDataDir, IMAGE_DIR_NAME)),
  };
}
