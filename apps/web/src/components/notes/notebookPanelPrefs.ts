import { useSyncExternalStore } from "react";

/**
 * How the notebook list is shown: collapsed to a thin rail or not, and how wide it is.
 * A per-viewer convenience kept in `localStorage` (never required, and the storage can be
 * blocked), so it isn't part of the saved layout the sidebar and editor columns use.
 */

export const DEFAULT_NOTEBOOK_PANEL_WIDTH = 200;
export const MIN_NOTEBOOK_PANEL_WIDTH = 120;
export const MAX_NOTEBOOK_PANEL_WIDTH = 360;
/** What is left of the list when it is collapsed: just the button that brings it back. */
export const COLLAPSED_NOTEBOOK_PANEL_WIDTH = 40;

const STORAGE_KEY = "composition.notebookPanel";

export type NotebookPanelPrefs = { collapsed: boolean; width: number };

const DEFAULTS: NotebookPanelPrefs = { collapsed: false, width: DEFAULT_NOTEBOOK_PANEL_WIDTH };

export function clampNotebookPanelWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NOTEBOOK_PANEL_WIDTH;
  return Math.min(MAX_NOTEBOOK_PANEL_WIDTH, Math.max(MIN_NOTEBOOK_PANEL_WIDTH, value));
}

/** Whatever is stored, reduced to valid preferences; anything unreadable gives the defaults. */
export function parseNotebookPanelPrefs(raw: string | null): NotebookPanelPrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof NotebookPanelPrefs, unknown>> | null;
    return {
      collapsed: value?.collapsed === true,
      width: clampNotebookPanelWidth(value?.width),
    };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
// Memory is the source of truth while the page is open, so a blocked or full storage still works.
let current: NotebookPanelPrefs | null = null;

function load(): NotebookPanelPrefs {
  if (current) return current;
  try {
    current = parseNotebookPanelPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNotebookPanelPrefs(patch: Partial<NotebookPanelPrefs>): void {
  const next = { ...load(), ...patch };
  next.width = clampNotebookPanelWidth(next.width);
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not remembered next time.
  }
  listeners.forEach((listener) => listener());
}

/** Test hook: forget what this page has loaded, so the next read goes back to storage. */
export function resetNotebookPanelPrefs(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

/** The server render (and the first client render) use the defaults, then the stored values take over. */
export function useNotebookPanelPrefs(): NotebookPanelPrefs {
  return useSyncExternalStore(subscribe, load, () => DEFAULTS);
}
