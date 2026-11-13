/**
 * The text of a PDF's pages as search keeps it (docs/architecture/search.md, "The text of a PDF"). The iPad indexes every page's
 * text so that a word only in the PDF finds the note that owns it; the desktop is to do the same with these two functions, and the
 * iPad's port (`PdfSearchText` in the Swift core) is checked against what they make of `fixtures/conformance/pdf-text.pdf`
 * (`apps/ios/scripts/pdf-text-oracle.mjs` writes `fixtures/conformance/pdf-text.json`).
 */

/** A page's text as pdf.js's `getTextContent` gives it: the items in order, with a line break after each item that ends a line. */
export function pageTextFromItems(items: ReadonlyArray<{ str?: string; hasEOL?: boolean } | object>): string {
  let text = "";
  for (const item of items) {
    if (!("str" in item)) continue; // a marked-content marker, which has no text
    text += item.str ?? "";
    if ("hasEOL" in item && item.hasEOL) text += "\n";
  }
  return text;
}

// A run of letters, then a hyphen (or a soft hyphen, or the Unicode hyphen), at the very end of a line.
const BROKEN_START = /(\p{L}+)[-­‐]$/u;
// The lowercase letters a line starts with: only a lowercase letter carries a word on (`A well-` / `Known` is two words).
const BROKEN_END = /^(\p{Ll}+)/u;

/**
 * The words of one page as they are indexed: line breaks made `\n` whatever they were, compatibility forms made plain (`ﬁ` is
 * `fi`, full-width letters are letters: NFKC), each line trimmed, soft hyphens dropped except at a line's end, empty lines dropped. A word broken over two lines with a hyphen
 * is also added whole, after the page's lines, so that `extrac-` / `tion` finds `extraction` (the two halves stay findable too).
 * A page with no text is "".
 */
export function pageSearchText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .normalize("NFKC")
    .split("\n")
    // A soft hyphen is invisible except where it breaks a line: elsewhere it is not there.
    .map((line) => line.trim().replace(/­(?!$)/gu, ""))
    .filter((line) => line !== "");
  const joined: string[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const start = BROKEN_START.exec(lines[i]);
    const end = start && BROKEN_END.exec(lines[i + 1]);
    if (start && end) joined.push(start[1] + end[1]);
  }
  return [...lines, ...(joined.length > 0 ? [joined.join(" ")] : [])].join("\n");
}
