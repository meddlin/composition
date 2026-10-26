// When each note was last opened, so the home page can list notes by it. Kept in the browser, like the open
// notebook: it is a convenience of this computer, not part of the notes, and the home page copes without it.
const STORAGE_KEY = "composition.opened";

// Enough to fill the longest recent list with room to spare; the oldest are forgotten past this.
const KEEP = 100;

/** The stored text as note id to the time it was opened (milliseconds); anything unreadable is dropped. */
export function parseOpened(raw: string | null): Record<number, number> {
  const opened: Record<number, number> = {};
  if (!raw) return opened;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return opened;
    for (const [key, time] of Object.entries(value)) {
      const id = Number(key);
      if (Number.isSafeInteger(id) && id > 0 && typeof time === "number" && Number.isFinite(time)) opened[id] = time;
    }
  } catch {
    // Not valid JSON: treated as never having opened anything.
  }
  return opened;
}

/** The raw stored text; a string so `useSyncExternalStore` can tell when it has not changed. */
export function readOpenedRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Notes the user is looking at count as opened now. */
export function recordOpened(id: number, now: number = Date.now()): void {
  const opened = { ...parseOpened(readOpenedRaw()), [id]: now };
  const newest = Object.entries(opened)
    .sort(([, a], [, b]) => b - a)
    .slice(0, KEEP);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Not remembered; the home page falls back to the last edit.
  }
}
