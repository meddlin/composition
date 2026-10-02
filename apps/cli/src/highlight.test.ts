import { describe, expect, it } from "vitest";
import { markdownSpans, type Span } from "./highlight";

/** The text each span covers, with its style: easier to read than offsets. */
function covered(text: string): [string, string][] {
  const lines = text.split("\n");
  return markdownSpans(text).map((span) => [span.style, lines[span.line].slice(span.start, span.end)]);
}

describe("markdownSpans", () => {
  it("finds nothing in plain text", () => {
    expect(markdownSpans("just some words\nand more")).toEqual([]);
  });

  it("styles a whole heading line, at any level", () => {
    expect(covered("# One\n###### Six\nnot # a heading")).toEqual([
      ["heading", "# One"],
      ["heading", "###### Six"],
    ]);
  });

  it("does not take a hash without a space for a heading", () => {
    expect(markdownSpans("#hashtag")).toEqual([]);
  });

  it("styles the frontmatter block as metadata, delimiters included", () => {
    expect(covered("---\ntitle: Hi\ntags: [a]\n---\n# Body")).toEqual([
      ["meta", "---"],
      ["meta", "title: Hi"],
      ["meta", "tags: [a]"],
      ["meta", "---"],
      ["heading", "# Body"],
    ]);
  });

  it("only treats --- as frontmatter on the very first line", () => {
    expect(markdownSpans("text\n---\nmore\n---")).toEqual([]);
  });

  it("styles a fenced code block, fences and all, and nothing inside it", () => {
    expect(covered("```ts\nconst **x** = `y`;\n```\nafter **bold**")).toEqual([
      ["code", "```ts"],
      ["code", "const **x** = `y`;"],
      ["code", "```"],
      ["bold", "**bold**"],
    ]);
  });

  it("runs an unterminated fence to the end of the note", () => {
    expect(covered("```\nstill code\nmore")).toEqual([
      ["code", "```"],
      ["code", "still code"],
      ["code", "more"],
    ]);
  });

  it("styles inline code, bold, italic and links", () => {
    expect(covered("a `code` b **bold** c __also__ d *it* e _em_ f [text](https://x.dev) g")).toEqual([
      ["code", "`code`"],
      ["bold", "**bold**"],
      ["bold", "__also__"],
      ["italic", "*it*"],
      ["italic", "_em_"],
      ["link", "[text](https://x.dev)"],
    ]);
  });

  it("styles an image like a link", () => {
    expect(covered("see ![alt](pic.png) here")).toEqual([["link", "![alt](pic.png)"]]);
  });

  it("keeps markers inside inline code literal", () => {
    expect(covered("`**not bold**` then **bold**")).toEqual([
      ["code", "`**not bold**`"],
      ["bold", "**bold**"],
    ]);
  });

  it("styles list markers and task boxes", () => {
    expect(covered("- one\n  * two\n+ three\n12. four\n- [ ] todo\n- [x] done")).toEqual([
      ["marker", "- "],
      ["marker", "* "],
      ["marker", "+ "],
      ["marker", "12. "],
      ["marker", "- [ ] "],
      ["marker", "- [x] "],
    ]);
  });

  it("does not mistake a list marker for italics", () => {
    expect(covered("* item with *emphasis*")).toEqual([
      ["marker", "* "],
      ["italic", "*emphasis*"],
    ]);
  });

  it("styles a quote marker", () => {
    expect(covered("> quoted **text**")).toEqual([
      ["quote", "> "],
      ["bold", "**text**"],
    ]);
  });

  it("styles an unterminated marker as nothing", () => {
    expect(markdownSpans("a ** b and `c and [d](")).toEqual([]);
  });

  it("reports line and column positions for accented text", () => {
    const spans: Span[] = markdownSpans("café **gras**");
    expect(spans).toEqual([{ line: 0, start: 5, end: 13, style: "bold" }]);
  });

  it("ignores a carriage return at the end of a line", () => {
    expect(covered("# Title\r\n**b**\r")).toEqual([
      ["heading", "# Title"],
      ["bold", "**b**"],
    ]);
  });
});
