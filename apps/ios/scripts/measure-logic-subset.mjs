#!/usr/bin/env node
// Measures how much of the web app's data layer (apps/web/src/lib/composition) the iPad's Swift core has to carry:
// spike S1's "measure the v1 logic subset" (docs/ipad-app-design.md, R3). The classification of every file is in
// apps/ios/conformance/logic-subset.json and is a judgement; this script only counts, and fails if a file is missing from
// the classification (or the classification names one that is gone), so the numbers cannot quietly go stale.
//
// "lines" is every line; "code" is the lines that are not blank and not only a comment. Tests are counted apart: they
// are the specification a port has to meet, not code to write.
//
// Usage: node apps/ios/scripts/measure-logic-subset.mjs [--files <category>]   (e.g. --files v1 lists the v1 files by size)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const folder = join(root, "apps/web/src/lib/composition");
const { categories, files: classification } = JSON.parse(readFileSync(join(root, "apps/ios/conformance/logic-subset.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function count(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const code = lines.filter((line) => !/^\s*$/.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)).length;
  return { lines: lines.length, code };
}

const isTest = (rel) => /\.test\.tsx?$/.test(rel) || rel.includes("__fixtures__/");
const sources = walk(folder).map((path) => relative(folder, path)).filter((rel) => /\.tsx?$/.test(rel) && !rel.endsWith(".d.ts"));

function categoryOf(rel) {
  if (classification[rel]) return classification[rel].category;
  const prefix = Object.keys(classification).find((key) => key.endsWith("/") && rel.startsWith(key));
  return prefix ? classification[prefix].category : undefined;
}

const code = sources.filter((rel) => !isTest(rel));
const unclassified = code.filter((rel) => !categoryOf(rel));
const stale = Object.keys(classification).filter((key) => (key.endsWith("/") ? !code.some((rel) => rel.startsWith(key)) : !code.includes(key)));
if (unclassified.length || stale.length) {
  if (unclassified.length) console.error(`Not in conformance/logic-subset.json:\n  ${unclassified.join("\n  ")}`);
  if (stale.length) console.error(`In conformance/logic-subset.json but not on disk:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}

const totals = Object.fromEntries(Object.keys(categories).map((name) => [name, { files: 0, lines: 0, code: 0, testLines: 0 }]));
const perFile = [];
for (const rel of code) {
  const category = categoryOf(rel);
  const { lines, code: codeLines } = count(join(folder, rel));
  const testRel = rel.replace(/\.tsx?$/, ".test.ts");
  const testPath = sources.includes(testRel) ? join(folder, testRel) : null;
  const testLines = testPath ? count(testPath).lines : 0;
  const total = totals[category];
  total.files += 1;
  total.lines += lines;
  total.code += codeLines;
  total.testLines += testLines;
  perFile.push({ rel, category, lines, code: codeLines, testLines });
}

const pad = (value, width) => String(value).padStart(width);
const sum = (names, key) => names.reduce((acc, name) => acc + totals[name][key], 0);
console.log(`apps/web/src/lib/composition: ${code.length} source files\n`);
console.log(`${"category".padEnd(10)} ${pad("files", 5)} ${pad("lines", 7)} ${pad("code", 7)} ${pad("test lines", 11)}   meaning`);
for (const [name, meaning] of Object.entries(categories)) {
  const t = totals[name];
  console.log(`${name.padEnd(10)} ${pad(t.files, 5)} ${pad(t.lines, 7)} ${pad(t.code, 7)} ${pad(t.testLines, 11)}   ${meaning}`);
}
const all = Object.keys(categories);
console.log(`${"total".padEnd(10)} ${pad(sum(all, "files"), 5)} ${pad(sum(all, "lines"), 7)} ${pad(sum(all, "code"), 7)} ${pad(sum(all, "testLines"), 11)}`);

const v1 = ["ported", "v1", "mixed"];
console.log(`\nv1 logic, done:              ${pad(totals.ported.code, 5)} code lines (${totals.ported.files} files)`);
console.log(`v1 logic, still to port:     ${pad(totals.v1.code, 5)} code lines (${totals.v1.files} files), plus at most ${totals.mixed.code} in ${totals.mixed.files} mixed files`);
console.log(`v1 polish (M3, first to drop): ${pad(totals.polish.code, 3)} code lines`);
console.log(`v1 total, upper bound:       ${pad(sum(v1, "code"), 5)} of ${sum(all, "code")} code lines (${Math.round((100 * sum(v1, "code")) / sum(all, "code"))}%)`);
console.log(`test lines to meet:          ${pad(sum(v1, "testLines"), 5)} in the v1 and ported files' own tests`);

const wanted = process.argv.includes("--files") ? process.argv[process.argv.indexOf("--files") + 1] : null;
if (wanted) {
  console.log(`\n${wanted} files, largest first:`);
  for (const f of perFile.filter((f) => f.category === wanted).sort((a, b) => b.code - a.code)) {
    console.log(`  ${pad(f.code, 5)} code ${pad(f.lines, 5)} lines ${pad(f.testLines, 5)} test  ${f.rel}`);
  }
}
