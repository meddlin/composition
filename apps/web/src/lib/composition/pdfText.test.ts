import { describe, expect, it } from "vitest";
import { pageSearchText, pageTextFromItems } from "./pdfText";

describe("pageTextFromItems", () => {
  it("joins items, breaking a line after each that ends one, and skips markers", () => {
    expect(pageTextFromItems([{ str: "Careful extrac-", hasEOL: true }, { type: "beginMarkedContent" }, { str: "tion", hasEOL: false }, { str: " here" }])).toBe(
      "Careful extrac-\ntion here",
    );
    expect(pageTextFromItems([])).toBe("");
  });
});

describe("pageSearchText", () => {
  it("is empty for a page with no text", () => {
    expect(pageSearchText("")).toBe("");
    expect(pageSearchText(" \n\r\n\t ")).toBe("");
  });

  it("makes every line break \\n, trims lines and drops empty ones", () => {
    expect(pageSearchText("  one \r\n\r\ntwo\rthree  ")).toBe("one\ntwo\nthree");
  });

  it("makes compatibility forms plain (ligatures, full-width letters)", () => {
    expect(pageSearchText("The ﬁrst ﬂoor, ｗｉｄｅ")).toBe("The first floor, wide");
  });

  it("adds a word broken over two lines whole, after the lines", () => {
    expect(pageSearchText("Careful extrac-\ntion of\nevery hy­phen-\nated word, soft­\nly and Uni‐\ncode")).toBe(
      "Careful extrac-\ntion of\nevery hyphen-\nated word, soft­\nly and Uni‐\ncode\nextraction hyphenated softly Unicode",
    );
  });

  it("does not join when the next line starts with a capital, a digit or nothing, or the hyphen follows no letter", () => {
    expect(pageSearchText("A well-\nKnown\nitem-\n42\nend--\nnext\n3-\nfold\nlast-")).toBe("A well-\nKnown\nitem-\n42\nend--\nnext\n3-\nfold\nlast-");
  });
});
