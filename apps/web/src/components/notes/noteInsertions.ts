/**
 * Putting Markdown into a note from outside its editor: what the PDF reader's Quote and Cite this page do. Each open editor
 * registers itself under its note's id, and `insertIntoOpenNote` hands the Markdown to it, so that it goes in at the caret
 * as typing would, in the editor the user is looking at. The two pure functions say where it goes and how it is spaced.
 */

/** A block (a quote, set apart by blank lines) or inline (a link, in the words around it). */
export type Insertion = "block" | "inline";

export type NoteInserter = (markdown: string, how: Insertion) => void;

const inserters = new Map<number, NoteInserter[]>();

/** Registers the editor of a note; returns the function that takes it back. When a note is open twice the later editor wins. */
export function registerNoteInserter(noteId: number, inserter: NoteInserter): () => void {
  inserters.set(noteId, [...(inserters.get(noteId) ?? []), inserter]);
  return () => {
    const rest = (inserters.get(noteId) ?? []).filter((i) => i !== inserter);
    if (rest.length === 0) inserters.delete(noteId);
    else inserters.set(noteId, rest);
  };
}

/** Hands the Markdown to the note's editor if one is open; false when none is, for the caller to do something else. */
export function insertIntoOpenNote(noteId: number, markdown: string, how: Insertion): boolean {
  const inserter = inserters.get(noteId)?.at(-1);
  if (!inserter) return false;
  inserter(markdown, how);
  return true;
}

/** What replaces `start..end` of a note's text, and where the caret goes (an offset into `text`, from `start`). */
export type Placement = { start: number; end: number; text: string; caret: number };

/**
 * Where Markdown goes: at the selection, but never in the frontmatter (`bodyStart` is where the note's body begins). A block
 * is set apart by one blank line before and after, so that a quote is a paragraph of its own and the text typed next is not
 * read as part of it; inline Markdown goes in as it is, after a space unless one is there already. The caret ends after it.
 */
export function placeMarkdown(text: string, selection: { start: number; end: number }, bodyStart: number, markdown: string, how: Insertion): Placement {
  const start = Math.max(bodyStart, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const before = text.slice(0, start);
  const after = text.slice(end);

  if (how === "inline") {
    const lead = start === bodyStart || /\s$/.test(before) ? "" : " ";
    const insert = `${lead}${markdown}`;
    return { start, end, text: insert, caret: insert.length };
  }

  const lead = start === bodyStart || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  // The caret is on the blank line under the block, ready to write the next paragraph.
  return { start, end, text: `${lead}${markdown}${trail}`, caret: lead.length + markdown.length + Math.max(trail.length, 1) };
}

/** A note's text with the Markdown added as a paragraph at the end, for a note that has no editor open. */
export function appendMarkdown(content: string, markdown: string): string {
  const gap = content === "" || content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${gap}${markdown}\n`;
}
