import { Children, type ReactNode } from "react";

/**
 * The footnotes of the note it's in, as a numbered list with a ↩ link back to
 * where each is cited. Written in a note as `<Footnotes />`, wherever the list
 * should go (usually the last line).
 *
 * The list is the one Markdown's `[^label]` syntax produces, handed in as the
 * children by rehypeFootnotes: it is numbered by the order the notes are cited
 * in, so it follows edits with no upkeep.
 */
export function Footnotes({ children }: { children?: ReactNode }) {
  return (
    <section
      aria-label="Footnotes"
      className="not-prose my-6 border-t border-border pt-3 text-sm [&_a]:text-brand [&_li]:my-1 [&_ol]:m-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0"
    >
      {Children.count(children) > 0 ? children : <p className="m-0 text-muted-foreground">No footnotes yet.</p>}
    </section>
  );
}
