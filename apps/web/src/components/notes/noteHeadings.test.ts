import { describe, expect, it } from "vitest";
import { extractHeadings } from "./noteHeadings";

describe("extractHeadings", () => {
  it("finds each heading with its level, text and the offset of its line", () => {
    const text = "# One\n\ntext\n\n## Two\n### Three";
    expect(extractHeadings(text)).toEqual([
      { level: 1, label: "One", offset: 0 },
      { level: 2, label: "Two", offset: text.indexOf("## Two") },
      { level: 3, label: "Three", offset: text.indexOf("### Three") },
    ]);
  });

  it("skips fenced code, whatever fence closes it", () => {
    const text = "# Real\n```sh\n# not a heading\n```\n~~~\n## nor this\n~~~\n## Also real";
    expect(extractHeadings(text).map((h) => h.label)).toEqual(["Real", "Also real"]);
  });

  it("does not let a shorter or different fence close a block", () => {
    const text = "````\n```\n# inside\n~~~~\n````\n# after";
    expect(extractHeadings(text).map((h) => h.label)).toEqual(["after"]);
  });

  it("needs a space after the hashes, and at most three spaces before them", () => {
    expect(extractHeadings("#nope\n    # indented code\n####### seven\n   # ok")).toEqual([
      { level: 1, label: "ok", offset: "#nope\n    # indented code\n####### seven\n".length },
    ]);
  });

  it("drops closing hashes and the Markdown that only styles the text", () => {
    expect(extractHeadings("## A **bold** [link](http://x) `code` ##")[0].label).toBe("A bold link code");
  });

  it("keeps an empty heading, so the rail still counts it", () => {
    expect(extractHeadings("#\n")).toEqual([{ level: 1, label: "", offset: 0 }]);
  });

  it("leaves out the frontmatter", () => {
    const text = "---\ntitle: x\n# comment: y\n---\n# Body";
    expect(extractHeadings(text, text.indexOf("# Body")).map((h) => h.label)).toEqual(["Body"]);
  });
});
