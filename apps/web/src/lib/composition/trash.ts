/**
 * What the Trash Can holds and how long it holds it. Pure data and arithmetic,
 * so the UI and the data layer share one definition of the retention window.
 */

/** Items older than this are permanently deleted. */
export const TRASH_RETENTION_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrashedNote = {
  id: number;
  title: string;
  deletedAt: string;
  /** When the Trash Can will delete it for good. */
  expiresAt: string;
};

export type TrashedGroup = {
  id: number;
  name: string;
  deletedAt: string;
  expiresAt: string;
};

/** Everything in the Trash Can, most recently deleted first. */
export type Trash = {
  notes: TrashedNote[];
  groups: TrashedGroup[];
};

export const EMPTY_TRASH: Trash = { notes: [], groups: [] };

export function expiryOf(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}

/** Whole days until `expiresAt` (rounded up, so "0" never shows while it still exists). */
export function daysLeft(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS));
}

/** The `deleted_at` before which an item has outlived the retention window. */
export function retentionCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS).toISOString();
}

/** `restoredToTopLevel`: the item's original group/parent is gone, so it came back at the top. */
export type RestoreResult = { error?: string; restoredToTopLevel?: boolean };
