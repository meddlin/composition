// The minimal shapes of the hast nodes this reads; the parser and its plugins are typed by their own packages.
type Node = {
  type: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};

/** The attribute that says where in the note's text (the body, after the frontmatter) a top-level block of the preview is written: `start-end`. */
export const BLOCK_SOURCE_ATTRIBUTE = "data-block-src";

/**
 * Marks each top-level block of the preview (a paragraph, a heading, a list, a table, a code block) with where it is
 * written in the Markdown, so that Split can keep the editor and the preview at the same place in the note
 * (`useSplitScrollSync`). A component (`<Chart>`, `<Info>`) is drawn by its own React component, which takes no such
 * attribute; the places between the blocks round it are filled in evenly. Must run before the plugins that may move
 * blocks about.
 */
export function rehypeBlockSources() {
  return (tree: Node) => {
    for (const child of tree.children ?? []) {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type !== "element" || start === undefined || end === undefined) continue;
      child.properties = { ...child.properties, dataBlockSrc: `${start}-${end}` };
    }
  };
}
