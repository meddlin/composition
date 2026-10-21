import { renderKey } from "./remarkRestrictMdx";

type Node = { type: string; name?: string | null; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };

/** The tag a note writes to say where its footnotes go. */
export const FOOTNOTES_TAG = "Footnotes";

/**
 * Moves the notes' footnotes to where the note says to put them. Footnotes
 * (`[^1]` cited, `[^1]: …` defined) are collected by remark-rehype into a
 * section at the end of the note; when the note has a `<Footnotes />`, that
 * section's list becomes the tag's content instead, so the tag is where the
 * list appears and the section at the end is gone. A note without the tag keeps
 * the section at the end, and a second tag is left empty.
 *
 * Must run after remarkRestrictMdx has renamed the tag, i.e. on the MDX path only.
 */
export function rehypeFootnotes() {
  return (tree: Node) => {
    const roots = tree.children ?? [];
    const section = roots.find((node) => node.type === "element" && node.tagName === "section" && node.properties?.dataFootnotes);
    if (!section) return;

    let tag: Node | undefined;
    const find = (node: Node) => {
      if (tag) return;
      if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === renderKey(FOOTNOTES_TAG)) {
        tag = node;
        return;
      }
      node.children?.forEach(find);
    };
    roots.forEach(find);
    if (!tag) return;

    // The section's visually hidden heading is dropped: the component labels itself.
    tag.children = (section.children ?? []).filter((node) => node.type === "element" && node.tagName === "ol");
    tree.children = roots.filter((node) => node !== section);
  };
}
