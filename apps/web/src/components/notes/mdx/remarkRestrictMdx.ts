// `prop={x}` is an mdxJsxAttribute whose value is an object; `{...x}` is its own attribute type.
type Attribute = { type: string; value?: unknown };
type Node = { type: string; name?: string | null; attributes?: Attribute[]; children?: Node[] };

/**
 * The name an allowed tag is rendered under. react-markdown can only look a
 * tag up in its `components` by a lowercase or non-identifier name (anything
 * like `Info` is treated as a variable that would have to be evaluated), so
 * the plugin renames `<Info>` to this and `components` is keyed the same way.
 */
export const renderKey = (name: string) => `mdx-${name}`;

/**
 * Limits a note's MDX to tags from `allowed`. Anything else MDX can express is
 * rejected, because rendering never evaluates code (the desktop app's CSP
 * forbids it, and a note shouldn't be able to run code anyway):
 * `{expressions}` (including `prop={value}`), `import`/`export`, fragments,
 * and unknown tags.
 *
 * Rejection throws, which the preview turns into a notice plus a plain
 * Markdown render of the note.
 */
export function remarkRestrictMdx(options: { allowed: readonly string[] }) {
  const { allowed } = options;

  return (tree: Node) => {
    const visit = (node: Node) => {
      switch (node.type) {
        case "mdxJsxFlowElement":
        case "mdxJsxTextElement":
          if (!node.name) throw new Error("Fragments (<>…</>) are not supported.");
          if (!allowed.includes(node.name)) {
            throw new Error(`Unknown component <${node.name}>. Available: ${allowed.map((n) => `<${n}>`).join(", ")}.`);
          }
          if (node.attributes?.some((a) => a.type === "mdxJsxExpressionAttribute" || (a.value !== null && typeof a.value === "object"))) {
            throw new Error("{expressions} are not supported.");
          }
          node.name = renderKey(node.name);
          break;
        case "mdxFlowExpression":
        case "mdxTextExpression":
          throw new Error("{expressions} are not supported.");
        case "mdxjsEsm":
          throw new Error("import and export are not supported.");
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
