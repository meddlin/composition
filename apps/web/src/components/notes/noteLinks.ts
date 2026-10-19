import { noteLink } from "@/lib/composition/noteRefs";
import { insideFence } from "./mdx/completions";
import { noteTitle, type Note } from "./types";

/** How many notes the picker lists at once. */
export const MAX_PICKER_NOTES = 8;

export type NoteLinkTrigger = {
  /** Where the `[[` is. */
  start: number;
  /** What has been typed after it. */
  query: string;
};

/** `[[` and what follows it up to the caret, with no bracket or line break in between. */
const OPEN_LINK = /\[\[([^[\]\n]*)$/;

/**
 * The `[[` the caret is just after, if the user is starting a note link there.
 * Nothing is offered inside a fenced code block, where `[[` is just text.
 */
export function findNoteTrigger(text: string, caret: number): NoteLinkTrigger | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const match = OPEN_LINK.exec(text.slice(lineStart, caret));
  if (!match || insideFence(text, lineStart)) return null;
  return { start: caret - match[1].length - 2, query: match[1] };
}

/**
 * The notes the picker offers for what was typed: those whose title contains
 * it (ignoring case), the ones that start with it first. `excludeId` is the
 * note being edited, which there is no point linking to.
 */
export function matchNotes(notes: readonly Note[], query: string, excludeId?: number): Note[] {
  const typed = query.trim().toLowerCase();
  const starts: Note[] = [];
  const contains: Note[] = [];
  for (const note of notes) {
    if (note.id === excludeId) continue;
    const at = noteTitle(note).toLowerCase().indexOf(typed);
    if (at === 0) starts.push(note);
    else if (at > 0) contains.push(note);
  }
  return [...starts, ...contains].slice(0, MAX_PICKER_NOTES);
}

/** The Markdown to insert for `note`; `label` is the words the link should show, the note's title when absent. */
export function linkTo(note: Note, label?: string): string {
  return noteLink(label?.trim() || noteTitle(note), note.id);
}
