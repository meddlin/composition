import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { noteLinksFacet } from "./liveLinks";
import { bodyStart, liveDecorations } from "./liveMarkdown";
import type { NoteLinks } from "./noteLinkActions";

type Link = { text: string; href: string; title: string; dead: boolean };

/** What the Live editor draws of `text`'s links with the caret at `caret`: the text shown, the links, and what is dimmed. */
function draw(text: string, caret: number, links: NoteLinks = { exists: () => true, open: () => {} }) {
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage }), noteLinksFacet.of(links)],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const set = liveDecorations(state, [{ from: 0, to: state.doc.length }], bodyStart(text));
  const hidden: [number, number][] = [];
  const found: Link[] = [];
  const dimmed: string[] = [];
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; attributes?: Record<string, string> };
    if (value.point && from < to) hidden.push([from, to]);
    else if (spec.class?.includes("cm-live-link")) {
      found.push({
        text: text.slice(from, to),
        href: spec.attributes!["data-href"],
        title: spec.attributes!.title,
        dead: spec.class.includes("cm-live-link-dead"),
      });
    } else if (spec.class === "cm-live-syntax") dimmed.push(text.slice(from, to));
  });
  // What reads on screen: the document with the hidden stretches taken out (the set's layers come out unsorted).
  let shown = "";
  let at = 0;
  for (const [from, to] of hidden.sort((a, b) => a[0] - b[0])) {
    shown += text.slice(at, from);
    at = to;
  }
  shown += text.slice(at);
  return { shown, links: found, dimmed };
}

describe("a Markdown link", () => {
  const text = 'See [the docs](https://example.com/docs "The docs") now.';

  it("is drawn as its text, with the brackets and the address hidden, while the caret is elsewhere", () => {
    const { shown, links } = draw(text, text.length);
    expect(shown).toBe("See the docs now.");
    expect(links).toEqual([
      expect.objectContaining({ text: "the docs", href: "https://example.com/docs", dead: false }),
    ]);
  });

  it("has the address, and the title when there is one, as its tooltip", () => {
    const { links } = draw(text, text.length);
    expect(links[0].title.split("\n").slice(0, 2)).toEqual(["The docs", "https://example.com/docs"]);
    expect(draw("[x](https://a.b) tail", 20).links[0].title.split("\n")[0]).toBe("https://a.b");
  });

  it("shows its source, the brackets dimmed, while the caret is in it, so the text and the address can be edited", () => {
    for (const caret of [4, 8, 20, text.indexOf(")") + 1]) {
      const { shown, links, dimmed } = draw(text, caret);
      expect(shown).toBe(text);
      // Still drawn as a link, so it reads as one while it is being edited.
      expect(links.map((link) => link.text)).toEqual(["the docs"]);
      expect(dimmed).toEqual(["[", "]", "(", ")"]);
    }
  });

  it("hides again once the caret has moved off it", () => {
    expect(draw(text, text.indexOf(")") + 2).shown).toBe("See the docs now.");
    expect(draw(text, 3).shown).toBe("See the docs now.");
  });

  it("leaves a link with no text as written", () => {
    const { shown, links } = draw("[](https://a.b) tail", 20);
    expect(shown).toBe("[](https://a.b) tail");
    expect(links).toEqual([]);
  });

  it("draws bold inside its text as bold", () => {
    const state = "[a **b** c](https://a.b) tail";
    expect(draw(state, state.length).shown).toBe("a b c tail");
  });

  it("follows a definition for a reference link, and leaves a [word] with none as text", () => {
    const doc = "See [the docs][d] and [plain] and [D].\n\n[d]: https://example.com \"Docs\"\n";
    const { shown, links } = draw(doc, doc.length);
    expect(shown.split("\n")[0]).toBe("See the docs and [plain] and D.");
    expect(links.map(({ text: label, href }) => [label, href])).toEqual([
      ["the docs", "https://example.com"],
      ["D", "https://example.com"],
    ]);
  });

  it("keeps a link whose text runs over a line break showing its marks, which a plugin may not hide", () => {
    const doc = "[two\nlines](https://a.b) tail\n\nend";
    const { links } = draw(doc, doc.length);
    expect(links.map((link) => link.text)).toEqual(["two\nlines"]);
  });
});

describe("links to notes and PDFs", () => {
  const uuid = "3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a";

  it("draws a link to a note that exists as a link", () => {
    const doc = "[Plan](note:7) tail";
    expect(draw(doc, doc.length, { exists: (id) => id === 7, open: () => {} }).links).toEqual([
      expect.objectContaining({ text: "Plan", href: "note:7", dead: false }),
    ]);
  });

  it("strikes through a link to a note that no longer exists, saying why", () => {
    const doc = "[Plan](note:7) tail";
    expect(draw(doc, doc.length, { exists: () => false, open: () => {} }).links).toEqual([
      { text: "Plan", href: "note:7", title: "This note no longer exists", dead: true },
    ]);
  });

  it("strikes through a pdf: link when the PDF is not on this device, or there are no PDFs at all", () => {
    const doc = `[Book, p. 4](pdf:${uuid}#p=4) tail`;
    const here = { exists: () => true, open: () => {}, pdf: { exists: () => true, open: () => {} } };
    const gone = { ...here, pdf: { exists: () => false, open: () => {} } };
    expect(draw(doc, doc.length, here).links[0].dead).toBe(false);
    expect(draw(doc, doc.length, gone).links[0]).toEqual(expect.objectContaining({ dead: true, title: "PDF not on this device" }));
    expect(draw(doc, doc.length).links[0].dead).toBe(true);
  });
});

describe("autolinks and bare addresses", () => {
  it("draws <https://…> as a link with its angle brackets hidden, and shows them while the caret is in it", () => {
    const doc = "Go to <https://example.com> now";
    expect(draw(doc, doc.length)).toEqual(
      expect.objectContaining({ shown: "Go to https://example.com now", links: [expect.objectContaining({ text: "https://example.com", href: "https://example.com" })] }),
    );
    const editing = draw(doc, 10);
    expect(editing.shown).toBe(doc);
    expect(editing.dimmed).toEqual(["<", ">"]);
  });

  it("draws a bare address as a link, a www. one with http:// to follow", () => {
    const doc = "See https://example.com/a and www.example.org today";
    expect(draw(doc, 0).links.map(({ text: label, href }) => [label, href])).toEqual([
      ["https://example.com/a", "https://example.com/a"],
      ["www.example.org", "http://www.example.org"],
    ]);
  });

  it("leaves a picture's address and a definition's alone", () => {
    const doc = "![alt](https://example.com/a.png)\n\n[d]: https://example.com\n\nend";
    expect(draw(doc, doc.length).links).toEqual([]);
  });

  it("leaves an address in code alone", () => {
    const doc = "`https://example.com` tail";
    expect(draw(doc, doc.length).links).toEqual([]);
  });
});
