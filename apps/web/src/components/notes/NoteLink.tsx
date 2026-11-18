import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import { defaultUrlTransform, type ExtraProps, type Options } from "react-markdown";
import { noteIdFromRef } from "@/lib/composition/noteRefs";
import { parsePdfRef } from "@/lib/composition/pdfRefs";
import { deadLink, followLink, linkTarget, NO_NOTE_LINKS, type NoteLinks } from "./noteLinkActions";

export type { NoteLinks, PdfLinks } from "./noteLinkActions";

const NoteLinksContext = createContext<NoteLinks>(NO_NOTE_LINKS);

/** What the preview's note links need from the app around it, handed down without threading it through Markdown. */
export const NoteLinksProvider = NoteLinksContext.Provider;

/**
 * react-markdown drops the target of any link whose scheme it doesn't know,
 * which would turn `note:42` into an empty link; note links, and the `pdf:` links
 * that cite a PDF, are let through.
 */
export const noteUrlTransform: NonNullable<Options["urlTransform"]> = (url) =>
  noteIdFromRef(url) === null && parsePdfRef(url) === null ? defaultUrlTransform(url) : url;

function withoutNode({ node, ...attributes }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  void node;
  return attributes;
}

function scrollToId(id: string) {
  // The id lives in the page, not the address bar: a hash change would leave the note in the desktop app.
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

/**
 * The preview's rendering of Markdown links, `[text](target)`. Wired in through
 * react-markdown's `components` map (see `markdownComponents`). What a link does
 * is `followLink`'s, which the Live editor shares.
 *
 * A `note:<id>` target opens that note in the app, or beside this one with
 * Cmd/Ctrl held (with or without Shift, which is beside in Live); one whose note
 * is gone is shown as dead text. A `pdf:<uuid>` target shows the page or mark it
 * names in the PDF's panel; one whose PDF is not on this device is dead text too,
 * and the words in the note still read. Any other link is left as written, except
 * that one to a place in the note itself (`#id`, which is what footnotes use)
 * scrolls there rather than changing the address.
 */
export function NoteAnchor({ href, title, children, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const links = useContext(NoteLinksContext);
  const target = linkTarget(href ?? "");
  const dead = deadLink(target, links);

  if (dead) {
    return (
      <span title={dead} className="text-muted-foreground line-through">
        {children}
      </span>
    );
  }
  if (target.kind === "other" || target.kind === "fragment") {
    return (
      // What react-markdown adds to a link besides these (a footnote's id, say) is kept; its `node` is not an attribute.
      <a
        href={href}
        title={title}
        {...withoutNode(props)}
        onClick={
          target.kind === "fragment"
            ? (event) => {
                if (followLink(target, links, { beside: false, scrollTo: scrollToId })) event.preventDefault();
              }
            : undefined
        }
      >
        {children}
      </a>
    );
  }
  return (
    // A fragment target rather than `note:…` or `pdf:…`, so opening it in a new tab or window lands on this page.
    <a
      href={target.kind === "note" ? `#note-${target.noteId}` : `#pdf-${target.ref.uuid}`}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        followLink(target, links, { beside: event.metaKey || event.ctrlKey, scrollTo: scrollToId });
      }}
    >
      {children}
    </a>
  );
}
