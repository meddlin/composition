import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkIndentedCode } from "./remarkIndentedCode";

type Node = { type: string; value?: string; children?: Node[] };
const parse = (text: string, keepIndentedCode: boolean) => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
  if (keepIndentedCode) processor.use(remarkIndentedCode);
  return (processor.parse(text) as Node).children!;
};
const types = (text: string, keep = true) => parse(text, keep).map((n) => n.type);

const NOTE = "before\n\n    indented code\n\nafter";

describe("remarkIndentedCode", () => {
  it("is needed: MDX alone reads an indented block as a paragraph", () => {
    expect(types(NOTE, false)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("reads an indented block as code again, as Markdown does", () => {
    const nodes = parse(NOTE, true);

    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "code", "paragraph"]);
    expect(nodes[1].value).toBe("indented code");
  });

  it("leaves what else MDX changes alone: components, and no HTML", () => {
    expect(types("<Info>\n\nhi\n\n</Info>")).toEqual(["mdxJsxFlowElement"]);
    expect(() => parse("a <b>c</b> d", true)).not.toThrow();
    expect(types("a <b>c</b> d")).toEqual(["paragraph"]);
    expect(() => parse("{1 + 1}", true)).not.toThrow();
    expect(types("{1 + 1}")).toEqual(["mdxFlowExpression"]);
  });

  it("does not turn an indented line inside a list or a paragraph into code", () => {
    expect(types("- item\n\n      still the item\n")).toEqual(["list"]);
    expect(types("a paragraph\n    continued")).toEqual(["paragraph"]);
  });
});
