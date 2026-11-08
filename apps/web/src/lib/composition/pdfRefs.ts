/**
 * How a note's Markdown points at a PDF, a page of it, or a mark on it. Pure string handling, like noteRefs.ts, so the
 * renderer, the editor and the main process (which scans notes for the ones that cite a PDF) can all import it.
 *
 * A citation is ordinary Markdown whose target is `pdf:<uuid>`, optionally followed by a fragment:
 *
 *   [*Designing Data*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
 *
 * The document is named by its uuid, not its id, so that sync never has to rewrite a note. `p` is the physical page,
 * counted from 1; the words in the brackets show the printed page label when the PDF has one. `a` is a mark's uuid, and
 * both are optional: a link to the whole PDF has no fragment.
 */

import type { PdfCitation } from "./documentsApi";

/** The scheme in a link's target. */
export const PDF_REF_SCHEME = "pdf:";

/** What a `pdf:` target names: the PDF, and optionally a page (from 1) and a mark. */
export type PdfRef = { uuid: string; page: number | null; mark: string | null };

const UUID = "[0-9a-f]{32}";
const PDF_REF = new RegExp(`^pdf:(${UUID})(?:#(.*))?$`);
const PDF_REF_ANYWHERE = new RegExp(`pdf:(${UUID})(?:#([^\\s)]*))?`, "g");
const MARK_UUID = new RegExp(`^${UUID}$`);

/** The Markdown target for a PDF, with the page and mark when there are any. */
export function pdfRef(uuid: string, at: { page?: number | null; mark?: string | null } = {}): string {
  const parts: string[] = [];
  if (at.page != null) parts.push(`p=${at.page}`);
  if (at.mark != null) parts.push(`a=${at.mark}`);
  return `${PDF_REF_SCHEME}${uuid}${parts.length > 0 ? `#${parts.join("&")}` : ""}`;
}

/** The page and mark of a fragment; a part that is not a page or a mark's uuid is dropped, and so is a key nobody knows. */
function parseFragment(fragment: string | undefined): Pick<PdfRef, "page" | "mark"> {
  let page: number | null = null;
  let mark: string | null = null;
  for (const part of (fragment ?? "").split("&")) {
    const [key, value] = part.split("=");
    if (key === "p" && /^[1-9]\d{0,6}$/.test(value ?? "")) page = Number(value);
    else if (key === "a" && MARK_UUID.test(value ?? "")) mark = value;
  }
  return { page, mark };
}

/** What a link target names, or null when it is not a `pdf:` link. */
export function parsePdfRef(href: string): PdfRef | null {
  const match = PDF_REF.exec(href);
  if (!match) return null;
  return { uuid: match[1], ...parseFragment(match[2]) };
}

/** Markdown's own punctuation, and the characters MDX reads as the start of a tag or an expression, made literal. */
const SPECIAL = /[\\`*_{}[\]<>~|]/g;

/** Text from a PDF made safe to put into a note: it shows as itself and starts nothing (a tag, emphasis, a heading, a list). */
export function escapeMarkdown(text: string): string {
  return text.replace(SPECIAL, "\\$&").replace(/^(\s*)([#+-]|\d+[.)])(?=\s|$)/, "$1\\$2");
}

/** The page as a reader names it: the printed label when the PDF has one, else the physical number. */
export function pageLabel(page: number, labels: readonly string[] | null | undefined): string {
  const label = labels?.[page - 1];
  return label && label.trim() !== "" ? label.trim() : String(page);
}

/** What a citation of a page says: `Title, p. 42`, with the title in italics. */
function citationText(title: string, page: number, labels: readonly string[] | null | undefined): string {
  const name = title.replace(/\s+/g, " ").trim();
  return `${name === "" ? "" : `*${escapeMarkdown(name)}*, `}p. ${escapeMarkdown(pageLabel(page, labels))}`;
}

/** `[Title](pdf:…)`, a link to the whole PDF, for the first line of a note made for it. */
export function pdfLink(doc: { uuid: string; title: string }): string {
  const name = doc.title.replace(/\s+/g, " ").trim();
  return `[${escapeMarkdown(name === "" ? "PDF" : name)}](${pdfRef(doc.uuid)})`;
}

/** `[Title, p. 42](pdf:…#p=44)`, ready to put into a note. */
export function pageCitation(doc: { uuid: string; title: string }, page: number, labels?: readonly string[] | null): string {
  return `[${citationText(doc.title, page, labels)}](${pdfRef(doc.uuid, { page })})`;
}

/**
 * A quote from a PDF as a block quote with its citation:
 *
 *   > The selected text.
 *   >
 *   > — [*Title*, p. 42](pdf:…#p=44&a=…)
 *
 * The empty quoted line makes the citation a paragraph of its own: consecutive quoted lines are one paragraph, and the
 * preview would run the citation on after the words. The words are copied in, so the note still reads when the PDF is gone.
 */
export function quoteBlock(doc: { uuid: string; title: string }, quote: string, page: number, mark: string | null, labels?: readonly string[] | null): string {
  const words = quote.replace(/\s+/g, " ").trim();
  const cite = `[${citationText(doc.title, page, labels)}](${pdfRef(doc.uuid, { page, mark })})`;
  return `${words === "" ? "" : `> ${escapeMarkdown(words)}\n>\n`}> — ${cite}`;
}

/** What the notes that cite a PDF say of it, found by reading their text. */
export type Citations = { pages: number[]; marks: string[] };

/** The pages and marks of `uuid` that a note's text cites, each once, in the order they first appear. */
export function citationsOf(text: string, uuid: string): Citations {
  const pages: number[] = [];
  const marks: string[] = [];
  for (const match of text.matchAll(PDF_REF_ANYWHERE)) {
    if (match[1] !== uuid) continue;
    const { page, mark } = parseFragment(match[2]);
    if (page !== null && !pages.includes(page)) pages.push(page);
    if (mark !== null && !marks.includes(mark)) marks.push(mark);
  }
  return { pages, marks };
}

/** The notes that belong with a PDF, as `citationsFor` reads them. */
type NoteText = { id: number; title: string; content: string; updatedAt: string };

/**
 * The notes that belong with a PDF: its owner first (whether or not its text links to it), then every other note whose text
 * does, the most recently changed first, each with the pages and marks its links name. Notes record no links, so this reads
 * their text; the reader asks it of the notes already in memory, so it follows what is typed at once.
 */
export function citationsFor(notes: readonly NoteText[], doc: { uuid: string; noteId: number }): PdfCitation[] {
  const found: PdfCitation[] = [];
  for (const note of notes) {
    const owner = note.id === doc.noteId;
    if (!owner && !citesPdf(note.content, doc.uuid)) continue;
    found.push({ noteId: note.id, title: note.title, owner, ...citationsOf(note.content, doc.uuid) });
  }
  const changed = new Map(notes.map((n) => [n.id, n.updatedAt]));
  const byRecent = (a: PdfCitation, b: PdfCitation) => (changed.get(b.noteId) ?? "").localeCompare(changed.get(a.noteId) ?? "") || b.noteId - a.noteId;
  return [...found.filter((c) => c.owner), ...found.filter((c) => !c.owner).sort(byRecent)];
}

/** Whether a note's text cites the PDF at all. */
export function citesPdf(text: string, uuid: string): boolean {
  return text.includes(`${PDF_REF_SCHEME}${uuid}`);
}
