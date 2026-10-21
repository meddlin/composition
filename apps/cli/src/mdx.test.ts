import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MDX_COMPONENTS, parsePreview, type Block } from "./mdx";

const markdown = (source: string): Block => ({ kind: "markdown", source });
const info = (...blocks: Block[]): Block => ({ kind: "panel", tone: "info", blocks });
const warning = (...blocks: Block[]): Block => ({ kind: "panel", tone: "warning", blocks });
const image = (name: string, alt = "", title?: string): Block => ({ kind: "image", name, alt, ...(title ? { title } : {}) });

describe("parsePreview", () => {
  describe("notes without components", () => {
    it("leaves the note whole, untouched and unparsed", () => {
      const body = "# Title\n\nSome **text**.\n";
      expect(parsePreview(body)).toEqual({ blocks: [markdown(body)] });
    });

    it("accepts a stray < or { in prose, which MDX itself would reject", () => {
      const body = "if a < b and {x} then\n\n<div>not ours</div>\n\n<Banner />";
      expect(parsePreview(body)).toEqual({ blocks: [markdown(body)] });
    });

    it("keeps a component written inside a code fence as text", () => {
      const body = "```mdx\n<Info>\n\nnot a panel\n\n</Info>\n```";
      expect(parsePreview(body)).toEqual({ blocks: [markdown(body)] });
    });
  });

  describe("<Info> and <Warning>", () => {
    it("wraps the Markdown between the tags in a panel, keeping the text around it", () => {
      const body = "# Title\n\nintro\n\n<Info>\n\nStaging **resets**.\n\n- a\n- b\n\n</Info>\n\nafter";
      expect(parsePreview(body)).toEqual({
        blocks: [markdown("# Title\n\nintro"), info(markdown("Staging **resets**.\n\n- a\n- b")), markdown("after")],
      });
    });

    it("tells a warning from an info panel", () => {
      expect(parsePreview("<Warning>\n\nCareful.\n\n</Warning>").blocks).toEqual([warning(markdown("Careful."))]);
    });

    it("draws a one-line <Info>text</Info> as a panel too", () => {
      expect(parsePreview("before\n\n<Info>Remember **this**.</Info>\n\nafter").blocks).toEqual([
        markdown("before"),
        info(markdown("Remember **this**.")),
        markdown("after"),
      ]);
    });

    it("works without blank lines around the content", () => {
      expect(parsePreview("<Warning>\nhello *x*\n</Warning>").blocks).toEqual([warning(markdown("hello *x*"))]);
    });

    it("nests one panel in another", () => {
      const body = "<Info>\n\nouter\n\n<Warning>\n\ninner\n\n</Warning>\n\n</Info>";
      expect(parsePreview(body).blocks).toEqual([info(markdown("outer"), warning(markdown("inner")))]);
    });

    it("draws an empty panel", () => {
      expect(parsePreview("<Info>\n\n</Info>").blocks).toEqual([info()]);
    });

    it("keeps the content of a panel inside a list item, without its box", () => {
      const body = "- item\n\n  <Info>\n\n  inside\n\n  </Info>\n\n- two";
      expect(parsePreview(body).blocks).toEqual([markdown("- item\n\n  inside\n\n- two")]);
    });

    it("keeps the content of a panel inside a sentence, without its box", () => {
      expect(parsePreview("a <Info>b</Info> c <Warning>d</Warning> e").blocks).toEqual([markdown("a b c d e")]);
    });
  });

  describe("<Image>", () => {
    it("is an image block when the source is an image stored with the notes", async () => {
      expect(parsePreview('<Image src="app_data/route-map.png" alt="Route map" />').blocks).toEqual([
        image("route-map.png", "Route map"),
      ]);
    });

    it("is the same image when it also says how wide to draw it, which a terminal has no use for", () => {
      expect(parsePreview('<Image src="app_data/route-map.png" alt="Route map" width="50%" />').blocks).toEqual([
        image("route-map.png", "Route map"),
      ]);
    });

    it("carries a title", () => {
      expect(parsePreview(`<Image src="app_data/a.png" alt="A" title='The "A"' />`).blocks).toEqual([
        image("a.png", "A", 'The "A"'),
      ]);
    });

    it("is its Markdown form, shown as text, when the source isn't stored with the notes", () => {
      expect(parsePreview('<Image src="https://example.com/a.png" alt="Remote" />').blocks).toEqual([
        markdown("![Remote](https://example.com/a.png)"),
      ]);
    });

    it("escapes quotes in a title, and brackets in the alt text, in the Markdown form", () => {
      expect(parsePreview(`<Image src="https://x.test/a.png" alt="Map [1]" title='The "A"' />`).blocks).toEqual([
        markdown('![Map \\[1\\]](https://x.test/a.png "The \\"A\\"")'),
      ]);
    });

    it("wraps a source with spaces in the Markdown form", () => {
      expect(parsePreview('see <Image src="app_data/a b.png" alt="Map" /> here').blocks).toEqual([
        markdown("see ![Map](<app_data/a b.png>) here"),
      ]);
    });

    it("is the Markdown form inside a sentence, where a picture can't be drawn", () => {
      expect(parsePreview('see <Image src="app_data/a.png" alt="Map" /> here').blocks).toEqual([
        markdown("see ![Map](app_data/a.png) here"),
      ]);
    });

    it("shows nothing without a src, as on the web", () => {
      expect(parsePreview('before\n\n<Image alt="x" />\n\nafter').blocks).toEqual([markdown("before"), markdown("after")]);
    });

    it("can be the content of a panel", () => {
      expect(parsePreview('<Info>\n\n<Image src="app_data/a.png" alt="A" />\n\n</Info>').blocks).toEqual([
        info(image("a.png", "A")),
      ]);
    });
  });

  describe("<YouTube>", () => {
    const watch = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    it("is a Markdown link to the video, which the terminal can't play", () => {
      expect(parsePreview('<YouTube url="https://youtu.be/dQw4w9WgXcQ" />').blocks).toEqual([
        { kind: "markdown", source: `[▶ YouTube video](${watch})` },
      ]);
    });

    it("uses the title and the start time", () => {
      expect(parsePreview('<YouTube url="dQw4w9WgXcQ" start="1:30" title="The [demo]" />').blocks).toEqual([
        { kind: "markdown", source: `[▶ The \\[demo\\]](${watch}&t=90s)` },
      ]);
    });

    it("says so when it isn't a YouTube video, or has no url yet", () => {
      expect(parsePreview('<YouTube url="https://example.com/x" />').blocks).toEqual([
        { kind: "markdown", source: "Not a YouTube video: https://example.com/x" },
      ]);
      expect(parsePreview("<YouTube />").blocks).toEqual([{ kind: "markdown", source: "YouTube video: add a url" }]);
    });

    it("is the link inside a sentence, and the content of a panel", () => {
      expect(parsePreview('See <YouTube url="dQw4w9WgXcQ" /> now.').blocks).toEqual([
        { kind: "markdown", source: `See [▶ YouTube video](${watch}) now.` },
      ]);
      expect(parsePreview('<Info>\n\n<YouTube url="dQw4w9WgXcQ" />\n\n</Info>').blocks).toEqual([
        { kind: "panel", tone: "info", blocks: [{ kind: "markdown", source: `[▶ YouTube video](${watch})` }] },
      ]);
    });
  });

  describe("indented code", () => {
    it("is left as the note's own text, not read as a paragraph that could hold a tag", () => {
      const body = "<Info>\n\nhi\n\n</Info>\n\n    <Info>\n    not a panel\n    </Info>\n\nafter";

      expect(parsePreview(body).blocks).toEqual([info(markdown("hi")), markdown("    <Info>\n    not a panel\n    </Info>\n\nafter")]);
    });
  });

  describe("<Mark>", () => {
    it("keeps a highlight's text inside a sentence, without its tags", () => {
      expect(parsePreview('A <Mark color="yellow">very</Mark> **old** note.').blocks).toEqual([markdown("A very **old** note.")]);
    });

    it("keeps the text of a paragraph that is nothing but a highlight", () => {
      expect(parsePreview('<Mark color="green">all of it</Mark>').blocks).toEqual([markdown("all of it")]);
    });

    it("keeps Markdown inside a highlight, and highlights in list items and panels", () => {
      const body = '<Info>\n\n- <Mark color="pink">one</Mark> and [two](https://example.com)\n\n</Info>';
      expect(parsePreview(body).blocks).toEqual([info(markdown("- one and [two](https://example.com)"))]);
    });

    it("keeps the content of a highlight written on lines of its own", () => {
      expect(parsePreview('before\n\n<Mark color="blue">\n\nmiddle\n\n</Mark>\n\nafter').blocks).toEqual([
        markdown("before"),
        markdown("middle"),
        markdown("after"),
      ]);
    });
  });

  describe("Markdown images", () => {
    it("is an image block when a paragraph is just an image stored with the notes, which is what a paste inserts", () => {
      expect(parsePreview("# Trip\n\n![Route map](app_data/route-map-3f9c2a71b0de.png)\n\nAfter.").blocks).toEqual([
        markdown("# Trip"),
        image("route-map-3f9c2a71b0de.png", "Route map"),
        markdown("After."),
      ]);
    });

    it("needs no component in the note, and keeps a stray < or { out of the way", () => {
      expect(parsePreview("a < b and {x}\n\n![p](app_data/p.png)")).toEqual({
        blocks: [markdown("a < b and {x}"), image("p.png", "p")],
      });
    });

    it("takes the ./ form of the path, and a title", () => {
      expect(parsePreview('![p](./app_data/p.png "A title")').blocks).toEqual([image("p.png", "p", "A title")]);
    });

    it("is one block per image when a paragraph is only images, on separate lines or not", () => {
      expect(parsePreview("![a](app_data/a.png)\n![b](app_data/b.png)  ![c](app_data/c.png)").blocks).toEqual([
        image("a.png", "a"),
        image("b.png", "b"),
        image("c.png", "c"),
      ]);
    });

    it("stays text when the image shares its paragraph with words", () => {
      const body = "See ![p](app_data/p.png) here.";
      expect(parsePreview(body).blocks).toEqual([markdown(body)]);
      expect(parsePreview("![p](app_data/p.png) caption").blocks).toEqual([markdown("![p](app_data/p.png) caption")]);
    });

    it("stays text when any image in the paragraph can't be shown", () => {
      const body = "![a](app_data/a.png)\n![b](https://example.com/b.png)";
      expect(parsePreview(body).blocks).toEqual([markdown(body)]);
    });

    it("stays text for an address on the network, which the terminal does not fetch", () => {
      const body = "![remote](https://example.com/a.png)";
      expect(parsePreview(body).blocks).toEqual([markdown(body)]);
    });

    it("stays text when the path isn't a stored image's: another folder, a way out of it, another extension", () => {
      for (const src of ["images/a.png", "app_data/../a.png", "app_data/notes.txt", "app_data/sub/a.png", "/app_data/a.png"]) {
        const body = `![x](${src})`;
        expect(parsePreview(body).blocks, src).toEqual([markdown(body)]);
      }
    });

    it("stays text inside a list item, a quote, a link or a code fence", () => {
      for (const body of [
        "- ![p](app_data/p.png)",
        "> ![p](app_data/p.png)",
        "[![p](app_data/p.png)](https://example.com)",
        "```md\n![p](app_data/p.png)\n```",
      ]) {
        expect(parsePreview(body).blocks, body).toEqual([markdown(body)]);
      }
    });

    it("can be the content of a panel", () => {
      expect(parsePreview("<Info>\n\n![p](app_data/p.png)\n\n</Info>").blocks).toEqual([info(image("p.png", "p"))]);
    });

    it("leaves the note whole, unparsed, when there is no image syntax in it", () => {
      const body = "plain [link](https://example.com) and ![not closed](";
      expect(parsePreview(body)).toEqual({ blocks: [markdown(body)] });
    });
  });

  describe("<Toc>", () => {
    const toc = (body: string) => {
      const block = parsePreview(body).blocks.find((b) => b.kind === "toc");
      return block?.kind === "toc" ? block.entries : undefined;
    };

    it("lists the note's headings, nested by level, including those above and below it", () => {
      expect(toc("# Zero\n\n<Toc />\n\n# One\n\n## Two\n\n### Three\n\n# Four")).toEqual([
        { level: 0, text: "Zero" },
        { level: 0, text: "One" },
        { level: 1, text: "Two" },
        { level: 2, text: "Three" },
        { level: 0, text: "Four" },
      ]);
    });

    it("leaves the headings in the note too", () => {
      expect(parsePreview("<Toc />\n\n# One\n\n## Two").blocks).toEqual([
        { kind: "toc", entries: [{ level: 0, text: "One" }, { level: 1, text: "Two" }] },
        markdown("# One\n\n## Two"),
      ]);
    });

    it("stops at maxDepth", () => {
      expect(toc('<Toc maxDepth="2" />\n\n# One\n\n## Two\n\n### Three')).toEqual([
        { level: 0, text: "One" },
        { level: 1, text: "Two" },
      ]);
    });

    it("lists every level when maxDepth is not 1 to 6", () => {
      const note = "# One\n\n###### Six";
      expect(toc(`<Toc maxDepth="0" />\n\n${note}`)).toHaveLength(2);
      expect(toc(`<Toc maxDepth="9" />\n\n${note}`)).toHaveLength(2);
      expect(toc(`<Toc maxDepth="deep" />\n\n${note}`)).toHaveLength(2);
    });

    it("nests a heading under the closest shallower one, even after a skipped level", () => {
      expect(toc("<Toc />\n\n# One\n\n### Three\n\n## Two")).toEqual([
        { level: 0, text: "One" },
        { level: 1, text: "Three" },
        { level: 1, text: "Two" },
      ]);
    });

    it("counts headings inside a panel and reads their text without Markdown markers", () => {
      expect(toc("<Toc />\n\n<Info>\n\n## Inside *the* `box`\n\n</Info>")).toEqual([{ level: 0, text: "Inside the box" }]);
    });

    it("is empty when the note has no headings", () => {
      expect(toc("<Toc />\n\nJust prose.")).toEqual([]);
    });

    it("is not drawn inside a sentence or a list item", () => {
      expect(parsePreview("a <Toc /> b").blocks).toEqual([markdown("a  b")]);
    });
  });

  describe("footnotes", () => {
    const footnotes = (body: string) => {
      const block = parsePreview(body).blocks.find((b) => b.kind === "footnotes");
      return block?.kind === "footnotes" ? block.entries : undefined;
    };

    it("lists them at the end of a plain note, numbered by where they are cited, with each citation as a superscript number", () => {
      const body = "Intro[^b] and more[^a].\n\n[^a]: Alpha.\n[^b]: Beta.";
      expect(parsePreview(body)).toEqual({
        blocks: [
          markdown("Intro¹ and more²."),
          { kind: "footnotes", entries: [{ number: 1, text: "Beta." }, { number: 2, text: "Alpha." }] },
        ],
      });
    });

    it("renumbers when one is added between the others", () => {
      expect(footnotes("One[^1] new[^3] two[^2].\n\n[^1]: First.\n[^2]: Second.\n[^3]: Inserted.")?.map((e) => e.text)).toEqual([
        "First.",
        "Inserted.",
        "Second.",
      ]);
    });

    it("puts them where <Footnotes /> is, and not also at the end", () => {
      const body = "Cited[^a].\n\n<Footnotes />\n\nAfter.\n\n[^a]: Alpha.";
      expect(parsePreview(body).blocks).toEqual([
        markdown("Cited¹."),
        { kind: "footnotes", entries: [{ number: 1, text: "Alpha." }] },
        markdown("After."),
      ]);
    });

    it("draws an empty list for <Footnotes /> in a note with none, and leaves a second tag empty", () => {
      expect(parsePreview("Text.\n\n<Footnotes />").blocks).toEqual([markdown("Text."), { kind: "footnotes", entries: [] }]);
      const blocks = parsePreview("A[^a].\n\n[^a]: Alpha.\n\n<Footnotes />\n\n<Footnotes />").blocks;
      expect(blocks.filter((b) => b.kind === "footnotes")).toEqual([
        { kind: "footnotes", entries: [{ number: 1, text: "Alpha." }] },
        { kind: "footnotes", entries: [] },
      ]);
    });

    it("keeps a link's address and reads the rest as plain words", () => {
      expect(footnotes("A[^a] B[^b] C[^c].\n\n[^a]: See [the **docs**](https://a.example) and `code`.\n[^b]: <https://b.example>\n[^c]: ![chart](x.png) after.")).toEqual([
        { number: 1, text: "See the docs (https://a.example) and code." },
        { number: 2, text: "https://b.example" },
        { number: 3, text: "chart after." },
      ]);
    });

    it("numbers a citation inside a footnote after those in the note", () => {
      expect(footnotes("First[^a] second[^c].\n\n[^a]: Alpha, see also[^b].\n[^b]: Beta.\n[^c]: Gamma.")).toEqual([
        { number: 1, text: "Alpha, see also³." },
        { number: 2, text: "Gamma." },
        { number: 3, text: "Beta." },
      ]);
    });

    it("counts citations in panels and list items, and leaves an undefined or uncited one alone", () => {
      const body = "- item[^a]\n\n<Info>\n\nin a panel[^a] and[^missing]\n\n</Info>\n\n[^a]: Alpha.\n[^unused]: Never cited.";
      expect(parsePreview(body).blocks).toEqual([
        markdown("- item¹"),
        info(markdown("in a panel¹ and[^missing]")),
        { kind: "footnotes", entries: [{ number: 1, text: "Alpha." }] },
      ]);
    });

    it("writes a number of more than one digit in superscript digits", () => {
      const cites = Array.from({ length: 12 }, (_, i) => `x[^${i + 1}]`).join(" ");
      const defs = Array.from({ length: 12 }, (_, i) => `[^${i + 1}]: n${i + 1}`).join("\n");
      expect(parsePreview(`${cites}\n\n${defs}`).blocks[0]).toEqual(markdown("x¹ x² x³ x⁴ x⁵ x⁶ x⁷ x⁸ x⁹ x¹⁰ x¹¹ x¹²"));
    });

    it("is not drawn inside a sentence or a list item", () => {
      expect(parsePreview("a <Footnotes /> b").blocks).toEqual([markdown("a  b")]);
    });

    it("leaves a note that cites nothing as it was written", () => {
      const body = "no footnotes here, only [^ brackets]";
      expect(parsePreview(body).blocks).toEqual([markdown(body)]);
    });
  });

  describe("invalid MDX", () => {
    it("says what is wrong, with its position, above the whole note as plain Markdown", () => {
      const body = "<Info>\n\nunfinished";
      expect(parsePreview(body)).toEqual({
        blocks: [markdown(body)],
        error: "Expected a closing tag for `<Info>` (1:1-1:7)",
      });
    });

    it("rejects a tag that isn't in the allowlist, once the note uses a component", () => {
      const { error } = parsePreview("<Info>\n\nfine\n\n</Info>\n\n<Banner />");
      expect(error).toBe("Unknown component <Banner>. Available: <Info>, <Warning>, <Image>, <Toc>, <Mark>, <Footnotes>, <YouTube>.");
    });

    it("rejects {expressions}, import and export, and fragments: nothing is evaluated", () => {
      expect(parsePreview("<Info>{1 + 1}</Info>").error).toBe("{expressions} are not supported.");
      expect(parsePreview('<Image src={"a.png"} />').error).toBe("{expressions} are not supported.");
      expect(parsePreview("import x from 'y'\n\n<Info>\n\nhi\n\n</Info>").error).toBe("import and export are not supported.");
      expect(parsePreview("<>\n\n<Info>\n\nhi\n\n</Info>\n\n</>").error).toBe("Fragments (<>…</>) are not supported.");
    });

    it("goes away as soon as the note is valid again", () => {
      expect(parsePreview("<Info>\n\nhalf").error).toBeDefined();
      expect(parsePreview("<Info>\n\nhalf\n\n</Info>").error).toBeUndefined();
    });
  });
});

describe("MDX_COMPONENTS", () => {
  it("is the web app's allowlist", () => {
    // The components are React, so they can't be imported here; the names are read from the source.
    const source = fs.readFileSync(path.join(__dirname, "../../web/src/components/notes/mdx/components.ts"), "utf-8");
    const listed = /=\s*\{\s*([\w\s,]+?)\s*\}\s*;/.exec(source)?.[1];
    expect(listed, "could not find mdxComponents in the web app's components.ts").toBeDefined();
    const web = listed!.split(",").map((name) => name.trim()).filter(Boolean);
    expect([...MDX_COMPONENTS].sort()).toEqual(web.sort());
  });
});
