export type { Group } from "@/lib/composition/groupsRepo";
export type { Note } from "@/lib/composition/notesRepo";

import type { Note } from "@/lib/composition/notesRepo";

export function noteTitle(note: Note): string {
  return note.title.trim() || "Untitled";
}
