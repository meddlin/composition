import { createContext, useContext, type ComponentPropsWithoutRef } from "react";
import { defaultUrlTransform, type ExtraProps, type Options } from "react-markdown";
import { noteIdFromRef } from "@/lib/composition/noteRefs";

export type NoteLinks = {
  /** Whether the note still exists; a link to one that was deleted for good is shown as dead. */
  exists: (noteId: number) => boolean;
  /** Opens the note; `beside` asks for it next to the one being read rather than in its place. */
  open: (noteId: number, beside: boolean) => void;
};

const NoteLinksContext = createContext<NoteLinks>({ exists: () => true, open: () => {} });

/** What the preview's note links need from the app around it, handed down without threading it through Markdown. */
export const NoteLinksProvider = NoteLinksContext.Provider;

/**
 * react-markdown drops the target of any link whose scheme it doesn't know,
 * which would turn `note:42` into an empty link; note links are let through.
 */
export const noteUrlTransform: NonNullable<Options["urlTransform"]> = (url) =>
  noteIdFromRef(url) === null ? defaultUrlTransform(url) : url;

/**
 * The preview's rendering of Markdown links, `[text](target)`. Wired in through
 * react-markdown's `components` map (see `markdownComponents`).
 *
 * A `note:<id>` target opens that note in the app, or beside this one with
 * Cmd/Ctrl held; one whose note is gone is shown as dead text. Any other link
 * is left as written.
 */
export function NoteAnchor({ href, title, children }: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const links = useContext(NoteLinksContext);
  const noteId = href ? noteIdFromRef(href) : null;

  if (noteId === null) {
    return (
      <a href={href} title={title}>
        {children}
      </a>
    );
  }
  if (!links.exists(noteId)) {
    return (
      <span title="This note no longer exists" className="text-muted-foreground line-through">
        {children}
      </span>
    );
  }
  return (
    // A fragment target rather than `note:…`, so opening it in a new tab or window lands on this page.
    <a
      href={`#note-${noteId}`}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        links.open(noteId, event.metaKey || event.ctrlKey);
      }}
    >
      {children}
    </a>
  );
}
