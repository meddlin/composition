/**
 * How a note's Markdown points at another note. Pure string handling, like
 * imageRefs.ts, so the renderer and the editor can both import it.
 *
 * A link to a note is ordinary Markdown whose target is `note:<id>`:
 *
 *   [Release checklist](note:42)
 *
 * The id, not the title, is what the link follows: titles are not unique and
 * can be renamed, ids neither repeat nor change (a note restored from the Trash
 * Can keeps its id too).
 */

/** The scheme in a link's target. */
export const NOTE_REF_SCHEME = "note:";

const NOTE_REF = /^note:(\d+)$/;

/** The Markdown target for a note's id. */
export function noteRef(id: number): string {
  return `${NOTE_REF_SCHEME}${id}`;
}

/** The note id a link target refers to, or null when it isn't a note link. */
export function noteIdFromRef(href: string): number | null {
  const match = NOTE_REF.exec(href);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/** Link text is bracketed, so a bracket or backslash in it has to be escaped; a line break would split the link. */
function escapeLinkText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\[\]]/g, "\\$&");
}

/** `[label](note:id)`, ready to put into a note. */
export function noteLink(label: string, id: number): string {
  return `[${escapeLinkText(label.trim() || "Untitled")}](${noteRef(id)})`;
}
