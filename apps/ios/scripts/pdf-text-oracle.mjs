#!/usr/bin/env node
// Writes fixtures/conformance/pdf-text.json: what the desktop's own code makes of a PDF's text for search. Two parts:
//   cases  raw page texts and what `pageSearchText` (apps/web/src/lib/composition/pdfText.ts) turns each into, exactly;
//   pages  every page of fixtures/conformance/pdf-text.pdf as the desktop reads it for search (`readPdfText` in pdfText.ts, pdf.js
//          with the reader's own options, then `pageTextFromItems` and `pageSearchText`), with the words a search must find on it
//          (folded: lower case, no accents).
// The Swift core's PdfSearchText and the iPad's PDFKit extraction are checked against that file (PdfTextConformanceTests), and the
// file is committed so a plain `swift test` needs no Node.
//
//   node apps/ios/scripts/pdf-text-oracle.mjs           rewrite the file
//   node apps/ios/scripts/pdf-text-oracle.mjs --check   fail when the file is not what the desktop makes now
//
// Needs apps/web's node_modules (pdfjs-dist). The fixture PDF is made by apps/ios/scripts/make-pdf-text-fixture.swift.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = new URL("../../web/", import.meta.url);
// `readPdfText` is the desktop's own reading (the same function its utility process runs), so the pages below are what it indexes.
const { pageSearchText, readPdfText } = await import(new URL("src/lib/composition/pdfText.ts", web));
const pdfjs = await import(new URL("node_modules/pdfjs-dist/legacy/build/pdf.mjs", web));
const pdfjsRoot = fileURLToPath(new URL("node_modules/pdfjs-dist/", web));

const fixturePdf = new URL("../../../fixtures/conformance/pdf-text.pdf", import.meta.url);
const out = new URL("../../../fixtures/conformance/pdf-text.json", import.meta.url);

const cases = [
  "", " ", "\n\n", "\r\n", "one line", "  padded  ", "two\nlines", "crlf\r\nlines", "cr\rlines", "mixed\r\n\r\n\n\rbreaks", "\ttabbed\t",
  "ligatures ﬁ ﬂ ﬀ ﬃ ﬄ ﬅ ﬆ", "ﬁnd the ﬂoor", "ｆｕｌｌ ｗｉｄｔｈ １２３", "ℌilbert ℵ ① ¼ x² Ⅻ", "é composed by NFKC", "Ǆ digraph", "ſ long s",
  "Careful extrac-\ntion", "extrac-\n  tion", "extrac-  \ntion", "extrac-\n\ntion", "a-\nb", "well-\nKnown", "item-\n42", "3-\nfold", "end--\nnext", "last-",
  "-\nalone", "x -\ny", "soft­\nly", "mid­word", "mid­word­", "­", "uni‐\ncode", "en–\ndash", "em—\ndash", "minus−\nsign",
  "Ζεύ-\nς", "Моск-\nва", "Café-\nété", "über-\nÄrger", "one-\ntwo-\nthree", "a-\nb-\nc-\nd", "first-\nsecond line-\nthird",
  "Wort-\nmitte und ﬁ-\nnale", "https://example.org/a-\npath", "e-mail\nx@example.com", "3.14 (beta)", "naïve space", "zero​width",
  "tab\tin\tline", "trailing　ideographic　", "😀 emoji-\nfollows", "日本語-\nテキスト",
];

async function readPages() {
  const outcome = await readPdfText(pdfjs, { data: new Uint8Array(fs.readFileSync(fixturePdf)) }, {
    cMapUrl: `${pdfjsRoot}cmaps/`,
    standardFontDataUrl: `${pdfjsRoot}standard_fonts/`,
  });
  if (outcome.status !== "pages") throw new Error(`the fixture did not read: ${outcome.status}`);
  return outcome.pages.map(({ page, text }) => ({ page, text, words: words(text) }));
}

/** The distinct words of `text`, lower case and without accents, sorted: what a search must find. */
function words(text) {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return [...new Set(folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean))].sort();
}

const result = {
  comment:
    "Made by apps/ios/scripts/pdf-text-oracle.mjs from the desktop's pdfText.ts and pdf.js; do not edit. cases: pageSearchText(input) = output exactly. " +
    "pages: fixtures/conformance/pdf-text.pdf read by pdf.js (page is 0-based), text = what is indexed, words = every word a search must find on that page.",
  cases: cases.map((input) => ({ input, output: pageSearchText(input) })),
  pages: await readPages(),
};
const json = `${JSON.stringify(result, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (fs.readFileSync(out, "utf8") !== json) {
    console.error("fixtures/conformance/pdf-text.json is not what the desktop makes now: run node apps/ios/scripts/pdf-text-oracle.mjs and update the Swift side.");
    process.exit(1);
  }
  console.log("pdf-text.json matches the desktop.");
} else {
  fs.writeFileSync(out, json);
  console.log(`wrote ${fileURLToPath(out)}: ${result.cases.length} cases, ${result.pages.length} pages`);
}
