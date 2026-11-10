import type { SaveFileKind } from "@/lib/composition/saveFileApi";

/**
 * Saving a file the page made (an export). In a browser that is a download. The desktop app cancels every download on purpose
 * (see readingListGuard.ts in apps/desktop), so there the page hands the bytes and a suggested name to the main process
 * (`window.composition.saveFile`, see saveFileApi.ts), which asks where to save them in the operating system's save dialog.
 */

/** What each kind of file is called to the browser. */
const MEDIA_TYPES: Record<SaveFileKind, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
};

/** What came of a save: written (the desktop app), handed to the browser to download (it cannot say more), or dismissed in the save dialog. */
export type SaveOutcome = "saved" | "offered" | "canceled";

/** A save that failed, with a reason the person can read (the desktop app's: a full disk, a folder that cannot be written). */
export class SaveFileError extends Error {}

/** Whether the page can save a file: in the desktop app through its bridge, in a browser as a download. */
export function canSaveFile(): boolean {
  if (typeof window === "undefined") return false;
  return window.composition === undefined || typeof window.composition.saveFile === "function";
}

/**
 * Saves `data` as a file of `kind` suggested to be called `name`. In the desktop app the person chooses where in a save dialog,
 * and `"canceled"` is their dismissing it; a failure to write throws a {@link SaveFileError}. In a browser it is offered as a download.
 */
export async function saveFile(name: string, data: Uint8Array | string, kind: SaveFileKind): Promise<SaveOutcome> {
  const bridge = typeof window === "undefined" ? undefined : window.composition;
  if (!bridge) {
    download(name, data, MEDIA_TYPES[kind]);
    return "offered";
  }
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const { saved, error } = await bridge.saveFile({ name, bytes, kind });
  if (error !== undefined) throw new SaveFileError(error);
  return saved ? "saved" : "canceled";
}

/** Offers `data` to the browser as a download called `name`. */
function download(name: string, data: Uint8Array | string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has been handed the file by now; the address can go.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
