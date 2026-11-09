#!/usr/bin/env node
// Writes fixtures/conformance/document-names.json: what the desktop's own `attachmentNames.ts` and `documentNames.ts` make of a list
// of inputs (the name a PDF is stored under, the name and title shown for it, a size in words, whether bytes look like a PDF).
// The Swift core's DocumentNames is checked against that file (DocumentNamesConformanceTests), and the file is committed so a plain
// `swift test` needs no Node.
//
//   node apps/ios/scripts/document-names-oracle.mjs           rewrite the file
//   node apps/ios/scripts/document-names-oracle.mjs --check   fail when the file is not what the desktop makes now
//
// The inputs are the lists below; add a case here, rewrite the file, and the Swift side has to agree.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const web = "../../web/src/lib/composition/";
const { storedFileName, displayName, formatBytes } = await import(new URL(`${web}attachmentNames.ts`, import.meta.url));
const { looksLikePdf, pdfTitleFromFileName } = await import(new URL(`${web}documentNames.ts`, import.meta.url));

const PREFIX = "0123456789ab";
const spaces = (n) => " ".repeat(n);

const fileNames = [
  "Designing Data.pdf", "a.pdf", "", ".", "..", ".pdf", ".env", "noext", "a.b.c.pdf", "trailing.", "UPPER.PDF", "dir/sub\\file name.pdf",
  "C:\\docs\\Q3 report (final).pdf", "é accent.pdf", "naïve café.pdf", "日本語.pdf", "ＦＵＬＬ　ｗｉｄｔｈ.pdf", "ﬁle ﬂow.pdf", "emoji 😀 name.pdf",
  `${"a".repeat(150)}.pdf`, `name.${"x".repeat(30)}`, "weird.ext?x", "tab\tname.pdf", "--dash--.pdf", "__under__.pdf", "._hidden.pdf", "a..b.pdf",
  " spaced .pdf", "x.tar.gz", "name.p df", "ÄÖÜ.pdf", "Ω.pdf", "a.é", "ᴀ.pdf", "①②.pdf", "e\u0301.pdf", "…etc.pdf", "résumé 2026.PDF", "a/b/",
  "name with  two  spaces.pdf", "ﬃ.pdf", "x.\u00a0pdf", "100%.pdf", "a+b=c.pdf", "snow\u2603man.pdf", ".hidden.", "end.pdf.", "dot.dot.dot",
];
const paths = ["", "a.pdf", "/", "/x/y.pdf", "C:\\a\\b.pdf", "dir/", "x\\y/z", "no separators", "//double//slash.pdf", "trailing\\"];
const titles = [
  "Designing_Data.pdf", "a__b.PDF", "  .pdf", "/x/y/My Book.pdf", "C:\\docs\\a.pdf", "weird\u00a0name.pdf", "no extension", "notes.pdf.pdf", "", "_.pdf",
  "x.Pdf", "  Spaced   Out  .pdf", "tab\t.pdf", "a b\u2003c.pdf", "\u3000x\u3000.pdf", ".pdf.pdf", "Title_with___many___underscores.pdf", "mixed _ _ .pdf",
  "ünï.pdf", "\ufeffbom.pdf", "a\u0085b.pdf", "line\u2028sep.pdf", "-.pdf", "x.PDF ", "pdf",
];
const sizes = [
  0, 1, 999, 1000, 1001, 1500, 1949, 1950, 99_949, 99_950, 99_999, 100_000, 100_499, 100_500, 999_499, 999_500, 999_999, 1_000_000, 1_400_000, 12_345_678,
  999_949_999, 1_000_000_000, 1_500_000_000, 123_456_789_012, 999_999_999_999_999, 1e15, 5e15, 1e18, 4.35e3, 1_050,
];
const heads = [
  ["a PDF", Buffer.from("%PDF-1.7\n%%EOF\n")], ["nothing", Buffer.alloc(0)], ["just the header", Buffer.from("%PDF-")], ["a header with no dash", Buffer.from("%PDF1.4")],
  ["the first four", Buffer.from("%PDF")], ["junk before the header", Buffer.concat([Buffer.alloc(900, 0x20), Buffer.from("%PDF-1.7")])],
  ["the header ending at the window", Buffer.concat([Buffer.alloc(1019, 0x20), Buffer.from("%PDF-")])],
  ["the header one byte past it", Buffer.concat([Buffer.alloc(1020, 0x20), Buffer.from("%PDF-")])],
  ["the header well past it", Buffer.concat([Buffer.alloc(1100, 0x20), Buffer.from("%PDF-1.7")])], ["lower case", Buffer.from("%pdf-1.4")],
  ["gzip", Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3])], ["text", Buffer.from("just text")], ["junk then a header", Buffer.from("junk%PDF-1.3")],
  ["two headers", Buffer.from("%PDF%PDF-")], ["a header at the very end of 1024", Buffer.concat([Buffer.alloc(1019, 0), Buffer.from("%PDF-")])],
  ["a header cut by the end", Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from("%PDF")])],
];

const one = (object) => `    ${JSON.stringify(object).replace(/":/g, '": ').replace(/,"/g, ', "')}`;
const list = (items) => `[\n${items.map(one).join(",\n")}\n  ]`;
const text = `{
  "about": "Made by apps/ios/scripts/document-names-oracle.mjs from the desktop's attachmentNames.ts and documentNames.ts; DocumentNamesConformanceTests replays it. Do not edit by hand.",
  "prefix": ${JSON.stringify(PREFIX)},
  "storedNames": ${list(fileNames.map((fileName) => ({ fileName, stored: storedFileName(PREFIX, fileName) })))},
  "displayNames": ${list(paths.map((path) => ({ path, shown: displayName(path) })))},
  "titles": ${list(titles.map((path) => ({ path, title: pdfTitleFromFileName(path) })))},
  "sizes": ${list(sizes.map((bytes) => ({ bytes, shown: formatBytes(bytes) })))},
  "heads": ${list(heads.map(([name, bytes]) => ({ name, hex: bytes.toString("hex"), looksLikePdf: looksLikePdf(bytes) })))}
}
`;

const file = fileURLToPath(new URL("../../../fixtures/conformance/document-names.json", import.meta.url));
if (process.argv.includes("--check")) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) {
    console.error("fixtures/conformance/document-names.json is not what the desktop makes now: run apps/ios/scripts/document-names-oracle.mjs and update the Swift side to match");
    process.exit(1);
  }
  console.log("document-names.json is what the desktop makes");
} else {
  fs.writeFileSync(file, text);
  console.log(`wrote ${file}`);
}
