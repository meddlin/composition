// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "@/lib/composition/frontmatter";
import { highlightRange } from "./highlightText";
import { NoteMarkdown } from "./NoteMarkdown";
import { SOURCE_ATTRIBUTE, sourceRangeOf } from "./previewSource";

/**
 * Selections in the rendered preview, made at random over notes that use most of Markdown, are taken
 * all the way through: traced back to the note's text, highlighted, and rendered again. What ends up
 * highlighted has to be exactly what was selected. This is what stands behind "highlight from the
 * preview", where one wrong offset would highlight the wrong words.
 */

// HIGHLIGHT_FUZZ_SEED and HIGHLIGHT_FUZZ_ATTEMPTS widen the search; a failure names its range, so it can be reproduced.
const SEED = Number(process.env.HIGHLIGHT_FUZZ_SEED ?? 0);
const ATTEMPTS = Number(process.env.HIGHLIGHT_FUZZ_ATTEMPTS ?? 150);

// A small seeded generator, so a failure can be reproduced.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES: Record<string, string> = {
  prose: "Hello *there*, **big** and ***bold-italic*** world with ~~gone~~ text.\n\nSecond paragraph, with a [link](https://example.com/page) and `code` inside.",
  "headings and lists":
    "# Title here\n\n## Sub *title*\n\n- one item\n- two **bold** item\n  - nested item\n  - another nested\n\n1. first\n2. second\n\n- [ ] a task\n- [x] done task",
  "quotes and wrapping":
    "> a quoted line\n> continues here\n>\n> > nested quote\n> > goes on\n\nA hard-wrapped\nparagraph that\nspans lines.\n\n- a list item that\n  wraps onto a second line\n- next",
  "escapes and breaks":
    "snake\\_case and \\*literal\\* stars and a \\\\ backslash.\n\nline one  \nline two after a break\\\nline three\n\nPrice is 5 > 3 and done.",
  table: "| Name | Value |\n| ---- | ----- |\n| alpha | one **two** |\n| beta | three |\n\nAfter the table.",
  "code around text": "Before `inline` after.\n\n```js\nconst x = 1;\n```\n\nBetween blocks.\n\n~~~\ntilde fence\n~~~\n\nEnd text.",
  "callouts": "Intro text.\n\n<Info>\n\nInside **the** callout with `code`.\n\n- item a\n- item b\n\n</Info>\n\n<Warning>\n\nCareful now.\n\n</Warning>\n\nOutro.",
  "reference style": "Setext Title\n============\n\nSee [the docs][ref] and ![alt text](img.png) here, or [inline *styled* link](https://x.y/z).\n\n[ref]: https://example.com\n\n* star item\n+ plus item\n- dash item\n\nSub heading\n-----------\n\nEnd.",
  "quote in list": "- item one\n\n  > quoted inside\n  > the item\n\n- item two with `code` and **bold**\n  continues here",
  unicode: "Café naïve — “smart quotes” and emoji 😀 mid-sentence, plus 日本語 text.\n\nAnother 😀😀 line.",
  frontmatter: "---\ntitle: A title\ntags: [a, b]\n---\nBody text after frontmatter.\n\n## Heading\n\nMore body text here.",
  "existing highlights":
    'Some <Mark color="yellow">already highlighted</Mark> text and <Mark color="green">**bold marked**</Mark> too.\n\nPlain second paragraph.',
};

/** Everything of the rendered text a highlight could cover, whitespace aside. */
const squash = (text: string) => text.replace(/\s+/g, "");

function eligibleText(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(`[${SOURCE_ATTRIBUTE}]`)].map((el) => el.firstChild as Text);
}

function selectedText(nodes: Text[], range: Range): string {
  return nodes
    .filter((node) => range.intersectsNode(node))
    .map((node) => node.data.slice(range.startContainer === node ? range.startOffset : 0, range.endContainer === node ? range.endOffset : node.length))
    .join("");
}

describe("highlighting what is selected in the preview", () => {
  afterEach(cleanup);

  it("leaves a bare web address as it is and highlights the words around it", () => {
    const text = "Visit https://example.com today please";
    const { container } = render(<NoteMarkdown body={text} rehypePlugins={[]} />);
    const range = document.createRange();
    const nodes = eligibleText(container);
    range.setStart(nodes[0], 0);
    range.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].length);

    const found = sourceRangeOf(container, range, text);
    const result = found.ok ? highlightRange(text, found, "pink") : null;

    expect(result).toMatchObject({ ok: true, text: 'Visit https://example.com today please'.replace("Visit", '<Mark color="pink">Visit</Mark>').replace("today please", '<Mark color="pink">today please</Mark>') });
  });

  describe.each(Object.entries(NOTES))("%s", (name, text) => {
    it("highlights exactly the selected text", () => {
      const next = random([...name].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7) + SEED);
      const [, body] = parse(text);
      const frontmatterLength = text.length - body.length;
      const { container } = render(<NoteMarkdown body={body} rehypePlugins={[]} />);
      const nodes = eligibleText(container);
      expect(nodes.length).toBeGreaterThan(0);

      let highlighted = 0;
      const problems: string[] = [];
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const a = nodes[Math.floor(next() * nodes.length)];
        const b = nodes[Math.floor(next() * nodes.length)];
        const range = document.createRange();
        const [first, last] = a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING || a === b ? [a, b] : [b, a];
        let from = Math.floor(next() * (first.length + 1));
        let to = Math.floor(next() * (last.length + 1));
        if (first === last && from > to) [from, to] = [to, from];
        range.setStart(first, from);
        range.setEnd(last, to);

        const expected = squash(selectedText(nodes, range));
        const found = sourceRangeOf(container, range, body);
        if (!found.ok) {
          if (expected !== "" && !found.reason.includes("&")) problems.push(`not traced: ${JSON.stringify(expected)}: ${found.reason}`);
          continue;
        }
        if (expected === "") continue;

        const result = highlightRange(text, { start: frontmatterLength + found.start, end: frontmatterLength + found.end }, "pink");
        if (!result.ok) {
          problems.push(`refused ${JSON.stringify(expected)} [${found.start},${found.end}] ${JSON.stringify(body.slice(found.start, found.end))}: ${result.reason.slice(0, 60)}`);
          continue;
        }
        highlighted++;

        const [, newBody] = parse(result.text);
        const again = render(<NoteMarkdown body={newBody} rehypePlugins={[]} />);
        const pink = squash([...again.container.querySelectorAll('mark[data-color="pink"]')].map((m) => m.textContent).join(""));
        again.unmount();
        // Highlighting something already highlighted recolours all of that highlight, so more can be pink.
        const ok = text.includes("<Mark") ? pink.includes(expected) : pink === expected;
        if (!ok) problems.push(`wrong text: selected ${JSON.stringify(expected)}, highlighted ${JSON.stringify(pink)}`);
      }

      expect(problems).toEqual([]);
      expect(highlighted).toBeGreaterThan(20);
    });
  });
});
