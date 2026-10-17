import { describe, expect, it } from "vitest";
import { tokenizeMarkdown, type TokenKind } from "./markdownTokens";

/** The text of each coloured run, by kind: what a reader of the editor would see highlighted. */
function kinds(text: string): [TokenKind, string][] {
  return tokenizeMarkdown(text)
    .filter((segment) => segment.kind !== null)
    .map((segment) => [segment.kind!, segment.text]);
}

describe("tokenizeMarkdown", () => {
  it("always reproduces the text it was given", () => {
    const samples = [
      "",
      "plain",
      "# Title\r\n\r\nSome *text* with `code` and [a link](https://x.test).\r\n",
      "---\ntitle: a\n---\n# Hi\n\n```ts\nconst x = 1;\n",
      "> - nested **bold** and _emph_\n\n\n",
      "<Info>\n\n- one\n- two\n\n</Info>\n",
      "\\*not emphasis\\* and ``a ` b``",
      "* * *\n---\n",
      "x".repeat(5000) + "*",
    ];
    for (const text of samples) expect(tokenizeMarkdown(text).map((s) => s.text).join("")).toBe(text);
  });

  describe("blocks", () => {
    it("colours a heading line", () => {
      expect(kinds("## Section\nbody")).toEqual([["heading", "## Section"]]);
    });

    it("needs a space after the hashes", () => {
      expect(kinds("#hashtag")).toEqual([]);
      expect(kinds("####### seven")).toEqual([]);
    });

    it("colours frontmatter at the very top", () => {
      expect(kinds("---\ntitle: a\n---\nbody")).toEqual([["frontmatter", "---\ntitle: a\n---\n"]]);
    });

    it("does not treat a later --- block as frontmatter", () => {
      expect(kinds("text\n\n---\nnot: yaml\n---\n")).toEqual([
        ["rule", "---"],
        ["rule", "---"],
      ]);
    });

    it("colours a code fence and what is inside it, without reading Markdown there", () => {
      expect(kinds("```ts\n# not a heading\n*x*\n```\n# real")).toEqual([
        ["fence", "```ts"],
        ["code", "# not a heading"],
        ["code", "*x*"],
        ["fence", "```"],
        ["heading", "# real"],
      ]);
    });

    it("only closes a fence with the same character and at least as many", () => {
      expect(kinds("````\n```\n~~~\n````")).toEqual([
        ["fence", "````"],
        ["code", "```"],
        ["code", "~~~"],
        ["fence", "````"],
      ]);
    });

    it("keeps an unclosed fence open to the end", () => {
      expect(kinds("```\nstill code")).toEqual([
        ["fence", "```"],
        ["code", "still code"],
      ]);
    });

    it("does not open a fence on inline triple-backtick code", () => {
      expect(kinds("```code``` after")).toEqual([["code", "```code```"]]);
    });

    it("colours list and quote markers, then reads the rest of the line", () => {
      expect(kinds("- item *em*")).toEqual([
        ["marker", "- "],
        ["emphasis", "*em*"],
      ]);
      expect(kinds("1. one")).toEqual([["marker", "1. "]]);
      expect(kinds("> - quoted")).toEqual([["marker", "> - "]]);
    });

    it("does not take a hyphen inside a word, or an unspaced one, for a list", () => {
      expect(kinds("well-known")).toEqual([]);
      expect(kinds("-no")).toEqual([]);
    });

    it("colours thematic breaks", () => {
      expect(kinds("***\n_ _ _")).toEqual([
        ["rule", "***"],
        ["rule", "_ _ _"],
      ]);
    });

    it("needs three of one marker, with only spaces or tabs between them, and at most three spaces of indent", () => {
      expect(kinds("  - - -  \n---\t")).toEqual([
        ["rule", "  - - -  "],
        ["rule", "---\t"],
      ]);
      for (const line of ["--", "-*-", "--- a", "    ---", "-_-_"]) expect(kinds(line)).not.toContainEqual(["rule", line]);
    });

    it("stays fast on a long line that almost is a thematic break", () => {
      const started = Date.now();
      tokenizeMarkdown(`-${" ".repeat(50_000)}x`);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe("inline", () => {
    it("colours code spans, including double-backtick ones holding a backtick", () => {
      expect(kinds("a `b` c ``d ` e``")).toEqual([
        ["code", "`b`"],
        ["code", "``d ` e``"],
      ]);
    });

    it("does not read Markdown inside a code span", () => {
      expect(kinds("`**x**`")).toEqual([["code", "`**x**`"]]);
    });

    it("colours strong and emphasis", () => {
      expect(kinds("**b** and __b__ and *e* and _e_")).toEqual([
        ["strong", "**b**"],
        ["strong", "__b__"],
        ["emphasis", "*e*"],
        ["emphasis", "_e_"],
      ]);
    });

    it("leaves snake_case and spaced asterisks alone", () => {
      expect(kinds("snake_case_name and 2 * 3 * 4")).toEqual([]);
    });

    it("splits a link into its text and its address", () => {
      expect(kinds("see [docs](https://x.test/a_b_c) now")).toEqual([
        ["link", "[docs]"],
        ["url", "(https://x.test/a_b_c)"],
      ]);
      expect(kinds("![alt](images/a.png)")).toEqual([
        ["link", "![alt]"],
        ["url", "(images/a.png)"],
      ]);
    });

    it("colours MDX component tags", () => {
      expect(kinds('<Info>\n\n<Image src="a.png" alt="" />\n\n</Info>')).toEqual([
        ["tag", "<Info>"],
        ["tag", '<Image src="a.png" alt="" />'],
        ["tag", "</Info>"],
      ]);
    });

    it("skips an escaped delimiter", () => {
      expect(kinds("\\*not\\* but *this*")).toEqual([["emphasis", "*this*"]]);
    });

    it("does not span lines", () => {
      expect(kinds("*one\ntwo*")).toEqual([]);
    });

    it("leaves a very long line plain", () => {
      expect(kinds("*" + "a".repeat(3000) + "*")).toEqual([]);
    });
  });

  it("handles CRLF line endings", () => {
    expect(kinds("# a\r\n- b\r\n")).toEqual([
      ["heading", "# a"],
      ["marker", "- "],
    ]);
  });
});
