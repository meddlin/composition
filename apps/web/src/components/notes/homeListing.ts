import { strip } from "@/lib/composition/frontmatter";
import type { Note } from "./types";

export const RECENT_NOTE_LIMIT = 12;

/** The most recently updated notes, newest first. */
export function recentNotes(notes: Note[], limit = RECENT_NOTE_LIMIT): Note[] {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id).slice(0, limit);
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
