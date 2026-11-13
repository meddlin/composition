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

/**
 * Reading a PDF's pages with pdf.js, for search (docs/architecture/search.md, "The text of a PDF"). The desktop runs `readPdfText`
 * in a utility process (apps/desktop/src/worker/pdfTextWorker.ts); `apps/ios/scripts/pdf-text-oracle.mjs` runs the same function over
 * `fixtures/conformance/pdf-text.pdf` to write the file the iPad's PDFKit reading is checked against, so the two cannot drift apart.
 *
 * pdf.js is passed in (the legacy build in Node) so that this module stays free of a particular build.
 */

/** One page as it is indexed: 0-based, the printed label when the PDF has one that is not simply the page's number, and the text. */
export type PdfTextPage = { page: number; label: string | null; text: string };

/** What reading a PDF came to. A protected PDF read without its password (or with a wrong one) is `locked`. */
export type PdfTextOutcome = { status: "pages"; pages: PdfTextPage[] } | { status: "locked" } | { status: "unreadable" };

/** The part of pdf.js this needs. */
export type PdfjsForText = {
  getDocument(source: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPageLabels(): Promise<string[] | null>;
      getPage(number: number): Promise<{ getTextContent(): Promise<{ items: object[] }>; cleanup(): unknown }>;
    }>;
    destroy(): Promise<void>;
  };
};

export type ReadOptions = {
  /** Where pdf.js's CMaps and standard fonts are, each ending in a slash (the reader's own options). */
  cMapUrl: string;
  standardFontDataUrl: string;
  /** Used for this reading only; never kept. */
  password?: string;
  /** More `getDocument` parameters: how the bytes and pdf.js's own data files are fetched where its defaults cannot (the desktop's worker). */
  extra?: Record<string, unknown>;
};

/** A page's label, kept only when it says something its number does not (a textbook's "xii", or "42" on the 44th page). */
export function pageLabel(label: string | null | undefined, index: number): string | null {
  const trimmed = label?.trim() ?? "";
  return trimmed === "" || trimmed === String(index + 1) ? null : trimmed;
}

export async function readPdfText(pdfjs: PdfjsForText, source: { data: Uint8Array } | { url: string } | { range: object }, options: ReadOptions): Promise<PdfTextOutcome> {
  const task = pdfjs.getDocument({
    ...source,
    useWasm: false,
    enableXfa: false,
    isEvalSupported: false,
    cMapUrl: options.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: options.standardFontDataUrl,
    verbosity: 0,
    ...options.extra,
    ...(options.password === undefined ? {} : { password: options.password }),
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      return { status: (error as { name?: string }).name === "PasswordException" ? "locked" : "unreadable" };
    }
    const labels = await doc.getPageLabels().catch(() => null);
    const pages: PdfTextPage[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push({ page: number - 1, label: pageLabel(labels?.[number - 1], number - 1), text: pageSearchText(pageTextFromItems(content.items)) });
      // A page's parsed resources are let go as soon as its text is read: a 600-page book would otherwise hold them all.
      page.cleanup();
    }
    return { status: "pages", pages };
  } finally {
    await task.destroy();
  }
}
