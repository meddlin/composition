// Spike D: does a marked copy of a big file still open with its structure intact?
// usage: node export/verify-big.mjs original.pdf marked.pdf pageIndex...
import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const standardFontDataUrl = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
const [orig, marked, ...pages] = process.argv.slice(2);
async function describe(path) {
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path)), standardFontDataUrl, isEvalSupported: false, verbosity: 0 }).promise;
  const outline = (await doc.getOutline()) ?? [];
  const labels = (await doc.getPageLabels()) ?? [];
  const marks = {};
  for (const p of pages) marks[p] = (await (await doc.getPage(+p + 1)).getAnnotations()).map((a) => a.subtype).join(",");
  return { path: path.split("/").pop(), numPages: doc.numPages, outlineTop: outline.length, labels: `${labels[0]} .. ${labels[8]} .. ${labels[labels.length - 1]}`, marks, openMs: Math.round(performance.now() - t0) };
}
console.log(JSON.stringify(await describe(orig)));
console.log(JSON.stringify(await describe(marked)));
