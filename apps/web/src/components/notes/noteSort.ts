import { useSyncExternalStore } from "react";
import type { Note } from "./types";

/**
 * How the notes inside each group are ordered in the sidebar and on a group's page.
 *
 * - `custom`: the order the user placed them in (drag and drop). The default.
 * - `created-*`, `updated-*`: by the note's dates; groups still hold their own notes, and the
 *   groups themselves stay in their custom order.
 *
 * A per-viewer convenience kept in `localStorage` (never required, and the storage can be
 * blocked), like the notebook panel's preferences.
 */

export const NOTE_SORTS = ["custom", "created-desc", "created-asc", "updated-desc", "updated-asc"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

export const DEFAULT_NOTE_SORT: NoteSort = "custom";

export const NOTE_SORT_LABELS: Record<NoteSort, string> = {
  custom: "Custom",
  "created-desc": "Created: newest",
  "created-asc": "Created: oldest",
  "updated-desc": "Updated: newest",
  "updated-asc": "Updated: oldest",
};

export const isNoteSort = (value: unknown): value is NoteSort => NOTE_SORTS.includes(value as NoteSort);

/** `notes` ordered by `sort`; custom returns them untouched. Ties fall back to id so the order is stable. */
export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  if (sort === "custom") return notes;
  const [field, direction] = sort.split("-") as ["created" | "updated", "asc" | "desc"];
  const sign = direction === "asc" ? 1 : -1;
  const key = (note: Note) => (field === "created" ? note.createdAt : note.updatedAt);
  return [...notes].sort((a, b) => sign * (key(a).localeCompare(key(b)) || a.id - b.id));
}

const STORAGE_KEY = "composition.noteSort";

const listeners = new Set<() => void>();
// Memory is the source of truth while the page is open, so a blocked or full storage still works.
let current: NoteSort | null = null;

function load(): NoteSort {
  if (current) return current;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    current = isNoteSort(stored) ? stored : DEFAULT_NOTE_SORT;
  } catch {
    current = DEFAULT_NOTE_SORT;
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNoteSort(sort: NoteSort): void {
  current = sort;
  try {
    window.localStorage.setItem(STORAGE_KEY, sort);
  } catch {
    // Not remembered next time.
  }
  listeners.forEach((listener) => listener());
}

/** Test hook: forget what this page has loaded, so the next read goes back to storage. */
export function resetNoteSort(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

/** The server render (and the first client render) use the default, then the stored choice takes over. */
export function useNoteSort(): NoteSort {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_NOTE_SORT);
}
