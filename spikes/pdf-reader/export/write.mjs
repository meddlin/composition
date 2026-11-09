// Spike D driver. usage: node export/write.mjs <pdf-lib|@cantoo/pdf-lib|@pdfme/pdf-lib|pdfjs> in.pdf out.pdf [native|flatten] [noap]
// Prints one JSON line: adapter, mode, milliseconds, bytes in and out, peak resident memory.
import fs from "node:fs";
import { run as runPdfLib } from "./adapters/pdflib.mjs";
import { run as runPdfjs } from "./adapters/pdfjs.mjs";

const [adapter, input, output, mode = "native", flag] = process.argv.slice(2);
const bytes = fs.readFileSync(input);
const t0 = performance.now();
let out, skipped = [];
if (adapter === "pdfjs") ({ bytes: out, skipped } = await runPdfjs(bytes, { mode }));
else out = await runPdfLib(adapter, bytes, { mode, ap: flag !== "noap" });
const ms = Math.round(performance.now() - t0);
fs.writeFileSync(output, out);
// maxRSS is reported in kilobytes on Linux and bytes on macOS by some Node versions, so say which we assume
const peak = process.resourceUsage().maxRSS;
console.log(JSON.stringify({ adapter, mode, ap: flag !== "noap", ms, inMB: +(bytes.length / 1e6).toFixed(2), outMB: +(out.length / 1e6).toFixed(2), peakRSS_MB: +((peak > 1e9 ? peak / 1e6 : peak / 1e3)).toFixed(0), skipped }));
