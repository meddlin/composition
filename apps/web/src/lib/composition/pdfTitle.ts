import { pdfTitleFromFileName } from "./documentNames";

/**
 * The title a PDF gives itself (docs/pdf-markup-plan.md, P16). A note made for an imported PDF starts with a title read
 * from the file's name; when the reader first opens the file it may replace that with the PDF's own, if the PDF has one
 * worth showing and the user has not already renamed the note. Pure, so the rules are tested apart from pdf.js.
 */

/** The longest title taken: a PDF whose "title" is a paragraph (an abstract pasted into the field) has not given a title. */
export const MAX_PDF_TITLE_LENGTH = 200;

/** What a word processor or exporter writes when nobody gave the document a title. Compared in lower case, whole. */
const PLACEHOLDERS = new Set([
  "untitled",
  "untitled document",
  "title",
  "document",
  "new document",
  "unknown",
  "unnamed",
  "none",
  "null",
  "undefined",
  "(anonymous)",
  "(untitled)",
  "pdf",
  "powerpoint presentation",
  "presentation",
  "slide 1",
  "page 1",
]);

/** Numbered placeholders: "Document1", "Untitled 2", "Layout 1", "Microsoft Word - Report.docx" and the like. */
const PLACEHOLDER_PATTERNS = [/^(untitled|document|doc|layout|slide|page|sheet|book)\s*\d+$/i, /^microsoft (word|excel|powerpoint) - /i];

/** A file name in the title field: the tool that made the PDF put the source file's name there. */
const FILE_NAME = /\.(pdf|docx?|dotx?|rtf|odt|txt|tex|indd|pptx?|xlsx?|pages|key|numbers|ps|dvi|html?)$/i;

/** Characters that mean the title was read in the wrong encoding (pdf.js's own viewer refuses them too). */
const GARBLED = /[\uFFF0-\uFFFF]/;

/**
 * The title if it is one: a string with letters or digits in it, one line of at most 200 characters, that is not a
 * placeholder, a file name or garbled text; or null. Control characters and runs of spaces are cleaned up first.
 */
export function sensiblePdfTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (title === "" || title.length > MAX_PDF_TITLE_LENGTH) return null;
  if (GARBLED.test(title) || !/[\p{L}\p{N}]/u.test(title)) return null;
  if (PLACEHOLDERS.has(title.toLowerCase()) || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(title)) || FILE_NAME.test(title)) return null;
  return title;
}

/**
 * The PDF's title from what pdf.js reads: the XMP metadata's `dc:title` first, then the Info dictionary's `Title`, as pdf.js's
 * own viewer orders them (XMP is the newer record and tools keep it better). A field that is not a sensible title is passed
 * over for the next; null when neither is.
 */
export function pdfOwnTitle(found: { xmpTitle?: unknown; infoTitle?: unknown }): string | null {
  return sensiblePdfTitle(found.xmpTitle) ?? sensiblePdfTitle(found.infoTitle);
}

/**
 * The title to give a PDF's note now, or null to leave it. Only a note that still has the title made from the file's
 * name is retitled, so a title the user changed is never replaced (and, once the note has the PDF's own title, nothing
 * is left to do). `fileName` is the name the PDF was imported as.
 */
export function retitleFromPdf(options: { currentTitle: string; fileName: string; pdfTitle: string | null }): string | null {
  const { currentTitle, fileName, pdfTitle } = options;
  if (pdfTitle === null) return null;
  if (currentTitle.trim() !== pdfTitleFromFileName(fileName)) return null;
  return pdfTitle === currentTitle.trim() ? null : pdfTitle;
}
