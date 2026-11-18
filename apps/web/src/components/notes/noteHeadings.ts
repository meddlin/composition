/** A heading in a note's Markdown: how deep it is (1-6), what it says, and where its line starts in the text. */
export type NoteHeading = { level: number; label: string; offset: number };

// An ATX heading: up to three spaces, 1-6 hashes, then a space (or the end of the line).
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A setext heading's underline: `===` makes the paragraph above it a level 1 heading, `---` a level 2.
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
// Lines that start something other than a paragraph, which an underline after them does not make a heading: a list
// item, a quote, an HTML or MDX block, a definition (`[x]: url`, `[^1]: note`), or a thematic break.
const NOT_PARAGRAPH = /^ {0,3}(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|>|<|\[[^\]]+\]:|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;
const INDENTED = /^(?: {4}|\t)/;
// What can cut a paragraph short (an HTML block or a link's definition can't).
const INTERRUPTS = /^ {0,3}(?:[-*+][ \t]|\d{1,9}[.)][ \t]|>|\[\^[^\]\s]+\]:|([*_])(?:[ \t]*\1){2,}[ \t]*$)/;

/** Cuts an ATX heading's optional closing hashes (`## Title ##`) and the Markdown that only styles the label. */
function labelOf(raw: string): string {
  return raw
    .replace(/[ \t]+#+$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

/**
 * The headings of `text`, in order, with the offset of each one's line. `bodyStart` is where the text after the
 * frontmatter begins; fenced code is skipped, since a `# comment` in it is not a heading.
 *
 * Both kinds of heading count: `# Title` (ATX) and a paragraph underlined with `===` or `---` (setext), whose offset
 * is its first line's and whose label is its lines joined by spaces, as Preview reads it. A setext heading is only
 * found after a paragraph at the top level, not in a list item or a quote (where Preview makes the `---` a rule).
 */
export function extractHeadings(text: string, bodyStart = 0): NoteHeading[] {
  const headings: NoteHeading[] = [];
  let fence: string | null = null;
  // What the lines since the last blank one are: a paragraph (where it starts, and its lines), or something else.
  let paragraph: { offset: number; lines: string[] } | null = null;
  let other = false;
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart < bodyStart) continue;

    const opening = FENCE.exec(line);
    if (fence !== null) {
      // A fence closes on the same character, at least as long, with nothing after it.
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && line.trim() === opening[1]) fence = null;
      continue;
    }
    if (opening) {
      fence = opening[1];
      paragraph = null;
      other = false;
      continue;
    }

    if (line.trim() === "") {
      paragraph = null;
      other = false;
      continue;
    }

    const underline = paragraph && UNDERLINE.exec(line);
    if (paragraph && underline) {
      headings.push({ level: underline[1][0] === "=" ? 1 : 2, label: labelOf(paragraph.lines.join(" ")), offset: paragraph.offset });
      paragraph = null;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      headings.push({ level: heading[1].length, label: labelOf(heading[2] ?? ""), offset: lineStart });
      paragraph = null;
      other = false;
      continue;
    }

    if (paragraph) {
      // A list, quote or the like can interrupt a paragraph; anything else carries it on.
      if (INTERRUPTS.test(line)) {
        paragraph = null;
        other = true;
      } else paragraph.lines.push(line.trim());
    } else if (!other) {
      // Indented code can't start a paragraph; nothing in a list item or a quote is one at the top level.
      if (NOT_PARAGRAPH.test(line) || INDENTED.test(line)) other = true;
      else paragraph = { offset: lineStart, lines: [line.trim()] };
    } else if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {
      // A rule ends a list or a quote.
      other = false;
    }
  }
  return headings;
}
