// Loads dist/preview.js into jsdom (no browser, no GTK) and renders a note through it, then reports which of the desktop's
// components came out. Run through verify.sh. This proves the bundle is self-contained and that the web app's own MDX
// pipeline runs in it; it does not prove how WebKitGTK draws it.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../web/package.json"));
const { JSDOM } = require("jsdom");

const note = fs.readFileSync(process.argv[2], "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
const html = fs.readFileSync(path.join(here, "dist/index.html"), "utf8").replace('<script src="preview.js"></script>', "").replace('<link rel="stylesheet" href="preview.css" />', "");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.Element.prototype.scrollIntoView = () => {};
const messages = [];
window.webkit = { messageHandlers: { composition: { postMessage: (m) => messages.push(m) } } };
window.eval(fs.readFileSync(path.join(here, "dist/preview.js"), "utf8"));
await new Promise((r) => setTimeout(r, 50));
window.composition.render(note);
await new Promise((r) => setTimeout(r, 400));

const doc = window.document;
const count = (sel) => doc.querySelectorAll(sel).length;
const report = {
  messages: messages.map((m) => m.type),
  headings: count("h1,h2,h3,h4,h5,h6"),
  tables: count("table"),
  codeBlocks: count("pre code"),
  highlightedTokens: count("pre code span[class*=hljs]"),
  images: count("img"),
  mark: count("mark"),
  svg: count("svg"),
  links: count("a[href]"),
  footnoteRefs: count("sup a, a[data-footnote-ref]"),
  noteText: doc.body.textContent.replace(/\s+/g, " ").slice(0, 260),
};
console.log(JSON.stringify(report, null, 2));
for (const needle of ["Preview showcase", "Staging resets", "A gradient", "Staging runbook", "scheduler"]) {
  console.log(`${doc.body.textContent.includes(needle) ? "found  " : "MISSING"} ${JSON.stringify(needle)}`);
}
process.exit(0);
