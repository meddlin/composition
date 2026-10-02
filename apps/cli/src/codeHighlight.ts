/**
 * Syntax highlighting for the fenced code blocks in the preview.
 *
 * The web and desktop apps run highlight.js (through lowlight) over a fence and color the
 * scopes it finds (web's globals.css); this does the same, so a block is colored the same
 * way in all three, in the same languages, and a fence with no language stays plain. OpenTUI's
 * own highlighting is tree-sitter, which here knows only a handful of languages, so it is
 * replaced for every block rather than mixed with.
 *
 * The result is a list of highlight ranges, which OpenTUI's code renderable draws using the
 * `code.*` styles from theme.ts. Pure, so it is tested without a terminal.
 */

/** The few fields of lowlight's syntax tree (hast) this reads. */
type Node = { type: string; value?: string; properties?: { className?: unknown }; children?: Node[] };

/** Offsets into the code, then the name of a style in `syntaxStyleFor`. The shape OpenTUI draws. */
export type CodeHighlight = [start: number, end: number, style: string];

/**
 * highlight.js's scopes, by the style they get: the table in web's globals.css. A scope not
 * listed here (`subst`, `params`, and the like) takes the color of what it is inside.
 */
const STYLE_OF_SCOPE: Record<string, string> = {
  comment: "code.comment",
  quote: "code.comment",
  keyword: "code.keyword",
  "selector-tag": "code.keyword",
  doctag: "code.keyword",
  name: "code.keyword",
  meta: "code.keyword",
  deletion: "code.keyword",
  string: "code.string",
  regexp: "code.string",
  number: "code.number",
  literal: "code.number",
  symbol: "code.number",
  bullet: "code.number",
  title: "code.function",
  section: "code.function",
  type: "code.type",
  "built_in": "code.type",
  attr: "code.attr",
  attribute: "code.attr",
  variable: "code.attr",
  "template-variable": "code.attr",
  property: "code.attr",
  "selector-class": "code.attr",
  "selector-id": "code.attr",
  addition: "code.attr",
  emphasis: "code.emphasis",
  strong: "code.strong",
};

/** The style for an element's classes (`hljs-title class_`), or undefined when it has none of its own. */
function styleOf(classes: unknown): string | undefined {
  if (!Array.isArray(classes)) return undefined;
  const scopes = classes.filter((c): c is string => typeof c === "string").map((c) => c.replace(/^hljs-/, ""));
  // `title.class_` is a class's name, which web colors as a type rather than as a function.
  if (scopes.includes("title") && scopes.includes("class_")) return "code.type";
  for (const scope of scopes) {
    const style = STYLE_OF_SCOPE[scope];
    if (style) return style;
  }
  return undefined;
}

/**
 * Ranges for the text of `tree`, which cover each stretch of text once, in the style of the
 * innermost scope around it, so nothing overlaps and OpenTUI has no precedence to decide.
 */
export function highlightsOf(tree: Node): CodeHighlight[] {
  const highlights: CodeHighlight[] = [];
  let offset = 0;

  const add = (start: number, end: number, style: string | undefined) => {
    if (!style || end <= start) return;
    const last = highlights[highlights.length - 1];
    if (last && last[1] === start && last[2] === style) last[1] = end;
    else highlights.push([start, end, style]);
  };

  const walk = (node: Node, inherited: string | undefined) => {
    if (node.type === "text") {
      const length = node.value?.length ?? 0;
      add(offset, offset + length, inherited);
      offset += length;
    } else if (node.type === "element") {
      const style = styleOf(node.properties?.className) ?? inherited;
      for (const child of node.children ?? []) walk(child, style);
    }
  };

  for (const child of tree.children ?? []) walk(child, undefined);
  return highlights;
}

type Lowlight = Awaited<ReturnType<typeof load>>;

// All of highlight.js's languages are a lot to load, so, as on the web, it waits until a note
// actually has a fenced block, and happens once.
let loading: Promise<Lowlight> | undefined;
async function load() {
  const { createLowlight, all } = await import("lowlight");
  return createLowlight(all);
}

/**
 * The first word of a fence's info string (```` ```ts title="x" ````), lowercased, which is the
 * language the author named. Nothing for a fence with none: web does not guess one either.
 */
export const languageOf = (info: string | undefined): string | undefined => info?.trim().split(/\s+/, 1)[0]?.toLowerCase() || undefined;

/**
 * Highlights for `code` in the language an info string names. Undefined when there is no
 * language or highlight.js doesn't know it, so the block is left as plain text.
 */
export async function highlightCode(code: string, info: string | undefined): Promise<CodeHighlight[] | undefined> {
  const language = languageOf(info);
  if (!language) return undefined;
  const lowlight = await (loading ??= load());
  if (!lowlight.registered(language)) return undefined;
  try {
    return highlightsOf(lowlight.highlight(language, code));
  } catch {
    return undefined;
  }
}
