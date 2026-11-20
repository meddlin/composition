#!/usr/bin/env node
// Writes the UTS #46 data the Kotlin core's WebAddress reads (the Reading List's links with a non-ASCII host), from the tables of
// the `tr46` package, the URL Standard's reference implementation of UTS #46 that jsdom's whatwg-url uses.
//
//   node apps/android/scripts/generate-uts46-data.mjs <path to a tr46 package>
//
// The core was made from tr46 6.0.0, whose tables are Unicode 16.0's, the version of the tables Node's own URL parser (ada) holds; so
// the desktop's `new URL()` and the Kotlin core make the same host of every name but a few: see `Uts46.kt`. Re-run it with a newer tr46
// when the desktop's Node moves to a newer Unicode, and check the result against Node as the pull request that added it describes.
//
// The output has two kinds of line:
//   <first>[-<last>] <status> [<code point> ...]   the mapping table, for every code point from 0 to 10FFFF in order: V valid,
//                                                  M mapped (to the code points that follow), D deviation, X disallowed, I ignored
//   set <name> <first>-<last>,...                  a character class of tr46's regexes, as ranges of code points
// Code points are hexadecimal.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tr46 = process.argv[2] && resolve(process.argv[2]);
if (!tr46) {
  console.error("usage: generate-uts46-data.mjs <path to a tr46 package>");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { version } = require(join(tr46, "package.json"));
const table = require(join(tr46, "lib/mappingTable.json"));
const regexes = require(join(tr46, "lib/regexes.js"));
const { STATUS_MAPPING } = require(join(tr46, "lib/statusMapping.js"));

const statusLetter = {
  [STATUS_MAPPING.valid]: "V",
  [STATUS_MAPPING.mapped]: "M",
  [STATUS_MAPPING.deviation]: "D",
  [STATUS_MAPPING.disallowed]: "X",
  [STATUS_MAPPING.ignored]: "I",
};

const hex = (n) => n.toString(16).toUpperCase();
const lines = [
  `# UTS #46 data for the Reading List's WebAddress, from tr46 ${version}. Made by apps/android/scripts/generate-uts46-data.mjs: do not edit.`,
];

// The mapping table, checked to cover every code point once, in order.
let next = 0;
for (const entry of table) {
  const [first, last] = Array.isArray(entry[0]) ? entry[0] : [entry[0], entry[0]];
  if (first !== next) throw new Error(`the table skips or repeats from ${hex(next)}`);
  next = last + 1;
  const status = statusLetter[entry[1]];
  if (!status) throw new Error(`unknown status ${entry[1]} at ${hex(first)}`);
  const mapping = entry[2] === undefined ? [] : Array.from(entry[2], (c) => hex(c.codePointAt(0)));
  lines.push([first === last ? hex(first) : `${hex(first)}-${hex(last)}`, status, ...mapping].join(" "));
}
if (next !== 0x110000) throw new Error("the table stops short of 10FFFF");

// The regexes, whose shapes WebAddress's Uts46 spells out by hand: each must still be the one it was written for.
const shapes = {
  combiningMarks: "[C]",
  combiningClassVirama: "[C]",
  validZWNJ: "[C][C]*\\u200C[C]*[C]",
  bidiDomain: "[C]",
  bidiS1LTR: "[C]",
  bidiS1RTL: "[C]",
  bidiS2: "^[C]*$",
  bidiS3: "[C][C]*$",
  bidiS4EN: "[C]",
  bidiS4AN: "[C]",
  bidiS5: "^[C]*$",
  bidiS6: "[C][C]*$",
};
const bracket = /\[(?:\\.|[^\]\\])*\]/g;
for (const [name, shape] of Object.entries(shapes)) {
  const regex = regexes[name];
  if (!regex || regex.flags !== "u") throw new Error(`tr46 has no ${name} with the u flag`);
  if (regex.source.replace(bracket, "[C]") !== shape) throw new Error(`${name} is not ${shape} any more: ${regex.source.slice(0, 80)}`);
  const classes = regex.source.match(bracket);
  classes.forEach((source, index) => {
    const test = new RegExp(`^${source}$`, "u");
    const ranges = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const text = cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
      if (!test.test(text)) continue;
      const last = ranges[ranges.length - 1];
      if (last && last[1] === cp - 1) last[1] = cp;
      else ranges.push([cp, cp]);
    }
    const label = classes.length === 1 ? name : `${name}.${index}`;
    lines.push(`set ${label} ${ranges.map(([a, b]) => `${hex(a)}-${hex(b)}`).join(",")}`);
  });
}

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../core/src/main/resources/com/rushinglabs/composition/core/readinglist/uts46.txt",
);
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}: ${table.length} mapping rows from tr46 ${version}`);
