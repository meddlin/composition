#!/usr/bin/env node
// Writes fixtures/conformance/pdf-refs.json: what the desktop's own `pdfRefs.ts` (the format of a note's `pdf:` links) makes of a list of
// inputs: the target written for a PDF, a page and a mark, how a target is read, how text from a PDF is made literal, the citations a quote
// block and a page link write, and which pages and marks a note's text cites. The Swift core's PdfRefs is checked against that file
// (PdfRefsConformanceTests), and the file is committed so a plain `swift test` needs no Node.
//
//   node apps/ios/scripts/pdf-refs-oracle.mjs           rewrite the file
//   node apps/ios/scripts/pdf-refs-oracle.mjs --check   fail when the file is not what the desktop makes now
//
// The inputs are the lists below; add a case here, rewrite the file, and the Swift side has to agree.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = "../../web/src/lib/composition/";
const refs = await import(new URL(`${web}pdfRefs.ts`, import.meta.url));

const U1 = "3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a";
const U2 = "00112233445566778899aabbccddeeff";
const M1 = "7b1d5c2e9a3f4b6c8d0e1f2a3b4c5d6e";
const M2 = "abcdefabcdefabcdefabcdefabcdefab";

const targets = [
  `pdf:${U1}`, `pdf:${U1}#`, `pdf:${U1}#p=44`, `pdf:${U1}#p=44&a=${M1}`, `pdf:${U1}#a=${M1}&p=2`, `pdf:${U1}#a=${M1}`, `pdf:${U1}#p=0`, `pdf:${U1}#p=01`,
  `pdf:${U1}#p=-3`, `pdf:${U1}#p=1.5`, `pdf:${U1}#p=1234567`, `pdf:${U1}#p=12345678`, `pdf:${U1}#p=9999999`, `pdf:${U1}#p=44&p=45`, `pdf:${U1}#p=44&a=zz`,
  `pdf:${U1}#a=${M1.toUpperCase()}`, `pdf:${U1}#a=${M1}0`, `pdf:${U1}#a=${M1.slice(1)}`, `pdf:${U1}#x=1&p=7&y`, `pdf:${U1}#&&p=7&&`, `pdf:${U1}#p=7=8`,
  `pdf:${U1}#p`, `pdf:${U1}#=7`, `pdf:${U1}#p=7&a`, `pdf:${U1}#p=%34`, `pdf:${U1}#p= 7`, `pdf:${U1}#p=٣`, `pdf:${U1}extra`, `pdf:${U1}#p=7\n`, `pdf:${U1}#p=7 `,
  `pdf:${U1}#p=7 `, `pdf:${U1}#p=7)`, `pdf:${U1.toUpperCase()}`, `pdf:${U1.slice(1)}`, `pdf:${U1}0`, `PDF:${U1}`, ` pdf:${U1}`, `pdf:${U1} `, `pdf:`, "pdf:abc",
  "pdf", "", "note:12", "https://example.com", `xpdf:${U1}`, `pdf://${U1}`, `pdf: ${U1}`, `pdf:${U2}#p=3`, `pdf:${U1}#p=3#p=4`, `pdf:${U1}#a=${M1}&a=${M2}`,
];

const escapes = [
  "", "plain words", "*bold* _em_ `code`", "# Heading", "## Two", "#hashtag", "- item", "-item", "+ plus", "+plus", "1. one", "1) one", "12. twelve", "1.5 is a number",
  "1.", "1)", "1", "-", "+", "#", "  - indented", "\t# tab", " - nbsp", "　+ wide", "a - b", "a # b", "<Mark>x</Mark>", "{expression}", "[link](x)", "a|b|c", "~~strike~~",
  "back\\slash", "\\*", "snake_case_name", "x > y", "2 < 3", "~", "`", "[]", "{}", "<>", "end -", "end 1.", "1. ", "- ", "  ", "9007199254740993. big", "١. arabic digit",
  "line one\nline two", "line one\n- not at the start", "\n- after a break", "- first\n- second", "tab\tseparated", "emoji 😀 *x*", "日本語 *x*", "é_è", "a\\", "\\\\",
];

const labels = [null, [], ["i", "ii", "iii", "1", "2", "3"], ["", " ", "  4  ", "iv"], ["a*b", "c_d", "# e"], [" x "]];
const titles = [
  "Designing Data-Intensive Applications", "", "   ", "  Spaced   Out  \n Title ", "Title with *stars* and _under_", "# Hash title", "- dash title", "1. numbered",
  "A [bracketed] title", "<Mark>tag</Mark>", "日本語の本", "Tab\tand nbsp　wide", "Line\nbreak", "Back\\slash", "Ends with a dot.", "{braces}",
];
const quotes = [
  "", "   ", "The selected text.", "  lots   of\n\nwhitespace\there  ", "A *starred* word", "# not a heading", "- not a list", "1. not a list", "<Mark>not a tag</Mark>", "{not an expression}",
  "[not](a-link)", "snake_case and `code`", "a | b", "~strike~", "Trailing dash -", "Back\\slash", "Ünïcödé — dash", "日本語", "emoji 😀", "line one\nline two", " nbsp start",
];

