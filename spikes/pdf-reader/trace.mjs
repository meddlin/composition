// What does pdf.js read to open a PDF through a range transport? usage: node trace.mjs FILE [chunk]
import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const file = process.argv[2];
const chunk = Number(process.argv[3] || 524288);
const size = fs.statSync(file).size;
const fd = fs.openSync(file, "r");
const read = (begin, end) => {
  const buf = Buffer.alloc(end - begin);
  fs.readSync(fd, buf, 0, end - begin, begin);
  return new Uint8Array(buf);
};

let log = [];
class T extends pdfjs.PDFDataRangeTransport {
  requestDataRange(begin, end) {
    const e = Math.min(end, size);
    log.push([begin, e]);
    queueMicrotask(() => this.onDataRange(begin, read(begin, e)));
  }
}
const mb = (n) => (n / 1048576).toFixed(1);
const summarize = (label) => {
  const bytes = log.reduce((n, [b, e]) => n + (e - b), 0);
  console.log(`${label}: ${log.length} requests, ${mb(bytes)} MB of ${mb(size)} MB`);
  return bytes;
};

const transport = new T(size, read(0, 65536));
const t0 = performance.now();
const doc = await pdfjs.getDocument({
  range: transport, length: size, disableAutoFetch: true, disableStream: true, rangeChunkSize: chunk,
  isEvalSupported: false, verbosity: 1,
}).promise;
console.log(`open ${Math.round(performance.now() - t0)} ms, pages ${doc.numPages}`);
summarize("after getDocument");
const first = log.slice(0, 12).map(([b, e]) => `${mb(b)}-${mb(e)}`).join("  ");
console.log("first requests (MB):", first);
log = [];
await doc.getPage(1);
summarize("getPage(1)");
log = [];
await doc.getPage(300);
summarize("getPage(300)");
log = [];
await doc.getOutline();
summarize("getOutline");
log = [];
await doc.getPageLabels();
summarize("getPageLabels");
