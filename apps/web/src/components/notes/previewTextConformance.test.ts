import fs from "node:fs";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  conformancePath,
  UPDATING_FIXTURES,
} from "../../lib/composition/__fixtures__/conformance";

/**
 * The preview's text as the desktop reads it, for the native cores to replay: `fixtures/conformance/preview-text.json` (see
 * fixtures/conformance/README.md). A note that mentions no component is drawn by `NoteMarkdown` with remark-gfm alone, which
 *
 *   - makes a bare web or e-mail address a link (GFM's autolink literals: `https://…`, `http://…`, `www.…`, `name@host.tld`), and
 *   - leaves straight quotes, `--`, `---` and `...` as they are written (no smart punctuation).
 *
 * swift-markdown, as the iPad called it until 2026-11-20, did neither, so these lines pin both. Each case is a short note and,
 * for every block that holds text (a paragraph, a heading, a table cell) in the order written, what remark-gfm made of its text.
 * A change to the TypeScript behaviour fails here until the fixture is regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest run
 * src/components/notes/previewTextConformance.test.ts`), which is the prompt to update the native side too.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Mdast = { type: string; value?: string; url?: string; children?: Mdast[] };

const CASES: string[] = [
  // Web addresses with a scheme
  "https://example.com",
  "Go to https://example.com/path?q=1&r=2#frag now.",
  "http://localhost:3000/x has no dot in its host",
  "HTTPS://EXAMPLE.COM/UPPER",
  "Read (https://en.wikipedia.org/wiki/Foo_(bar)) first.",
  "An unbalanced one: https://example.com/path) here",
  "https://example.com/a_b_c_",
  "https://example.com/foo.",
  "https://example.com/foo, then",
  "https://example.com/foo!?",
  "https://example.com/foo: then",
  "https://example.com/foo; then",
  "https://example.com/foo...",
  "https://example.com/~user/a~",
  "https://example.com/~user",
  "https://example.com/a~",
  "https://example.com/'quoted'",
  "https://example.com/path]",
  "https://example.com/path]x",
  "https://example.com/a*",
  "https://a",
  "https://a.b_c",
  "https://a_b.c.d",
  "https://日本.example/パス",
  "ftp://example.com is not one",
  "xhttp://example.com is not one",
  "http:// alone",
  "http://.example.com",
  "https://-example.com",
  "Two: https://a.example and https://b.example.",
  "Visit https://example.com/a\nand more on the next line",
  "https://example.com/a  \nafter a hard break",
  // `www.`
  "www.example.com",
  "Visit www.example.com.",
  "WWW.EXAMPLE.COM",
  "www.example",
  "www.",
  "www.x",
  "xwww.example.com",
  "(www.example.com)",
  "x:www.example.com",
  "a.www.example.com",
  "www.example.com/a_b and www.example.com/c_",
  "www.ex_ample.com",
  "www.example.c_m",
  "www.example.com/path?x=(1)",
  // E-mail addresses
  "me@example.com",
  "Mail me@example.com.",
  "first.last+tag@sub.example.co.uk",
  "me@example",
  "me@example.com_",
  "me@example.co1",
  "me@example.com-",
  "a/me@example.com",
  "mailto:me@example.com",
  "a@b.c",
  "@example.com",
  "me@-example.com",
  "x.y-z_w+v@example.org!",
  "Write to me@example.com or you@example.org, please.",
  // Where else an address is, and where it is not one
  "<https://example.com>",
  "[https://example.com](https://other.example)",
  "[a link](https://example.com) then www.example.com",
  "`https://example.com`",
  "**https://example.com**",
  "*see https://example.com*",
  "_me@example.com_",
  "~~www.example.com~~",
  "- see https://example.com\n- mail me@example.com",
  "> quoted www.example.com",
  "## Heading www.example.com",
  "| a | b |\n|---|---|\n| https://example.com | me@example.com |",
  // Punctuation stays as written
  "\"Double\" and 'single' quotes",
  "en -- dash, em --- dash",
  "Wait...",
  "It's 5 o'clock",
  "# Don't -- stop...",
  'He said "https://example.com" -- twice.',
];

/**
 * The text of a block as remark-gfm makes it: `{text}`, `{link, children}`, `{emphasis}`, `{strong}`, `{strikethrough}`, `{code}`, `{break}`.
 * Neighbouring text nodes are written as one (the autolink transform leaves an address's trailing punctuation a node of its own, which draws
 * the same), and a soft line break is the `\n` in the text.
 */
function inlines(nodes: Mdast[]): Json[] {
  const out: Json[] = [];
  for (const item of nodes.map(inline)) {
    const last = out[out.length - 1] as { text?: string } | undefined;
    const text = (item as { text?: string }).text;
    if (text !== undefined && last?.text !== undefined) last.text += text;
    else out.push(item);
  }
  return out;
}

function inline(node: Mdast): Json {
  switch (node.type) {
    case "text":
      return { text: node.value ?? "" };
    case "link":
      return { link: node.url ?? "", children: inlines(node.children ?? []) };
    case "emphasis":
      return { emphasis: inlines(node.children ?? []) };
    case "strong":
      return { strong: inlines(node.children ?? []) };
    case "delete":
      return { strikethrough: inlines(node.children ?? []) };
    case "inlineCode":
      return { code: node.value ?? "" };
    case "break":
      return { break: true };
    default:
      return { other: node.type };
  }
}

/** Every block that holds text, in the order written. */
function textBlocks(node: Mdast, out: Json[] = []): Json[] {
  for (const child of node.children ?? []) {
    if (child.type === "paragraph" || child.type === "heading")
      out.push({ block: child.type, inlines: inlines(child.children ?? []) });
    else if (child.type === "tableCell")
      out.push({ block: "cell", inlines: inlines(child.children ?? []) });
    else textBlocks(child, out);
  }
  return out;
}

const parse = (markdown: string) =>
  unified().use(remarkParse).use(remarkGfm).parse(markdown) as Mdast;

function build(): { [key: string]: Json } {
  return {
    about:
      "What the desktop's preview (remark-gfm, as NoteMarkdown draws a note with no component) makes of the text of each note: bare addresses " +
      "become links, quotes, dashes and dots stay as written. Made by apps/web/src/components/notes/previewTextConformance.test.ts.",
    cases: CASES.map((markdown) => ({
      markdown,
      blocks: textBlocks(parse(markdown)),
    })),
  };
}

function pretty(value: Json, indent = ""): string {
  const flat = JSON.stringify(value);
  if (
    flat.length + indent.length <= 150 ||
    value === null ||
    typeof value !== "object"
  )
    return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`,
  );
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

describe("the preview text fixture (fixtures/conformance/preview-text.json)", () => {
  const file = conformancePath("preview-text.json");

  it(
    UPDATING_FIXTURES
      ? "is rewritten from the TypeScript behaviour"
      : "is what the TypeScript makes",
    () => {
      const fixture = build();
      if (UPDATING_FIXTURES) {
        fs.writeFileSync(file, `${pretty(fixture)}\n`);
        return;
      }
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(fixture);
    },
  );

  it("covers what it is meant to", () => {
    const text = JSON.stringify(build().cases);
    for (const url of [
      '"link":"https://example.com"',
      '"link":"http://www.example.com"',
      '"link":"mailto:me@example.com"',
      '"link":"http://localhost:3000/x"',
    ]) {
      expect(text, url).toContain(url);
    }
    // No curly quotes, dashes or ellipsis anywhere: the punctuation is as written.
    expect(text).not.toMatch(/[‘’“”–—…]/);
  });
});
