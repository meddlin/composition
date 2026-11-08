import { describe, expect, it } from "vitest";
import { citationsFor, citationsOf, citesPdf, escapeMarkdown, pageCitation, pageLabel, parsePdfRef, pdfRef, quoteBlock } from "./pdfRefs";

const uuid = "3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a";
const mark = "7b1d0000000000000000000000000001";

describe("pdfRef and parsePdfRef", () => {
  it("writes a link to the whole PDF, to a page, and to a mark on a page", () => {
    expect(pdfRef(uuid)).toBe(`pdf:${uuid}`);
    expect(pdfRef(uuid, { page: 44 })).toBe(`pdf:${uuid}#p=44`);
    expect(pdfRef(uuid, { page: 44, mark })).toBe(`pdf:${uuid}#p=44&a=${mark}`);
  });

  it("reads back what it wrote", () => {
    expect(parsePdfRef(pdfRef(uuid))).toEqual({ uuid, page: null, mark: null });
    expect(parsePdfRef(pdfRef(uuid, { page: 44 }))).toEqual({ uuid, page: 44, mark: null });
    expect(parsePdfRef(pdfRef(uuid, { page: 44, mark }))).toEqual({ uuid, page: 44, mark });
  });

  it("is null for anything that is not a pdf: link to a uuid, so other links are left alone", () => {
    for (const href of ["note:42", "https://example.com", "pdf:42", `pdf:${uuid.toUpperCase()}`, `pdf:${uuid}x`, `xpdf:${uuid}`, "", "#p=3"]) {
      expect(parsePdfRef(href), href).toBeNull();
    }
  });

  it("keeps the page and the mark apart: a damaged part is dropped and the rest is kept", () => {
    expect(parsePdfRef(`pdf:${uuid}#p=0`)).toEqual({ uuid, page: null, mark: null });
    expect(parsePdfRef(`pdf:${uuid}#p=-3&a=${mark}`)).toEqual({ uuid, page: null, mark });
    expect(parsePdfRef(`pdf:${uuid}#p=7&a=nonsense`)).toEqual({ uuid, page: 7, mark: null });
    expect(parsePdfRef(`pdf:${uuid}#p=12345678`)).toEqual({ uuid, page: null, mark: null });
    expect(parsePdfRef(`pdf:${uuid}#p=7&future=1&a=${mark}`)).toEqual({ uuid, page: 7, mark });
    expect(parsePdfRef(`pdf:${uuid}#`)).toEqual({ uuid, page: null, mark: null });
  });
});

describe("pageLabel", () => {
  it("is the printed label when the PDF has one, and the physical number when it does not", () => {
    expect(pageLabel(4, ["i", "ii", "iii", "1"])).toBe("1");
    expect(pageLabel(9, ["i", "ii", "iii", "1"])).toBe("9");
    expect(pageLabel(2, null)).toBe("2");
    expect(pageLabel(2, ["", " "])).toBe("2");
  });
});

describe("escapeMarkdown", () => {
  it("makes what would start Markdown or MDX literal", () => {
    expect(escapeMarkdown("a *b* _c_ `d` [e] <F /> {g} ~h~ i|j")).toBe("a \\*b\\* \\_c\\_ \\`d\\` \\[e\\] \\<F /\\> \\{g\\} \\~h\\~ i\\|j");
    expect(escapeMarkdown("back\\slash")).toBe("back\\\\slash");
  });

  it("makes a start that would be a heading or a list item literal, and leaves a hyphen inside a word", () => {
    expect(escapeMarkdown("# 1 Introduction")).toBe("\\# 1 Introduction");
    expect(escapeMarkdown("- item")).toBe("\\- item");
    expect(escapeMarkdown("12. Item")).toBe("\\12. Item");
    expect(escapeMarkdown("data-intensive")).toBe("data-intensive");
    expect(escapeMarkdown("2024 was a year")).toBe("2024 was a year");
  });
});

describe("pageCitation", () => {
  it("cites a page by the printed label, with the physical page in the link", () => {
    const labels = ["i", "ii", "iii", "1", "2"];

    expect(pageCitation({ uuid, title: "Designing Data" }, 5, labels)).toBe(`[*Designing Data*, p. 2](pdf:${uuid}#p=5)`);
  });

  it("uses the physical page when there are no labels, and leaves out an empty title", () => {
    expect(pageCitation({ uuid, title: "Designing Data" }, 44)).toBe(`[*Designing Data*, p. 44](pdf:${uuid}#p=44)`);
    expect(pageCitation({ uuid, title: "  " }, 3)).toBe(`[p. 3](pdf:${uuid}#p=3)`);
  });

  it("keeps a title's brackets and asterisks from breaking the link", () => {
    expect(pageCitation({ uuid, title: "C [2nd ed.] *new*" }, 1)).toBe(`[*C \\[2nd ed.\\] \\*new\\**, p. 1](pdf:${uuid}#p=1)`);
  });
});

