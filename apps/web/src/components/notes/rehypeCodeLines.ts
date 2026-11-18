import { codeLines, hasLineOptions, parseCodeFence, type CodeFence } from "../../lib/composition/codeFence";

/**
 * Line numbers and highlighted lines in Preview's code blocks (`docs/ui/code-blocks.md`), in two steps around the
 * syntax colours:
 *
 * - `rehypeCodeFence` (before `rehype-highlight`) reads each fence's options from its language and the rest of its
 *   opening line, and drops the language when the first word was an option (```` ``` {3} ````), so `{3}` is not
 *   taken for a language to colour.
 * - `rehypeCodeLines` (after it) splits the coloured code of a fence with options into one `<span class="code-line">`
 *   per line, carrying its number and whether it is highlighted. A span of colour that crosses a line break (a block
 *   comment) is cut into one per line. A plain fence is left as it was.
 *
 * The line breaks stay in the text, so a component that reads its code as text (`<Chart>`, `<Sheet>`) reads the same.
 */

// The minimal shapes of the hast nodes this reads; the parser and its plugins are typed by their own packages.
type Node = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  data?: { meta?: string | null; codeFence?: CodeFence };
  children?: Node[];
};

/** Calls `visit` with the `<code>` of every `<pre>`. */
function eachCodeBlock(tree: Node, visit: (code: Node) => void) {
  const walk = (node: Node) => {
    if (node.type === "element" && node.tagName === "pre") {
      const code = node.children?.find((child) => child.type === "element" && child.tagName === "code");
      if (code) visit(code);
      return;
    }
    node.children?.forEach(walk);
  };
  walk(tree);
}

function classNames(node: Node): string[] {
  const names = node.properties?.className;
  return Array.isArray(names) ? names.map(String) : typeof names === "string" ? names.split(/\s+/) : [];
}

/** Reads each fence's options onto its `<code>` and takes back a language that was really an option. */
export function rehypeCodeFence() {
  return (tree: Node) =>
    eachCodeBlock(tree, (code) => {
      const names = classNames(code);
      const languageClass = names.find((name) => name.startsWith("language-"));
      const info = `${languageClass?.slice("language-".length) ?? ""} ${code.data?.meta ?? ""}`;
      const fence = parseCodeFence(info);
      if (languageClass && !fence.language) {
        code.properties = { ...code.properties, className: names.filter((name) => name !== languageClass) };
      }
      if (hasLineOptions(fence)) code.data = { ...code.data, codeFence: fence };
    });
}

/** `node`'s text and elements cut at its line breaks: one list of pieces per line, the elements copied onto each. */
function splitAtLineBreaks(node: Node): Node[][] {
  if (node.type === "text") {
    return (node.value ?? "").split("\n").map((piece) => (piece ? [{ type: "text", value: piece }] : []));
  }
  const lines: Node[][] = [[]];
  for (const child of node.children ?? []) {
    const [first, ...rest] = splitAtLineBreaks(child);
    lines[lines.length - 1].push(...first);
    lines.push(...rest);
  }
  if (node.type !== "element") return lines;
  return lines.map((pieces) => (pieces.length ? [{ ...node, children: pieces }] : []));
}

/** Splits the code of each fence with options into numbered lines. */
export function rehypeCodeLines() {
  return (tree: Node) =>
    eachCodeBlock(tree, (code) => {
      const fence = code.data?.codeFence;
      if (!fence) return;
      const lines: Node[][] = [[]];
      for (const child of code.children ?? []) {
        const [first, ...rest] = splitAtLineBreaks(child);
        lines[lines.length - 1].push(...first);
        lines.push(...rest);
      }
      // The code ends with a line break, which leaves an empty last line.
      if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
      const drawn = codeLines(fence, lines.length);
      const digits = String(Math.max(...drawn.map((line) => line.number))).length;
      code.properties = {
        ...code.properties,
        dataCodeLines: "",
        ...(fence.lineNumbers ? { dataLineNumbers: "", dataDigits: String(digits) } : {}),
      };
      code.children = lines.map((pieces, index) => ({
        type: "element",
        tagName: "span",
        properties: {
          className: ["code-line"],
          ...(fence.lineNumbers ? { dataLine: String(drawn[index].number) } : {}),
          ...(drawn[index].highlighted ? { dataHighlighted: "" } : {}),
        },
        // Each line keeps its line break: copied code has its blank lines, and an empty line keeps its height.
        children: [...pieces, { type: "text", value: "\n" }],
      }));
    });
}
