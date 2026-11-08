/**
 * Saving a file the page made (an export). In a browser that is a download. The desktop app blocks every download (see
 * readingListGuard.ts in apps/desktop) and has no bridge yet for the page to hand it a file to save in a native dialog, so there
 * the page says so rather than do nothing.
 */

/** Whether the page can save a file by itself: in a browser; not in the desktop app (`window.composition` is its bridge). */
export function canSaveFile(): boolean {
  return typeof window !== "undefined" && window.composition === undefined;
}

/** Offers `data` to the browser as a download called `name`. */
export function saveFile(name: string, data: Uint8Array | string, type: string): void {
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
