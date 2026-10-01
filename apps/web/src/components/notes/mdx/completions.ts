import type { mdxComponents } from "./components";

export type MdxCompletion = {
  name: string;
  /** One line shown under the name in the menu. */
  description: string;
  /** What replaces the `<` and whatever was typed after it; `$0` marks where the caret lands. */
  template: string;
};

/**
 * What the editor offers after a `<`, one entry per allowed component. Typed
 * against `mdxComponents` so a new component can't ship without one.
 */
const catalog: Record<keyof typeof mdxComponents, Omit<MdxCompletion, "name">> = {
  Info: {
    description: "Callout for background a reader should notice",
    // Blank lines around the content are what make Markdown inside render (see Info).
    template: "<Info>\n\n$0\n\n</Info>",
  },
  Warning: {
    description: "Callout for something to be careful about",
    template: "<Warning>\n\n$0\n\n</Warning>",
  },
  Image: {
    description: "An image, same as ![alt](src)",
    template: '<Image src="$0" alt="" />',
  },
  Toc: {
    description: "Table of contents that follows the note's headings",
    template: "<Toc />$0",
  },
};

export const mdxCompletions: MdxCompletion[] = Object.entries(catalog).map(([name, entry]) => ({ name, ...entry }));

export type CompletionTrigger = {
  /** Where the `<` is. */
  start: number;
  /** What has been typed after it. */
  query: string;
};

/** A `<` that starts a tag: not glued to a word (`a<b`) and not part of `<<`. */
const OPEN_TAG = /(?:^|[^\w<])<([A-Za-z]*)$/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/gm;

/**
 * The `<` the caret is just after, if the user is starting a tag there.
 * Nothing is offered inside a fenced code block, where `<` is just text.
 */
export function findTrigger(text: string, caret: number): CompletionTrigger | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const match = OPEN_TAG.exec(text.slice(lineStart, caret));
  if (!match) return null;

  const fences = text.slice(0, lineStart).match(FENCE)?.length ?? 0;
  if (fences % 2 === 1) return null;

  return { start: caret - match[1].length - 1, query: match[1] };
}

/** The components whose name starts with what was typed, ignoring case. */
export function matchCompletions(query: string): MdxCompletion[] {
  const typed = query.toLowerCase();
  return mdxCompletions.filter(({ name }) => name.toLowerCase().startsWith(typed));
}

/** The text to insert for `completion`, and the caret's offset within it. */
export function expandCompletion({ template }: MdxCompletion): { text: string; caret: number } {
  const caret = template.indexOf("$0");
  return { text: template.replace("$0", ""), caret };
}
