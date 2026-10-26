import { strip } from "@/lib/composition/frontmatter";
import type { Favorites } from "@/lib/composition/favorites";
import type { RecentSort } from "@/lib/composition/home";
import type { Group, Note, Notebook } from "./types";

export const RECENT_NOTE_LIMIT = 12;

type RecentOptions = {
  sort?: RecentSort;
  /** When each note was last opened, in milliseconds; read for the "opened" order. */
  opened?: Record<number, number>;
  /** Only the notes of this notebook; all of them when absent. */
  notebookId?: number | null;
};

const byEdited = (a: Note, b: Note) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id;

/**
 * The most recent notes, newest first: by the last edit, or by the last time they were opened. A note
 * that was never opened comes after every one that was, in order of its last edit.
 */
export function recentNotes(notes: Note[], limit = RECENT_NOTE_LIMIT, options: RecentOptions = {}): Note[] {
  const { sort = "edited", opened = {}, notebookId = null } = options;
  const pool = notebookId === null ? [...notes] : notes.filter((n) => n.notebookId === notebookId);
  if (sort === "edited") return pool.sort(byEdited).slice(0, limit);
  return pool
    .sort((a, b) => {
      const x = opened[a.id];
      const y = opened[b.id];
      if (x !== undefined && y !== undefined) return y - x || byEdited(a, b);
      if (x !== undefined) return -1;
      if (y !== undefined) return 1;
      return byEdited(a, b);
    })
    .slice(0, limit);
}

/** One thing pinned to the top of the home page. */
export type PinnedItem =
  | { kind: "notebook"; notebook: Notebook }
  | { kind: "group"; group: Group }
  | { kind: "note"; note: Note };

/**
 * What is pinned: the notebooks first, in the order they were pinned, then the notes and groups in the order
 * they were pinned. A pin whose notebook, group or note is gone is skipped.
 */
export function pinnedItems(
  notebooks: Notebook[],
  groups: Group[],
  notes: Note[],
  favorites: Favorites,
  pinnedNotebooks: number[],
): PinnedItem[] {
  const notebookById = new Map(notebooks.map((n) => [n.id, n]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const items: PinnedItem[] = [];
  for (const id of pinnedNotebooks) {
    const notebook = notebookById.get(id);
    if (notebook) items.push({ kind: "notebook", notebook });
  }
  for (const favorite of favorites) {
    if (favorite.type === "group") {
      const group = groupById.get(favorite.id);
      if (group) items.push({ kind: "group", group });
    } else {
      const note = noteById.get(favorite.id);
      if (note) items.push({ kind: "note", note });
    }
  }
  return items;
}

/** A one-line plain-text preview of a note's body: no frontmatter, headings or markup. */
export function noteExcerpt(content: string, max = 110): string {
  const text = strip(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+\.)\s+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** "just now", "5 min ago", "3 days ago"; older than a month falls back to the date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
