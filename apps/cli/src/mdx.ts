/**
 * What the preview draws for a note.
 *
 * A note stays Markdown, but may use the same few JSX tags as in the web and desktop apps
 * (`<Info>`, `<Warning>`, `<Image>`, `<Toc>`), and may hold images. The terminal can't render
 * those as React or as HTML, so this turns the note into a list of blocks the preview draws:
 * stretches of plain Markdown (still drawn by OpenTUI's `<markdown>`, exactly as before), panels
 * around other blocks, a table of contents, and images.
 *
 * It parses with the web app's own pipeline (remark-mdx, then web's allowlist and heading
 * plugins), so a note is valid or invalid here exactly as it is there, with the same messages.
 * The syntax tree is only used to find where the components and images are: each Markdown block
 * is a slice of the note's own text. Pure, so it is tested without a terminal.
 */
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { HEADINGS_PROP, imageNameFromRef, remarkHeadings, remarkRestrictMdx, renderKey, type TocHeading } from "./backend";

/**
 * The tags a note may use: the keys of the web app's `mdxComponents`. They are listed again here
 * because that module is React; mdx.test.ts fails if the two lists drift.
 */
export const MDX_COMPONENTS = ["Info", "Warning", "Image", "Toc"] as const;
type ComponentName = (typeof MDX_COMPONENTS)[number];

/** One line of a table of contents. */
export type TocEntry = {
  /** 0 for a top-level heading, 1 for one nested under it, and so on. */
  level: number;
  text: string;
};

export type Block =
  | { kind: "markdown"; source: string }
  | { kind: "panel"; tone: "info" | "warning"; blocks: Block[] }
  | { kind: "toc"; entries: TocEntry[] }
  /** An image stored with the notes: `name` is its file in `app_data/`. */
  | { kind: "image"; name: string; alt: string; title?: string };

export type Preview = {
  blocks: Block[];
  /**
   * Set when the note isn't valid MDX (for as long as a tag is half-typed, say): why, as MDX
   * words it, with the position when it reports one. `blocks` is then the whole note as plain
   * Markdown, so the preview never goes blank.
   */
  error?: string;
};

// The mdast shapes this reads, loosely: the plugins and the parser are typed by their own packages.
type Node = {
  type: string;
  name?: string | null;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

// Same plugins, in the same order, as the web preview (NoteMarkdown.tsx).
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMdx)
  .use(remarkRestrictMdx, { allowed: MDX_COMPONENTS })
  .use(remarkHeadings);

// For a note with images but no components: plain Markdown, which never fails to parse.
const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

