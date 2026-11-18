import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { liveFrontmatterField } from "./liveFrontmatter";
import { TOC, tocHeadings, tocMaxDepth } from "./liveToc";
import type { TocHeading } from "./mdx/remarkHeadings";
import { NoteMarkdown } from "./NoteMarkdown";
import { fragmentOffset } from "./noteLinkActions";

const NOTE = "---\ntitle: A note\n---\n<Toc />\n\n# Intro\n\nText.\n\nSetext *two*\n------------\n\n## Intro\n\n```\n# not a heading\n```\n\n### Last [link](https://x.y)";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), liveFrontmatterField] });

describe("<Toc /> in Live", () => {
  it("lists the note's headings, setext ones included, as Preview's table of contents does", () => {
    const live = JSON.parse(tocHeadings(stateOf(NOTE))) as TocHeading[];
    expect(live.map(({ depth, text }) => [depth, text])).toEqual([
      [1, "Intro"],
      [2, "Setext two"],
      [2, "Intro"],
      [3, "Last link"],
    ]);
    // Preview: the same entries, each linking to an id that ends in the same slug.
    const body = NOTE.slice(NOTE.indexOf("<Toc"));
    const html = renderToStaticMarkup(<NoteMarkdown body={body} rehypePlugins={[]} />);
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    const entries = [...nav.matchAll(/href="#([^"]+)"[^>]*>([^<]*)</g)].map((match) => ({ id: match[1], text: match[2] }));
    expect(entries.map((entry) => entry.text)).toEqual(live.map((heading) => heading.text));
    entries.forEach((entry, index) => expect(entry.id.endsWith(`-${live[index].id}`)).toBe(true));
  });

  it("gives each entry the id that `#heading` links find, so a click scrolls to that heading", () => {
    const live = JSON.parse(tocHeadings(stateOf(NOTE))) as TocHeading[];
    const bodyStart = NOTE.indexOf("<Toc");
    expect(live.map((heading) => fragmentOffset(NOTE, heading.id, bodyStart))).toEqual([
      NOTE.indexOf("# Intro"),
      NOTE.indexOf("Setext"),
      NOTE.indexOf("## Intro"),
      NOTE.indexOf("### Last"),
    ]);
  });

  it("is a `<Toc />` on a line of its own, with or without a maxDepth", () => {
    expect(TOC.accepts!("<Toc />")).toBe(true);
    expect(TOC.accepts!('<Toc maxDepth="2" />')).toBe(true);
    expect(TOC.accepts!("<Toc></Toc>")).toBe(false);
    expect(TOC.accepts!("<Tocx />")).toBe(false);
    expect(tocMaxDepth('<Toc maxDepth="2" />')).toBe("2");
    expect(tocMaxDepth("<Toc maxDepth={3} />")).toBe("3");
    expect(tocMaxDepth("<Toc />")).toBeUndefined();
  });
});
