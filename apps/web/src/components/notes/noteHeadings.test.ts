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

  it("finds setext headings: a paragraph underlined with === (level 1) or --- (level 2), at its first line", () => {
    const text = "Title\n=====\n\nIntro.\n\nTwo *line*\nsection\n---\n\n   Indented\n  ---  ";
    expect(extractHeadings(text)).toEqual([
      { level: 1, label: "Title", offset: 0 },
      { level: 2, label: "Two line section", offset: text.indexOf("Two") },
      { level: 2, label: "Indented", offset: text.indexOf("   Indented") },
    ]);
  });

  it("takes --- for a rule, not an underline, where Preview does", () => {
    for (const text of ["a\n\n---", "- item\n---", "> quote\n---", "# x\n---", "<div>\n---", "    code\n---", "[a]: /url\n===", "a\n= ="]) {
      expect(extractHeadings(text).filter((h) => h.label !== "x"), text).toEqual([]);
    }
  });

  it("takes a thematic break, spaced or not, for the end of a list or a quote", () => {
    for (const rule of ["***", "* * *", " _ _ _ ", "- - -", "-\t-\t-"]) {
      const text = `- item\n${rule}\nAfter\n===`;
      expect(extractHeadings(text), rule).toEqual([{ level: 1, label: "After", offset: text.indexOf("After") }]);
    }
    // Not a rule: two marks, mixed marks, or four spaces in front.
    for (const line of ["**", "*-*", "    ***"]) expect(extractHeadings(`- item\n${line}\nAfter\n===`), line).toEqual([]);
  });

  it("leaves a setext underline inside fenced code and the frontmatter alone", () => {
    const text = "---\ntitle: x\n---\n```\nnot\n---\n```\nBody\n===";
    expect(extractHeadings(text, text.indexOf("```"))).toEqual([{ level: 1, label: "Body", offset: text.indexOf("Body") }]);
  });
});
