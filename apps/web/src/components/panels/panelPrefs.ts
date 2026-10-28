import { useSyncExternalStore } from "react";

/**
 * Preferences about panels, kept in `localStorage` like the sidebar's other per-viewer conveniences (never required,
 * and the storage can be blocked).
 */

const STORAGE_KEY = "composition.panels";

export type PanelPrefs = {
  /** Ask before a note is shown in a second panel on purpose (Open to the side, or a drop on a panel). */
  warnDuplicateNotePanels: boolean;
};

const DEFAULTS: PanelPrefs = { warnDuplicateNotePanels: true };

/** Whatever is stored, reduced to valid preferences; anything unreadable gives the defaults. */
export function parsePanelPrefs(raw: string | null): PanelPrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof PanelPrefs, unknown>> | null;
    return {
      warnDuplicateNotePanels:
        typeof value?.warnDuplicateNotePanels === "boolean" ? value.warnDuplicateNotePanels : DEFAULTS.warnDuplicateNotePanels,
    };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
// Memory is the source of truth while the page is open, so a blocked or full storage still works.
let current: PanelPrefs | null = null;

function load(): PanelPrefs {
  if (current) return current;
  try {
    current = parsePanelPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setWarnDuplicateNotePanels(warn: boolean): void {
  current = { ...load(), warnDuplicateNotePanels: warn };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not remembered next time.
  }
  listeners.forEach((listener) => listener());
}

/** Whether to ask before showing a note in a second panel. */
export function useWarnDuplicateNotePanels(): boolean {
  return useSyncExternalStore(subscribe, () => load().warnDuplicateNotePanels, () => DEFAULTS.warnDuplicateNotePanels);
}

/** Test hook: forget what this page has loaded, so the next read goes back to storage. */
export function resetPanelPrefs(): void {
  current = null;
  listeners.forEach((listener) => listener());
}
