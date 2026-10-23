import { DIAGRAM_ALT } from "@/lib/composition/drawio";
import { imageRef } from "@/lib/composition/imageRefs";
import { insideFence } from "./completions";

/** Cmd+Shift+D on macOS, Ctrl+Shift+D elsewhere; `aria-keyshortcuts` says the same. */
export const DRAWIO_SHORTCUT = "Control+Shift+D Meta+Shift+D";

export function isDrawioShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "d" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

/** `<Drawio src="app_data/…" alt="Diagram" />` for a stored diagram. */
export function diagramTag(name: string, alt: string = DIAGRAM_ALT): string {
  // The tag is note text (MDX source), never HTML a browser parses; `name` is a stored image's file name, which
  // can't hold a quote or angle bracket, and the alt text has them taken out.
  // nosemgrep: html-in-template-string
  return `<Drawio src="${imageRef(name)}" alt="${alt.replace(/["<>&]/g, " ")}" />`;
}

/**
 * Where a new diagram goes, given the editor's selection and where the note's body starts (after its
 * frontmatter). A selection that reaches into the frontmatter, which is all an editor that was never
 * clicked in has (the caret at 0), isn't a choice of place, and the metadata is never replaced: the
 * diagram goes at the end of the note.
 */
export function diagramRange(text: string, start: number, end: number, bodyStart: number): { start: number; end: number } {
  return start >= bodyStart ? { start, end } : { start: text.length, end: text.length };
}

export type DiagramInsertion = { start: number; end: number; text: string; caret: number };

/**
 * What to put in the note, replacing `[start, end)`, for a new diagram: the tag on a line of its own
 * (blank lines around it, so it stands as a block and the paragraph beside it is left alone), with the
 * caret after it, ready to carry on writing.
 */
export function insertDiagram(text: string, start: number, end: number, name: string): DiagramInsertion {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = start === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || !after.startsWith("\n") ? "\n\n" : after.startsWith("\n\n") ? "" : "\n";
  const inserted = lead + diagramTag(name) + trail;
  return { start, end, text: inserted, caret: inserted.length };
}

// A `<Drawio …>` or `<Drawio … />` tag, reading quoted values whole, so a `>` in an alt text doesn't end it.
const DRAWIO_TAG = /<Drawio(?=[\s/>])(?:"[^"]*"|'[^']*'|[^>"'])*>/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The note with every `<Drawio>` tag that shows stored image `from` now showing `to`: what saving a
 * changed diagram does, since an edited picture is a new file (a name embeds a hash of its bytes). A
 * tag in a fenced code block is an example of one, and is left alone, as is every other kind of
 * reference to the old file.
 */
export function replaceDiagramSrc(text: string, from: string, to: string): string {
  // `from` is escaped, so it can only match itself: nothing it holds can make the pattern run away (ReDoS).
  // nosemgrep: detect-non-literal-regexp
  const src = new RegExp(`(["'])((?:\\./)?app_data/)${escapeRegExp(from)}\\1`);
  return text.replace(DRAWIO_TAG, (tag, offset: number) => {
    if (insideFence(text, text.lastIndexOf("\n", offset - 1) + 1)) return tag;
    return tag.replace(src, (_all, quote: string, dir: string) => `${quote}${dir}${to}${quote}`);
  });
}
