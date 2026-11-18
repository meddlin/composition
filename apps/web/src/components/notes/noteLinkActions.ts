import { noteIdFromRef } from "@/lib/composition/noteRefs";
import { parsePdfRef, type PdfRef } from "@/lib/composition/pdfRefs";
import { extractHeadings } from "./noteHeadings";
import { slugify } from "./mdx/remarkHeadings";

/**
 * What following a link in a note does, shared by the preview (`NoteAnchor`) and the Live editor (`liveLinks`), so
 * the two never disagree about where a link goes or whether it is dead. No React and no CodeMirror here: each view
 * reads the click its own way and hands the target to `followLink`.
 */

/** What a note's `pdf:` links need: only the desktop app has PDFs, so elsewhere every such link is shown as dead. */
export type PdfLinks = {
  /** Whether the PDF is on this device and its note is not in the Trash Can. */
  exists: (uuid: string) => boolean;
  /** Shows the page, and the mark, the link names, opening the PDF beside the note if it is not showing. */
  open: (ref: PdfRef) => void;
};

export type NoteLinks = {
  /** Whether the note still exists; a link to one that was deleted for good is shown as dead. */
  exists: (noteId: number) => boolean;
  /** Opens the note; `beside` asks for it next to the one being read rather than in its place. */
  open: (noteId: number, beside: boolean) => void;
  pdf?: PdfLinks;
};

/** Links that go nowhere: what a view has before the app around it says otherwise. */
export const NO_NOTE_LINKS: NoteLinks = { exists: () => true, open: () => {} };

/** Where a link's target points. */
export type LinkTarget =
  | { kind: "note"; noteId: number }
  | { kind: "pdf"; ref: PdfRef }
  /** A place in the note itself, `#id` (what footnotes and hand-written links to a heading use). */
  | { kind: "fragment"; id: string }
  /** Anything else: a web address, an email, or a scheme the app does not follow itself. */
  | { kind: "other"; href: string };

export function linkTarget(href: string): LinkTarget {
  const noteId = noteIdFromRef(href);
  if (noteId !== null) return { kind: "note", noteId };
  const ref = parsePdfRef(href);
  if (ref) return { kind: "pdf", ref };
  if (href.startsWith("#")) return { kind: "fragment", id: href.slice(1) };
  return { kind: "other", href };
}

/** Why a link goes nowhere (said as its tooltip), or null when it is alive. */
export function deadLink(target: LinkTarget, links: NoteLinks): string | null {
  if (target.kind === "note" && !links.exists(target.noteId)) return "This note no longer exists";
  if (target.kind === "pdf" && !links.pdf?.exists(target.ref.uuid)) return "PDF not on this device";
  return null;
}

/** The web address a link may be opened at in a new tab or the browser, or null for any other scheme (`javascript:`, say). */
export function webHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

export type FollowOptions = {
  /** Open a note next to the one being read rather than in its place. */
  beside: boolean;
  /** Scrolls the view to `#id` in the note it shows. */
  scrollTo: (id: string) => void;
  /** Opens a web address. Left out by the preview, whose `<a>` lets the browser follow it. */
  openWeb?: (href: string) => void;
};

/**
 * Follows a link: opens the note (beside, if asked), shows the PDF's page, scrolls to the `#id`, or opens the web
 * address. A dead link does nothing. Returns whether it was handled here, so the caller knows to stop the browser's
 * own following.
 */
export function followLink(target: LinkTarget, links: NoteLinks, { beside, scrollTo, openWeb }: FollowOptions): boolean {
  if (deadLink(target, links)) return true;
  switch (target.kind) {
    case "note":
      links.open(target.noteId, beside);
      return true;
    case "pdf":
      links.pdf?.open(target.ref);
      return true;
    case "fragment":
      scrollTo(target.id);
      return true;
    case "other": {
      const web = webHref(target.href);
      if (!web || !openWeb) return false;
      openWeb(web);
      return true;
    }
  }
}

/** Opens a web address in a new tab (the desktop app hands it to the system's browser). */
export function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

/** A footnote's definition (`fn-1`) or its first reference (`fnref-1`), as remark-gfm names their ids. */
const FOOTNOTE_ID = /^(?:user-content-)?fn(ref)?-(.+)$/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where in a note's Markdown `#id` points: the line of the heading the preview gives that id (the same slug as
 * `remarkHeadings`, `-1`, `-2` after a repeat), or a footnote's definition or reference. Null when nothing has it.
 */
export function fragmentOffset(text: string, id: string, bodyStart = 0): number | null {
  let wanted = id;
  try {
    wanted = decodeURIComponent(id);
  } catch {
    // Not percent-encoded after all; looked up as written.
  }
  const taken = new Set<string>();
  for (const heading of extractHeadings(text, bodyStart)) {
    const base = slugify(heading.label);
    let slug = base;
    for (let n = 1; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    if (slug === wanted) return heading.offset;
  }
  const footnote = FOOTNOTE_ID.exec(wanted);
  if (footnote) {
    const label = escapeRegExp(footnote[2]);
    const found = new RegExp(footnote[1] ? `\\[\\^${label}\\](?!:)` : `^ {0,3}\\[\\^${label}\\]:`, "m").exec(text.slice(bodyStart));
    if (found) return bodyStart + found.index;
  }
  return null;
}
