// The minimal shapes of the hast nodes this reads; the parser and its plugins are typed by their own packages.
type Node = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};

/** The attribute that says where in the note's text a piece of the preview's text came from: `start-end`. */
export const SOURCE_ATTRIBUTE = "data-src";

// Text in these is never wrapped: code can't be highlighted, and the others hold text that isn't prose.
const SKIPPED = new Set(["pre", "code", "script", "style", "svg", "textarea"]);

/**
 * Wraps every piece of the preview's text in a `<span data-src="start-end">`, where the numbers are
 * where it was read from in the Markdown. The preview is read-only, so this is what lets a selection
 * in it be traced back to the text it came from (see previewSource.ts), to highlight it there.
 *
 * Text with no position (the line breaks between blocks), whitespace between pieces, and code are
 * left alone. Must run before the other rehype plugins, which may rewrite the tree.
 */
export function rehypeSourceSpans() {
  const wrap = (node: Node) => {
    if (node.type === "element" && node.tagName && SKIPPED.has(node.tagName)) return;
    const children = node.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (child.type === "text" && start !== undefined && end !== undefined && child.value?.trim()) {
        children[i] = { type: "element", tagName: "span", properties: { dataSrc: `${start}-${end}` }, children: [child] };
      } else {
        wrap(child);
      }
    }
  };
  return (tree: Node) => wrap(tree);
}
