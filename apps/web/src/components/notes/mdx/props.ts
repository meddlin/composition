import { insideFence, type MdxCompletion } from "./completions";
import type { mdxComponents } from "./components";
import { HIGHLIGHT_COLORS } from "./highlightColors";

export type PropValue = { value: string; description: string };

export type PropSpec = {
  name: string;
  /** One line shown under the name in the menu. */
  description: string;
  /** Values worth suggesting; the prop may still take others (a width of `320`). */
  values?: PropValue[];
};

const IMAGE_PROPS: PropSpec[] = [
  { name: "src", description: "Where the picture is: app_data/… or a web address" },
  { name: "alt", description: "Text for when it can't be seen, and for screen readers" },
  { name: "title", description: "Tooltip shown when hovering over it" },
  {
    name: "width",
    description: "How wide to draw it: pixels (400) or a share of the note (50%)",
    values: [
      { value: "25%", description: "A quarter of the note's width" },
      { value: "50%", description: "Half the note's width" },
      { value: "75%", description: "Three quarters of the note's width" },
      { value: "100%", description: "The note's full width" },
      { value: "200", description: "200 pixels wide" },
      { value: "400", description: "400 pixels wide" },
      { value: "600", description: "600 pixels wide" },
      { value: "800", description: "800 pixels wide" },
    ],
  },
];

/**
 * The props each component takes, for the editor to offer inside an open tag. Typed against
 * `mdxComponents` so a new component can't ship without saying what it takes (even if that is nothing).
 */
const catalog: Record<keyof typeof mdxComponents, PropSpec[]> = {
  Info: [],
  Warning: [],
  Image: IMAGE_PROPS,
  Drawio: [
    { name: "src", description: "The stored diagram: app_data/…" },
    ...IMAGE_PROPS.filter(({ name }) => name !== "src"),
  ],
  Toc: [
    {
      name: "maxDepth",
      description: "Deepest heading level to list (1 to 6)",
      values: [1, 2, 3, 4, 5, 6].map((level) => ({ value: String(level), description: `Stop at level ${level} headings` })),
    },
  ],
  Mark: [
    {
      name: "color",
      description: "Highlighter colour",
      values: HIGHLIGHT_COLORS.map((color) => ({ value: color, description: `Highlight in ${color}` })),
    },
  ],
  Footnotes: [],
  YouTube: [
    { name: "url", description: "The video's link (youtube.com/watch…, youtu.be/…) or its 11-character id" },
    {
      name: "start",
      description: "Where to begin playing: seconds (90), or 1:30, 1m30s",
      values: [
        { value: "30", description: "30 seconds in" },
        { value: "1:00", description: "One minute in" },
        { value: "5:00", description: "Five minutes in" },
      ],
    },
    { name: "title", description: "Names the player for screen readers" },
  ],
  Repo: [
    { name: "url", description: "The repository's page or clone address (github.com/owner/repo, git@host:owner/repo.git)" },
    { name: "description", description: "What the repository is for, shown under its name" },
  ],
};

const componentNames = Object.keys(catalog);

/** How far back from the caret to look for the `<` that opened the tag. */
const LOOKBACK = 1500;

type Attribute = {
  name: string;
  nameStart: number;
  nameEnd: number;
  hasEquals: boolean;
  /** The quoted value, between the quotes; `closed` says whether the closing quote is there yet. */
  value?: { start: number; end: number; closed: boolean };
};

type OpenTag = {
  name: string;
  nameEnd: number;
  attributes: Attribute[];
  /**
   * The last place the caret can be and still be in this tag: before the `/` or `>` that ends it, or,
   * while that hasn't been typed, where reading stopped (the end of an unclosed value's line, a
   * blank line, the end of the note).
   */
  reach: number;
};

const TAG_START = new RegExp(`^<(${componentNames.join("|")})(?=\\s)`);
const ATTRIBUTE_NAME = /[A-Za-z_][\w.:-]*/y;
const BLANK_LINE = /\n[ \t]*\n/;