const USES_COMPONENT = new RegExp(`<(?:${MDX_COMPONENTS.join("|")})[\\s/>]`);
// A cheap look before parsing: Markdown image syntax is `![alt](`.
const MAY_HAVE_IMAGE = /!\[[^\]\n]*\]\(/;

/**
 * What to draw for a note's body (its text without the frontmatter). Only a note that mentions
 * a component is parsed as MDX; any other is plain Markdown, where a stray `<` or `{` is fine,
 * and one with no component and no image isn't parsed at all.
 */
export function parsePreview(body: string): Preview {
  const plain: Block[] = [{ kind: "markdown", source: body }];
  const mdx = USES_COMPONENT.test(body);
  if (!mdx && !MAY_HAVE_IMAGE.test(body)) return { blocks: plain };
  const processor = mdx ? mdxProcessor : markdownProcessor;
  try {
    const tree = processor.runSync(processor.parse(body)) as unknown as Node;
    return { blocks: blocksOf(tree.children ?? [], body) };
  } catch (error) {
    return { blocks: plain, error: error instanceof Error ? error.message : String(error) };
  }
}

const start = (node: Node) => node.position?.start.offset ?? 0;
const end = (node: Node) => node.position?.end.offset ?? 0;

/** Which component a tag is. The allowlist plugin has already renamed them (see `renderKey`). */
const componentOf = (node: Node): ComponentName | undefined => MDX_COMPONENTS.find((name) => node.name === renderKey(name));

function attribute(node: Node, name: string): string | undefined {
  const value = node.attributes?.find((a) => a.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Blocks for sibling nodes: components and images become their own blocks, and everything
 * between them stays Markdown, as the original text.
 */
function blocksOf(nodes: Node[], source: string): Block[] {
  const blocks: Block[] = [];
  let run: Node[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const text = substitute(source, start(run[0]), end(run[run.length - 1]), run);
    if (text.trim() !== "") blocks.push({ kind: "markdown", source: text });
    run = [];
  };

  for (const node of nodes) {
    const element = blockElement(node);
    const images = element ? null : paragraphImages(node);
    if (!element && !images) {
      run.push(node);
      continue;
    }
    flush();
    blocks.push(...(element ? elementBlocks(element, source) : images!));
  }
  flush();
  return blocks;
}

/**
 * The images of a paragraph that is nothing but images, such as the `![alt](app_data/x.png)` a
 * paste inserts, or several of them on consecutive lines. A paragraph with any other content, or
 * with an image that isn't stored with the notes (an `https://` one), is left as text: a bitmap
 * can't sit in a line of text, and the terminal doesn't fetch images from the network.
 */
function paragraphImages(node: Node): Block[] | null {
  if (node.type !== "paragraph") return null;
  const parts = (node.children ?? []).filter((child) => !(child.type === "break" || (child.type === "text" && !child.value?.trim())));
  const images = parts.map((part) => {
    const name = part.type === "image" && part.url ? imageNameFromRef(part.url) : null;
    return name ? ({ kind: "image", name, alt: part.alt ?? "", ...(part.title ? { title: part.title } : {}) } as const) : null;
  });
  return images.length > 0 && images.every((image) => image !== null) ? images : null;
}

/**
 * The tag that stands alone as a block: MDX's flow element (tags on lines of their own), or the
 * only thing in a paragraph, which is how `<Info>one line</Info>` parses. Web draws both as a block.
 */
function blockElement(node: Node): Node | null {
  if (node.type === "mdxJsxFlowElement") return node;
  if (node.type !== "paragraph") return null;
  const parts = (node.children ?? []).filter((child) => !(child.type === "text" && !child.value?.trim()));
  return parts.length === 1 && parts[0].type === "mdxJsxTextElement" ? parts[0] : null;
}

function elementBlocks(element: Node, source: string): Block[] {
  switch (componentOf(element)) {
    case "Info":
      return [{ kind: "panel", tone: "info", blocks: blocksOf(element.children ?? [], source) }];
    case "Warning":
      return [{ kind: "panel", tone: "warning", blocks: blocksOf(element.children ?? [], source) }];
    case "Image": {
      const src = attribute(element, "src");
      const name = src ? imageNameFromRef(src) : null;
      if (name) {
        const title = attribute(element, "title");
        return [{ kind: "image", name, alt: attribute(element, "alt") ?? "", ...(title ? { title } : {}) }];
      }
      // Not one of ours to show (a web address): the Markdown form, as text.
      const image = imageMarkdown(element);
      return image ? [{ kind: "markdown", source: image }] : [];
    }
    case "Toc":
      return [{ kind: "toc", entries: tocEntries(element) }];
    default:
      return [];
  }
}

/**
 * `source[from, to)` with any component tag in it replaced by text, for tags that sit inside
 * Markdown the terminal draws as one piece (a sentence, a list item). Only the outermost tags
 * are replaced; what is inside them is handled by `replacement`.
 */
function substitute(source: string, from: number, to: number, nodes: Node[]): string {
  let text = "";
  let at = from;
  for (const element of outermostElements(nodes)) {
    text += source.slice(at, start(element)) + replacement(element, source);
    at = end(element);
  }
  return text + source.slice(at, to);
}

/** The tags under `nodes` that aren't under another tag, in document order. */
function outermostElements(nodes: Node[]): Node[] {
  return nodes.flatMap((node) =>
    node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement" ? [node] : outermostElements(node.children ?? []),
  );
}

/**
 * What stands in for a tag that can't be a block. An image is its Markdown form, which the
 * terminal shows as its alt text; a panel is dropped and its content kept; a table of contents
 * has no sensible place inside a sentence or a list item, so it is dropped.
 */
function replacement(element: Node, source: string): string {
  switch (componentOf(element)) {
    case "Image":
      return imageMarkdown(element);
    case "Info":
    case "Warning": {
      const children = element.children ?? [];
      return children.length ? substitute(source, start(children[0]), end(children[children.length - 1]), children) : "";
    }
    default:
      return "";
  }
}

/**
 * `<Image src alt title />` as the Markdown `![alt](src "title")`: the same picture, written as
 * Markdown, for where it can't be drawn as one. Nothing without a `src`, as on the web.
 */
function imageMarkdown(element: Node): string {
  const src = attribute(element, "src");
  if (!src) return "";
  const alt = (attribute(element, "alt") ?? "").replace(/[\\[\]]/g, "\\$&");
  const target = /[\s()]/.test(src) ? `<${src}>` : src;
  const title = attribute(element, "title");
  return `![${alt}](${target}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
}

function parseHeadings(json: string | undefined): TocHeading[] {
  try {
    const parsed: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The lines of a table of contents. A heading nests under the closest one above it that is
 * shallower, so `h1, h3, h2` gives the h3 and the h2 the h1 as parent (as in the web's `<Toc>`).
 * `maxDepth` stops at that heading level, 1 to 6, and is 6 when missing or out of range.
 */
function tocEntries(element: Node): TocEntry[] {
  const deepest = Number.parseInt(attribute(element, "maxDepth") ?? "", 10);
  const limit = deepest >= 1 && deepest <= 6 ? deepest : 6;
  const open: number[] = []; // the depths of the headings the next one may nest under
  return parseHeadings(attribute(element, HEADINGS_PROP))
    .filter((heading) => heading.depth <= limit)
    .map(({ depth, text }) => {
      while (open.length > 0 && open[open.length - 1] >= depth) open.pop();
      const level = open.length;
      open.push(depth);
      return { level, text };
    });
}