const texts = [
  "No links here.",
  `[Book](pdf:${U1})`,
  `[Book, p. 3](pdf:${U1}#p=3)`,
  `> words\n>\n> — [*Book*, p. 4](pdf:${U1}#p=4&a=${M1})`,
  `Two links: [a](pdf:${U1}#p=3) and [b](pdf:${U1}#p=9&a=${M2}) and again [c](pdf:${U1}#p=3&a=${M1}).`,
  `Other PDF [x](pdf:${U2}#p=5&a=${M1}) and [y](pdf:${U1}#p=6)`,
  `bare pdf:${U1}#p=11 in prose, then pdf:${U1}#p=12)`,
  `pdf:${U1}#p=13 pdf:${U1}#p=14\tpdf:${U1}#p=15\npdf:${U1}#p=16`,
  `pdf:${U1}#p=0 pdf:${U1}#p=-1 pdf:${U1}#p=x pdf:${U1}#p=8&a=nope`,
  `pdf:${U1}#p=21)pdf:${U1}#p=22`,
  `pdf:pdf:${U1}#p=23`,
  `pdf:${U1.slice(0, 31)}x#p=24 pdf:${U1.toUpperCase()}#p=25`,
  `pdf:${U1}#p=26&a=${M1}&a=${M2}`,
  `pdf:${U1}#`,
  `pdf:${U1}#p=27 pdf:${U1}#p=28 pdf:${U1}#p=29`,
  `${"filler ".repeat(40)}pdf:${U1}#p=30`,
  `pdf:${U1}#p=7&p=8`,
  `[tail](pdf:${U1}`,
];

const notes = [
  { id: 1, title: "Owner", content: "Nothing cited here.", updatedAt: "2026-11-01T10:00:00.000Z" },
  { id: 2, title: "Chapter 3", content: `Read [p. 5](pdf:${U1}#p=5) and [quote](pdf:${U1}#p=6&a=${M1}).`, updatedAt: "2026-11-05T10:00:00.000Z" },
  { id: 3, title: "Chapter 4", content: `[p. 9](pdf:${U1}#p=9)`, updatedAt: "2026-11-06T10:00:00.000Z" },
  { id: 4, title: "Other book", content: `[p. 1](pdf:${U2}#p=1)`, updatedAt: "2026-11-07T10:00:00.000Z" },
  { id: 5, title: "Same time, higher id", content: `pdf:${U1}`, updatedAt: "2026-11-06T10:00:00.000Z" },
  { id: 6, title: "Owner cited too", content: `[self](pdf:${U1}#p=2)`, updatedAt: "2026-10-01T10:00:00.000Z" },
  { id: 7, title: "", content: `[p. 7](pdf:${U1}#p=7&a=${M2})`, updatedAt: "2026-11-09T10:00:00.000Z" },
];

const one = (object) => `    ${JSON.stringify(object).replace(/":/g, '": ').replace(/,"/g, ', "')}`;
const list = (items) => `[\n${items.map(one).join(",\n")}\n  ]`;

const refCases = [
  [U1, null, null], [U1, 1, null], [U1, 44, null], [U1, null, M1], [U1, 44, M1], [U2, 7, M2], [U1, 0, null], [U1, 123456789, M1],
].map(([uuid, page, mark]) => ({ uuid, page, mark, ref: refs.pdfRef(uuid, { page, mark }) }));

const docs = [[U1, "Designing Data-Intensive Applications"], [U2, ""], [U1, "  A *starred*  title "]];
const pages = [1, 2, 44, 500];
const links = docs.map(([uuid, title]) => ({ uuid, title, link: refs.pdfLink({ uuid, title }) }));
const pageCitations = docs.flatMap(([uuid, title]) =>
  labels.flatMap((label) => pages.map((page) => ({ uuid, title, page, labels: label, citation: refs.pageCitation({ uuid, title }, page, label) }))),
);
const quoteBlocks = titles.flatMap((title, t) =>
  quotes.map((quote, q) => {
    const page = [1, 3, 44][(t + q) % 3];
    const mark = (t + q) % 2 === 0 ? M1 : null;
    const label = labels[(t * 7 + q) % labels.length];
    return { uuid: U1, title, quote, page, mark, labels: label, block: refs.quoteBlock({ uuid: U1, title }, quote, page, mark, label) };
  }),
);

const text = `{
  "about": "Made by apps/ios/scripts/pdf-refs-oracle.mjs from the desktop's pdfRefs.ts; PdfRefsConformanceTests replays it. Do not edit by hand.",
  "refs": ${list(refCases)},
  "parsed": ${list(targets.map((href) => ({ href, ref: refs.parsePdfRef(href) })))},
  "escaped": ${list(escapes.map((raw) => ({ text: raw, escaped: refs.escapeMarkdown(raw) })))},
  "pageLabels": ${list(labels.flatMap((label) => [0, 1, 2, 4, 6, 7].map((page) => ({ page, labels: label, label: refs.pageLabel(page, label) }))))},
  "links": ${list(links)},
  "pageCitations": ${list(pageCitations)},
  "quoteBlocks": ${list(quoteBlocks)},
  "cited": ${list(texts.flatMap((content) => [U1, U2].map((uuid) => ({ text: content, uuid, cites: refs.citesPdf(content, uuid), citations: refs.citationsOf(content, uuid) }))))},
  "notes": ${list(notes)},
  "citationsFor": ${list([[U1, 1], [U1, 6], [U2, 4], [U2, 99], [U1, 99]].map(([uuid, noteId]) => ({ uuid, ownerNoteId: noteId, citations: refs.citationsFor(notes, { uuid, noteId }) })))}
}
`;

const file = fileURLToPath(new URL("../../../fixtures/conformance/pdf-refs.json", import.meta.url));
if (process.argv.includes("--check")) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) {
    console.error("fixtures/conformance/pdf-refs.json is not what the desktop makes now: run apps/ios/scripts/pdf-refs-oracle.mjs and update the Swift side to match");
    process.exit(1);
  }
  console.log("pdf-refs.json is what the desktop makes");
} else {
  fs.writeFileSync(file, text);
  console.log(`wrote ${file}`);
}
