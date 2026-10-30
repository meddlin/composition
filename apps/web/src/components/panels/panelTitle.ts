import { noteTitle, type Note } from "../notes/types";
import { noteIdOf } from "./kinds";
import type { PanelRecord } from "./panelsState";

/** What a window of panels is called while this panel is the one in front: the note's title, or what the panel is. */
export function panelTitle(panel: PanelRecord | undefined, notes: readonly Note[], deleted: readonly Note[]): string {
  if (!panel) return "Composition";
  if (panel.kind === "notes-browser") return "Notes browser";
  if (panel.kind === "ai") return "AI helper";
  if (panel.kind === "todo") return "To-do";
  if (panel.kind === "reading-list") return "Reading List";
  const noteId = noteIdOf(panel);
  const note = noteId === null ? undefined : [...notes, ...deleted].find((n) => n.id === noteId);
  return note ? noteTitle(note) : panel.kind === "note" ? "Note" : "Composition";
}
