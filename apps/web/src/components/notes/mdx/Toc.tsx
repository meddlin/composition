import type { MouseEvent } from "react";
import { HEADINGS_PROP, type TocHeading } from "./remarkHeadings";

type Props = {
  /** Set by remarkHeadings; a note can't supply it. */
  [HEADINGS_PROP]?: string;
  /** Deepest heading level to list, 1–6. Default 6 (all of them). */
  maxDepth?: string;
};

type Entry = TocHeading & { children: Entry[] };

function parseHeadings(json: string | undefined): TocHeading[] {
  try {
    const parsed: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Nests each heading under the closest one above it that is shallower, so `h1, h3, h2` gives the h3 and h2 an h1 parent. */
function nest(headings: TocHeading[]): Entry[] {
  const roots: Entry[] = [];
  const open: Entry[] = [];
  for (const heading of headings) {
    const entry = { ...heading, children: [] };
    while (open.length && open[open.length - 1].depth >= heading.depth) open.pop();
    (open[open.length - 1]?.children ?? roots).push(entry);
    open.push(entry);
  }
  return roots;
}

function scrollToHeading(event: MouseEvent, id: string) {
  // The id lives in the page, not the address bar: a hash change would leave the note in the desktop app.
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

function List({ entries }: { entries: Entry[] }) {
  return (
    <ul className="m-0 list-none space-y-1 p-0 [&_ul]:mt-1 [&_ul]:pl-4">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={(event) => scrollToHeading(event, entry.id)}
            className="text-brand no-underline hover:underline"
          >
            {entry.text}
          </a>
          {entry.children.length > 0 && <List entries={entry.children} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * A table of contents for the note it's in, linking to every heading from h1 to
 * h6. Written in a note as `<Toc />`, or `<Toc maxDepth="3" />` to stop at h3.
 *
 * It lists whatever headings the note has when rendered, so it follows edits
 * with no upkeep (see remarkHeadings, which supplies them).
 */
export function Toc({ headings, maxDepth }: Props) {
  const deepest = Number.parseInt(maxDepth ?? "", 10);
  const limit = deepest >= 1 && deepest <= 6 ? deepest : 6;
  const entries = nest(parseHeadings(headings).filter((h) => h.depth <= limit));

  return (
    <nav aria-label="Table of contents" className="not-prose my-4 rounded-md border border-border bg-muted p-4 text-sm">
      {entries.length > 0 ? (
        <List entries={entries} />
      ) : (
        <p className="m-0 text-muted-foreground">No headings yet.</p>
      )}
    </nav>
  );
}
