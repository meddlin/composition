import { renderKey } from "./remarkRestrictMdx";

type Attribute = { type: string; name?: string; value?: unknown };
type Node = {
  type: string;
  name?: string | null;
  depth?: number;
  value?: string;
  alt?: string | null;
  attributes?: Attribute[];
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
};

export type TocHeading = { depth: number; text: string; id: string };

/** The tag a note writes to get a table of contents, and the prop the plugin hands it the headings in. */
export const TOC_TAG = "Toc";
export const HEADINGS_PROP = "headings";

const plainText = (node: Node): string => node.value ?? node.alt ?? node.children?.map(plainText).join("") ?? "";

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-") || "section";

/**
 * Gives every heading in the note an `id`, and hands the list of them to each
 * `<Toc />` as its `headings` prop (JSON, since an MDX attribute can only be a
 * string). It runs on every render of the preview, so the table of contents
 * follows the note as it is edited.
 *
 * `idPrefix` keeps ids unique when several notes are on screen at once, which
 * would otherwise make a link in one note scroll to a heading in another.
 *
 * Must run after remarkRestrictMdx, which renames the tags this looks for.
 */
export function remarkHeadings(options: { idPrefix?: string } = {}) {
  const { idPrefix = "" } = options;

  return (tree: Node) => {
    const headings: TocHeading[] = [];
    const tocs: Node[] = [];
    const taken = new Set<string>();

    const uniqueId = (text: string) => {
      const base = idPrefix + slugify(text);
      let id = base;
      for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      return id;
    };

    const visit = (node: Node) => {
      if (node.type === "heading" && node.depth) {
        const text = plainText(node).trim();
        const id = uniqueId(text);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
        headings.push({ depth: node.depth, text, id });
      } else if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        if (node.name === renderKey(TOC_TAG)) tocs.push(node);
      }
      node.children?.forEach(visit);
    };
    visit(tree);

    // Set after the walk, once every heading (including those below the tag) is known.
    const value = JSON.stringify(headings);
    for (const toc of tocs) {
      const others = (toc.attributes ?? []).filter((a) => a.name !== HEADINGS_PROP);
      toc.attributes = [...others, { type: "mdxJsxAttribute", name: HEADINGS_PROP, value }];
    }
  };
}