/** The tag starting at `start` (a `<`), read as far as it goes. Values are taken to end on their own line. */
function readTag(text: string, start: number): OpenTag | null {
  const head = TAG_START.exec(text.slice(start, start + 32));
  if (!head) return null;
  const tag: OpenTag = { name: head[1], nameEnd: start + head[0].length, attributes: [], reach: text.length };

  let i = tag.nameEnd;
  while (i < text.length) {
    const skipped = /^\s*/.exec(text.slice(i))![0];
    // MDX can't carry a tag across a blank line, so what follows one isn't this tag's.
    if (BLANK_LINE.test(skipped)) {
      tag.reach = i;
      return tag;
    }
    i += skipped.length;
    if (i >= text.length) break;

    if (text[i] === ">" || (text[i] === "/" && text[i + 1] === ">")) {
      tag.reach = i;
      return tag;
    }
    ATTRIBUTE_NAME.lastIndex = i;
    const name = ATTRIBUTE_NAME.exec(text);
    if (!name) {
      i++;
      continue;
    }
    const attribute: Attribute = { name: name[0], nameStart: i, nameEnd: i + name[0].length, hasEquals: false };
    tag.attributes.push(attribute);
    i = attribute.nameEnd;

    const equals = /^\s*=\s*/.exec(text.slice(i));
    if (!equals) continue;
    attribute.hasEquals = true;
    i += equals[0].length;

    const quote = text[i];
    if (quote !== '"' && quote !== "'") continue; // an {expression}, or a value not yet started
    const lineEnd = text.indexOf("\n", i);
    const limit = lineEnd === -1 ? text.length : lineEnd;
    const closing = text.indexOf(quote, i + 1);
    const closed = closing !== -1 && closing < limit;
    attribute.value = { start: i + 1, end: closed ? closing : limit, closed };
    if (!closed) {
      tag.reach = limit;
      return tag;
    }
    i = closing + 1;
  }
  return tag;
}

/** The `<Component ` the caret is inside of, if any. */
function enclosingTag(text: string, caret: number): { start: number; tag: OpenTag } | null {
  const floor = Math.max(0, caret - LOOKBACK);
  for (let i = caret; i > 0; ) {
    i = text.lastIndexOf("<", i - 1);
    if (i < floor || i < 0 || i >= caret) return null;
    // Like a tag the user starts typing: not glued to a word, and not part of `<<`.
    if (i > 0 && /[\w<]/.test(text[i - 1])) continue;
    const tag = readTag(text, i);
    if (tag) return { start: i, tag };
  }
  return null;
}

export type PropTarget = {
  /** The text the choice replaces, and what has been typed of it. */
  start: number;
  end: number;
  query: string;
  items: MdxCompletion[];
  /** What the menu is called for assistive tech. */
  label: string;
};

const startsWith = (candidate: string, typed: string) => candidate.toLowerCase().startsWith(typed.toLowerCase());

/**
 * What to offer at the caret inside a component's open tag: the names of the props the tag doesn't
 * have yet (after a space, or part-way through typing one), or, inside the quotes of a prop with
 * values worth suggesting, those values. Null anywhere else, and in a fenced code block.
 */
export function findPropTarget(text: string, caret: number): PropTarget | null {
  const found = enclosingTag(text, caret);
  if (!found) return null;
  const { start: tagStart, tag } = found;
  if (insideFence(text, text.lastIndexOf("\n", tagStart - 1) + 1)) return null;
  if (caret <= tag.nameEnd || caret > tag.reach) return null;
  const props = catalog[tag.name as keyof typeof catalog];

  const inValue = tag.attributes.find((a) => a.value && a.value.start <= caret && caret <= a.value.end);
  if (inValue?.value) {
    const spec = props.find((p) => p.name === inValue.name);
    const { start, end, closed } = inValue.value;
    const query = text.slice(start, caret);
    const items = (spec?.values ?? [])
      .filter(({ value }) => startsWith(value, query))
      .map(({ value, description }) => ({ name: value, label: value, description, template: `${value}"$0` }));
    // Through the closing quote, which the value brings along, so the caret ends up past it.
    return { start, end: closed ? end + 1 : end, query, items, label: `${spec?.name ?? inValue.name} values` };
  }

  const typing = tag.attributes.find((a) => a.nameStart < caret && caret <= a.nameEnd);
  if (typing?.hasEquals) return null;
  if (!typing) {
    // Only in the space between things: not hard against the tag's name, a value, or a `=`.
    if (!/\s/.test(text[caret - 1] ?? "") || /^\s*=/.test(text.slice(caret))) return null;
  }

  const start = typing ? typing.nameStart : caret;
  const end = typing ? typing.nameEnd : caret;
  const query = text.slice(start, caret);
  const present = new Set(tag.attributes.filter((a) => a !== typing).map((a) => a.name));
  // A prop typed right up against the next one needs a space of its own.
  const next = text[end];
  const gap = next === undefined || /[\s/>]/.test(next) ? "" : " ";
  const items = props
    .filter(({ name }) => !present.has(name) && startsWith(name, query))
    .map(({ name, description }) => ({ name, label: name, description, template: `${name}="$0"${gap}` }));
  return { start, end, query, items, label: `${tag.name} props` };
}
