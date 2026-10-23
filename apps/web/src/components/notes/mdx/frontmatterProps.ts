import type { MdxCompletion } from "./completions";
import type { PropTarget } from "./props";

type Property = { name: string; description: string; template: string };

/** The properties a note's frontmatter understands. None is required; the menu only offers what's missing. */
const properties: Property[] = [
  { name: "title", description: "The note's title", template: "title: $0" },
  { name: "description", description: "A one-line summary of the note", template: "description: $0" },
  { name: "tags", description: "Labels for finding the note, e.g. [work, ideas]", template: "tags: [$0]" },
  { name: "createdAt", description: "The day the note was made (YYYY-MM-DD)", template: "createdAt: $0" },
  { name: "updatedAt", description: "The day the note last changed (YYYY-MM-DD)", template: "updatedAt: $0" },
  { name: "headerImage", description: "Picture above the title: app_data/… or a web address", template: "headerImage: $0" },
  { name: "headerImageLayout", description: "full, or centered at its own size", template: "headerImageLayout: $0" },
];

const OPENING = /^---\r?\n/;
const CLOSING = /\r?\n---[ \t]*(?:\r?\n|$)/g;
const KEY = /^([A-Za-z][\w-]*)[ \t]*:/;

/**
 * What to offer when the caret is on an otherwise empty line of the note's frontmatter block, or part-way
 * through typing a property name there: the known properties the block doesn't have yet. Null anywhere else.
 */
export function findFrontmatterTarget(text: string, caret: number): PropTarget | null {
  const opening = OPENING.exec(text);
  if (!opening || caret < opening[0].length) return null;
  CLOSING.lastIndex = opening[0].length - 1;
  const closing = CLOSING.exec(text);
  // An unfinished block isn't frontmatter yet, and the closing line itself isn't inside it.
  if (!closing || caret > closing.index) return null;

  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const lineEnd = text.indexOf("\n", caret) === -1 ? text.length : text.indexOf("\n", caret);
  const query = text.slice(lineStart, caret);
  if (!/^[A-Za-z]*$/.test(query) || text.slice(caret, lineEnd).trim() !== "") return null;

  const block = text.slice(opening[0].length, closing.index);
  const present = new Set<string>();
  let offset = opening[0].length;
  for (const line of block.split("\n")) {
    const key = offset === lineStart ? null : KEY.exec(line)?.[1];
    if (key) present.add(key);
    offset += line.length + 1;
  }

  const items: MdxCompletion[] = properties
    .filter(({ name }) => !present.has(name) && name.toLowerCase().startsWith(query.toLowerCase()))
    .map(({ name, description, template }) => ({ name, label: name, description, template }));
  return { start: lineStart, end: caret, query, items, label: "Frontmatter properties" };
}
