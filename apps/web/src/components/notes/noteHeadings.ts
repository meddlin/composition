/** A heading in a note's Markdown: how deep it is (1-6), what it says, and where its line starts in the text. */
export type NoteHeading = { level: number; label: string; offset: number };

// An ATX heading: up to three spaces, 1-6 hashes, then a space (or the end of the line). Setext headings are not counted.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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
 */
export function extractHeadings(text: string, bodyStart = 0): NoteHeading[] {
  const headings: NoteHeading[] = [];
  let fence: string | null = null;
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
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) headings.push({ level: heading[1].length, label: labelOf(heading[2] ?? ""), offset: lineStart });
  }
  return headings;
}
