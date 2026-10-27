import { useSyncExternalStore } from "react";

/**
 * Which dates are shown under each note's name in the sidebar. A per-viewer convenience kept
 * in `localStorage` (never required, and the storage can be blocked), like the notebook panel.
 */

const STORAGE_KEY = "composition.noteDates";

export type NoteDatePrefs = { updated: boolean; created: boolean };

const DEFAULTS: NoteDatePrefs = { updated: true, created: false };

/** Whatever is stored, reduced to valid preferences; anything unreadable gives the defaults. */
export function parseNoteDatePrefs(raw: string | null): NoteDatePrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof NoteDatePrefs, unknown>> | null;
    return {
      updated: typeof value?.updated === "boolean" ? value.updated : DEFAULTS.updated,
      created: typeof value?.created === "boolean" ? value.created : DEFAULTS.created,
    };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
// Memory is the source of truth while the page is open, so a blocked or full storage still works.
let current: NoteDatePrefs | null = null;

function load(): NoteDatePrefs {
  if (current) return current;
  try {
    current = parseNoteDatePrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNoteDatePrefs(patch: Partial<NoteDatePrefs>): void {
  current = { ...load(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not remembered next time.
  }
  listeners.forEach((listener) => listener());
}

/** Test hook: forget what this page has loaded, so the next read goes back to storage. */
export function resetNoteDatePrefs(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

/** The server render (and the first client render) use the defaults, then the stored values take over. */
export function useNoteDatePrefs(): NoteDatePrefs {
  return useSyncExternalStore(subscribe, load, () => DEFAULTS);
}

/** "Updated 2 hr ago · Created Oct 3, 2026"; empty when both dates are off or unreadable. */
export function noteDateLine(
  note: { createdAt: string; updatedAt: string },
  prefs: NoteDatePrefs,
  relativeTime: (iso: string) => string,
): string {
  const parts: string[] = [];
  if (prefs.updated) {
    const text = relativeTime(note.updatedAt);
    if (text) parts.push(`Updated ${text}`);
  }
  if (prefs.created) {
    const created = new Date(note.createdAt);
    if (!Number.isNaN(created.getTime())) {
      parts.push(`Created ${created.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`);
    }
  }
  return parts.join(" · ");
}