describe("quoteBlock", () => {
  it("is a block quote of the words and a citation paragraph that names the page and the mark", () => {
    expect(quoteBlock({ uuid, title: "Designing Data" }, "Data outlives code.", 44, mark, ["i", "ii", "iii", "1"])).toBe(
      `> Data outlives code.\n>\n> — [*Designing Data*, p. 44](pdf:${uuid}#p=44&a=${mark})`,
    );
  });

  it("puts the words on one line, whatever the PDF's line breaks were", () => {
    expect(quoteBlock({ uuid, title: "T" }, "one\n  two   three", 2, mark)).toContain("> one two three\n>\n");
  });

  it("is only the citation when there are no words, and has no mark when it is a page", () => {
    expect(quoteBlock({ uuid, title: "T" }, "  ", 2, null)).toBe(`> — [*T*, p. 2](pdf:${uuid}#p=2)`);
  });

  it("keeps the PDF's own punctuation from turning into Markdown", () => {
    const block = quoteBlock({ uuid, title: "T" }, "# 1 <Mark>x</Mark> *y*", 2, mark);

    expect(block.split("\n")[0]).toBe("> \\# 1 \\<Mark\\>x\\</Mark\\> \\*y\\*");
  });
});

describe("citationsOf and citesPdf", () => {
  const text = [
    "> quote",
    `> — [*T*, p. 44](pdf:${uuid}#p=44&a=${mark})`,
    `See also [page 9](pdf:${uuid}#p=9) and [the book](pdf:${uuid}), and [again](pdf:${uuid}#p=44&a=${mark}).`,
    `Another book: [x](pdf:${"a".repeat(32)}#p=3&a=${"b".repeat(32)})`,
  ].join("\n");

  it("finds the pages and marks of one PDF that a note cites, each once, in order", () => {
    expect(citationsOf(text, uuid)).toEqual({ pages: [44, 9], marks: [mark] });
  });

  it("does not take another PDF's citations", () => {
    expect(citationsOf(text, "a".repeat(32))).toEqual({ pages: [3], marks: ["b".repeat(32)] });
    expect(citationsOf(text, "c".repeat(32))).toEqual({ pages: [], marks: [] });
  });

  it("knows whether a note cites a PDF at all, even with no fragment", () => {
    expect(citesPdf(text, uuid)).toBe(true);
    expect(citesPdf(`[the book](pdf:${uuid})`, uuid)).toBe(true);
    expect(citesPdf("no links here", uuid)).toBe(false);
    expect(citationsOf(`[the book](pdf:${uuid})`, uuid)).toEqual({ pages: [], marks: [] });
  });
});

describe("citationsFor", () => {
  const note = (id: number, content: string, updatedAt = "2026-01-01", title = `Note ${id}`) => ({ id, title, content, updatedAt });
  const doc = { uuid, noteId: 1 };

  it("lists the owner first, even with no link in it, then the notes that link to the PDF, the latest changed first", () => {
    const notes = [
      note(2, `[a](pdf:${uuid}#p=3)`, "2026-02-01"),
      note(1, "", "2025-01-01", "Owner"),
      note(3, "nothing here", "2026-03-01"),
      note(4, `[b](pdf:${uuid}#p=9&a=${mark})`, "2026-04-01"),
    ];

    expect(citationsFor(notes, doc)).toEqual([
      { noteId: 1, title: "Owner", owner: true, pages: [], marks: [] },
      { noteId: 4, title: "Note 4", owner: false, pages: [9], marks: [mark] },
      { noteId: 2, title: "Note 2", owner: false, pages: [3], marks: [] },
    ]);
  });

  it("reads what the owner cites of its own PDF, and leaves out a note that cites another", () => {
    const notes = [note(1, `[a](pdf:${uuid}#p=2)`), note(2, `[x](pdf:${"a".repeat(32)}#p=2)`)];

    expect(citationsFor(notes, doc)).toEqual([{ noteId: 1, title: "Note 1", owner: true, pages: [2], marks: [] }]);
  });

  it("is only the notes there are: no owner among them, no owner entry", () => {
    expect(citationsFor([note(2, `[a](pdf:${uuid})`)], doc).map((c) => c.noteId)).toEqual([2]);
    expect(citationsFor([], doc)).toEqual([]);
  });
});
