/**
 * How the page hands the desktop app a file it made (an exported sheet, say) to save. Types and small pure helpers only, so it
 * is safe to import anywhere (renderer, preload, main).
 *
 * A browser saves such a file as a download. The desktop app cancels every download on purpose (readingListGuard.ts), so the
 * page sends the bytes and a suggested name instead, and the main process asks where to save them in the operating system's
 * save dialog. The renderer never supplies a path (the same rule as backupApi.ts and attachmentsApi.ts): a compromised page can
 * make the app show that dialog and offer it bytes, but not choose where they are written, and nothing is written unless the
 * person picks a place.
 */

/** What may be saved this way. Each is a kind of file the page can make; the main process adds the extension and a save dialog filter. */
export const SAVE_FILE_KINDS = ["xlsx", "csv"] as const;

export type SaveFileKind = (typeof SAVE_FILE_KINDS)[number];

export const isSaveFileKind = (value: unknown): value is SaveFileKind =>
  typeof value === "string" && (SAVE_FILE_KINDS as readonly string[]).includes(value);

/** The most one file may weigh: far more than a sheet's workbook, so it only stops a page from handing the main process something huge. */
export const MAX_SAVE_FILE_BYTES = 64 * 1024 * 1024;

/** The most a suggested name may be, as sent; the main process shortens what it offers. */
export const MAX_SAVE_FILE_NAME_LENGTH = 1024;

export type SaveFileInput = {
  /** A suggested name for the file. Only a suggestion: the person chooses the name and the place in the save dialog. */
  name: string;
  bytes: Uint8Array;
  kind: SaveFileKind;
};

/** The outcome of a save. Failure is `error`, never a throw; a dismissed dialog is `saved: false` with no error. */
export type SaveFileResult = {
  saved: boolean;
  error?: string;
};

/** The desktop app's contract: no paths cross the bridge (see the note at the top). */
export interface SaveFileApi {
  /** Asks where to save, then writes `bytes` there. */
  saveFile(input: SaveFileInput): Promise<SaveFileResult>;
}

/** Every method of SaveFileApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const SAVE_FILE_METHODS = ["saveFile"] as const satisfies readonly (keyof SaveFileApi)[];

export type SaveFileMethod = (typeof SAVE_FILE_METHODS)[number];

type MissingFromSaveFileMethods = Exclude<keyof SaveFileApi, SaveFileMethod>;
const _everyMethodListed: [MissingFromSaveFileMethods] extends [never] ? true : never = true;
void _everyMethodListed;
