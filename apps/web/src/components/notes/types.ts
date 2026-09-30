export type { Group } from "@/lib/composition/groupsRepo";
export type { Note } from "@/lib/composition/notesRepo";

import type { Note } from "@/lib/composition/notesRepo";

export function noteTitle(note: Note): string {
  return note.title.trim() || "Untitled";
}

/**
 * Merge a server-saved note into local state, keeping the local `content`.
 * The server re-renders the frontmatter (fresh `updatedAt`), so its content
 * never matches the textarea; applying it would reset the caret to the end,
 * and would clobber anything typed while the save was in flight.
 */
export function applySavedNote(notes: Note[], saved: Note): Note[] {
  return notes.map((n) => (n.id === saved.id ? { ...saved, content: n.content } : n));
}
