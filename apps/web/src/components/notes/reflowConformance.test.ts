import fs from "node:fs";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { conformancePath, UPDATING_FIXTURES } from "@/lib/composition/__fixtures__/conformance";
import { parseWritingSettings, validateWritingSettings } from "@/lib/composition/writing";
import { liveReflow } from "./liveReflow";
import { changedSpan, reflowAtCaret } from "./reflowText";

/**
 * Reflow (breaking a line that typing has pushed past a column) is text logic the Swift core ports (`CompositionCore/Editing/ReflowText.swift` and
 * `LiveReflow.swift`), so it must agree to the character. This test pins what the Swift side replays, `fixtures/conformance/reflow.json` (see
 * fixtures/conformance/README.md):
 *
 *   reflow    `reflowAtCaret` over hand-picked and generated lines: prefixes, quotes, lists, tasks, tables, fences, frontmatter, indented code, JavaScript's
 *             own idea of white space, emoji and combining marks, at carets all along the line
 *   spans     `changedSpan`: the stretch of a text that turned into another
 *   typing    the live editor's filter (`liveReflow`, a CodeMirror transaction filter) over one change at a time: which events reflow and which do not
 *   writing   `parseWritingSettings` and `validateWritingSettings`: the ruler, reflow and heading-rail settings that decide whether any of it happens
 *
 * A change to the TypeScript behaviour fails here until the fixture is regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest run
 * src/components/notes/reflowConformance.test.ts`), which is the prompt to update the Swift side too.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function pretty(value: Json, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat.length + indent.length <= 150 || value === null || typeof value !== "object") return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Options = { column: number; keepTables: boolean };

// ---------------------------------------------------------------------------------------------------------------------------------
// reflowAtCaret

/** The lines of reflowText.test.ts, with the caret at the end as it types them. */
const HAND_PICKED: [string, number?][] = [
  ["twelve chars"], ["exactly twenty chars"], ["the quick brown fox jumps"], ["the quick brown fox jumps", 4], ["the quick brown fox jumps over", 25],
  ["aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii"], ["the quick brown fox   jumps"],
  ["short\nthe quick brown fox jumps\nanother line that is far too long for it", 36],
  ["https://example.com/a/very/long/address"], ["https://example.com/a/very/long/address "], ["https://example.com/a/very/long/address and"],
  ["the quick brown fox "], ["  the quick brown fox jumps"], ["- the quick brown fox jumps"], ["12. the quick brown fox jumps"],
  ["- [ ] the quick brown fox jumps"], ["> the quick brown fox jumps"], ["> > the quick brown fox jumps"], ["-    unbroken-text-that-is-too-long"],
  ["## a heading that runs past the column"], ['<Image src="app_data/a.png" width={300} />'],
  ["```ts\nconst something = another thing entirely;"], ["```ts\nconst something = another thing entirely;\n```\nthe quick brown fox jumps"],
  ["~~~\nthe quick brown fox jumps"], ["---\ntitle: the quick brown fox jumps\n"], ["---\ntitle: a\n---\nthe quick brown fox jumps"],
  ["para\n\n    the quick brown fox jumps"], ["- a\n\n    - the quick brown fox jumps"],
  ["| name | what it is |\n| --- | --- |\n| the quick brown fox | jumps over |"], ["| the quick brown fox | jumps over |"],
  ["name | what it is\n--- | ---\nthe quick brown fox | jumps over"], ["the quick brown fox | jumps"],
  ["| name | what it is |\n| --- | --- |\n| the quick brown fox | jumps over |\n\nthe quick brown fox jumps"],
  // Where the caret is in a text with a break to make, and at its two ends.
  ["", 0], ["x", 0], ["the quick brown fox jumps", 0], ["the quick brown fox jumps", 19], ["the quick brown fox jumps", 20], ["the quick brown fox jumps", 21],
  ["line one\nthe quick brown fox jumps over the lazy dog\nline three", 9], ["line one\nthe quick brown fox jumps over the lazy dog\nline three", 54],
];

const WORDS = [
  "a", "an", "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "supercalifragilisticexpialidocious", "https://example.com/a/very/long/address",
  "naïve", "café", "日本語", "😀", "e\u0301", "x", "hello,", "world.", "**bold**", "`code`", "[link](https://example.com)", "a|b", "—", "|", "---", ":---:", "-",
];
const SPACES = [" ", " ", " ", " ", "  ", "   ", "\u00a0", "\u3000", "\t"];
const PREFIXES = [
  "", "", "", "  ", "\t", "- ", "* ", "+ ", "1. ", "12) ", "123456789. ", "1234567890. ", "- [ ] ", "- [x] ", "- [X] ", "-  ", "-\t", "> ", ">> ", "> > ", ">  ",
  "  > - ", "\u00a0\u00a0", "\u3000", "- [ ]x ", "-x ", "-", "- [ ]", "#", "# ", "### ", "####### ", "<", "<b>", "|", "| ", " | ", "    ", "      ",
  "\ufeff", "\u0085 ", "\u2028", "   ", "    - ", "\u00a0- ", "1.", "1 ", "`` ", "``", "~~", "~~ ", "`code` ", "~~~~~~ ",
];
const CONTEXTS: string[][] = [
  [], [], [], ["para", ""], ["", "para", ""], ["---", "title: x", "---"], ["---", "title: x"], ["---", "---"], ["```", "code"], ["```", "code", "```"],
  ["~~~"], ["~~~~", "x", "~~~"], ["````", "```", "x", "````"], ["  ```", "x"], ["    ```", "x"], ["| a | b |", "| --- | --- |"], ["a | b", "--- | ---"],
  ["a | b", "no delimiter here"], ["- a", ""], ["- a", "", "para", ""], ["\ufeff---", "x", "---"], ["---\u00a0", "x", "---"], ["# heading", ""], ["<div>", ""],
  ["| h |", "|---|", "| c |", ""], ["para", "  "], ["para", "\u3000"], ["para", "\t"], ["para", "\u00a0"], ["para", "\u0085"],
  ["h | h", ":-: | :-:"], ["h | h", "|:--|--:|"], ["h | h", "| - |"], ["h | h", "|-|-|"], ["h | h", "| --- | --- | ---"], ["h | h", "-- | --"],
  ["h | h", "| -- x |"], ["h | h", "|||"], ["h | h", "| |"], ["h | h", "| --- | ---  |  "], ["h | h", "---:|:---"], ["h | h", "\u00a0| --- |\u3000"],
];

function reflowCases(): Json[] {
  const next = random(20261109);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const texts: [string, number | undefined][] = HAND_PICKED.map(([text, caret]) => [text, caret]);
  for (let i = 0; i < 520; i++) {
    const count = 1 + Math.floor(next() * 12);
    let line = pick(PREFIXES);
    for (let w = 0; w < count; w++) line += (w ? pick(SPACES) : "") + pick(WORDS);
    if (next() < 0.15) line += pick(SPACES);
    const context = pick(CONTEXTS);
    const after = pick([[], [], [], [], [], ["", "tail line"], ["--- | ---"], ["| --- | --- |"], [":-: | --"], ["---"], ["|---|---|", "row | row"]]);
    const text = [...context, line, ...after].join("\n");
    const start = [...context].join("\n").length + (context.length ? 1 : 0);
    // A caret at the end of the typed line, or at the start, in its middle, or after one of its spaces.
    const spaces = [...line.matchAll(/ /g)].map((m) => start + m.index + 1);
    const carets = [start + line.length, start + line.length, start, start + Math.floor(line.length / 2), spaces.length ? pick(spaces) : start + line.length];
    texts.push([text, pick(carets)]);
  }
  // A few with Windows line ends and bare returns, which the desktop's `split("\n")` leaves on the lines.
  texts.push(["one\r\nthe quick brown fox jumps over", undefined], ["the quick brown fox jumps over\r\nnext", 25], ["a\rthe quick brown fox jumps over", undefined]);

  const cases: Json[] = [];
  const columns = [8, 10, 20, 20, 30, 80];
  texts.forEach(([text, caret], i) => {
    const at = caret ?? text.length;
    const column = i < HAND_PICKED.length ? 20 : pick(columns);
    for (const keepTables of i < HAND_PICKED.length ? [true, false] : [next() < 0.8]) {
      const options: Options = { column, keepTables };
      const edit = reflowAtCaret(text, at, options);
      cases.push({ text, caret: at, column, keepTables, edit: edit ? { text: edit.text, caret: edit.caret } : null });
    }
  });
  return cases;
}

function spanCases(): Json[] {
  const pairs: [string, string][] = [
    ["the quick brown fox jumps", "the quick brown fox\njumps"], ["same", "same"], ["", ""], ["", "x"], ["x", ""], ["abc", "abXc"], ["abXc", "abc"],
    ["aaa", "aaaa"], ["aaaa", "aaa"], ["a  b", "a\n  b"], ["x y z", "x\ny\nz"], ["😀 a", "😀\na"], ["😀", "😁"], ["é", "e\u0301"], ["ab", "ba"],
    ["- the quick brown fox jumps", "- the quick brown\n  fox jumps"], ["prefix same suffix", "prefix changed suffix"], ["a b a b", "a\nb a b"],
  ];
  return pairs.map(([before, after]) => ({ before, after, span: changedSpan(before, after) as unknown as Json }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The live editor's filter

/** One change to `doc` with the caret after it, run through the real CodeMirror state with `liveReflow` on. */
function typed(doc: string, from: number, to: number, insert: string, caret: number, event: string | null, options: Options) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: liveReflow(options) });
  const spec: TransactionSpec = { changes: { from, to, insert }, selection: { anchor: caret }, ...(event ? { userEvent: event } : {}) };
  const tr = state.update(spec);
  return { text: tr.state.doc.toString(), caret: tr.state.selection.main.head };
}

function typingCases(): Json[] {
  const next = random(424242);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const cases: Json[] = [];
  const add = (doc: string, from: number, to: number, insert: string, event: string | null, options: Options) => {
    const caret = from + insert.length;
    const plain = doc.slice(0, from) + insert + doc.slice(to);
    const result = typed(doc, from, to, insert, caret, event, options);
    cases.push({ doc, from, to, insert, caret, event, ...options, result: { text: result.text, caret: result.caret, reflowed: result.text !== plain } });
  };
  const options: Options = { column: 20, keepTables: true };
  // The rules of liveReflow.test.ts.
  add("the quick brown fox", 19, 19, " ", "input.type", options);
  add("the quick brown fox ", 20, 20, "j", "input.type", options);
  add("- the quick brown fo", 20, 20, "x", "input.type", options);
  add("| the quick brown fox | jumps over", 33, 33, " ", "input.type", options);
  add("| the quick brown fox | jumps over", 33, 33, " ", "input.type", { column: 20, keepTables: false });
  add("short", 5, 5, "!", "input.type", options);
  add("the quick brown fox ", 20, 20, "jumps", "input.type", options);
  for (const event of ["input.paste", "input.drop", "input", "delete.backward", "undo", "input.type.compose", "input.type.compose.more", "select", null]) {
    add("", 0, 0, "the quick brown fox jumps over the lazy dog", event, options);
    add("the quick brown fox ", 20, 20, "j", event, options);
  }
  // `input.type.` followed by something else is still typing; `input.typed` is not.
  add("the quick brown fox ", 20, 20, "j", "input.type.autocorrect", options);
  add("the quick brown fox ", 20, 20, "j", "input.typed", options);
  add("the quick brown fox ", 20, 20, "j", "input.types.compose", options);
  // A line break in what was typed, or a replaced stretch, a caret in the middle, a typed character that is itself a space or a pair.
  add("the quick brown fox jumps over", 0, 0, "x\ny", "input.type", options);
  add("the quick brown fox jumps over", 4, 9, "slow", "input.type", options);
  add("the quick brown fox jumps over", 10, 10, " long", "input.type", options);
  add("the quick brown fox jumps over", 30, 30, "😀", "input.type", options);
  for (let i = 0; i < 230; i++) {
    const count = 3 + Math.floor(next() * 9);
    let line = pick(PREFIXES.filter((p) => !p.includes("\r")));
    for (let w = 0; w < count; w++) line += (w ? pick(SPACES) : "") + pick(WORDS);
    const context = pick(CONTEXTS);
    const before = [...context, line.replace(/[\r\u2028]/g, "")].join("\n");
    const caret = before.length;
    const insert = pick([" ", "a", "j", "é", "😀", "-", "|", "jumps", "word ", " ,", ".", "\t"]);
    const event = pick(["input.type", "input.type", "input.type", "input.type", "input.paste", "input.type.compose", "delete.backward", null]);
    add(before, caret, caret, insert, event, { column: pick([8, 10, 20, 30]), keepTables: next() < 0.8 });
  }
  return cases;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The settings that switch it on

const COLUMNS: Json[] = [19, 20, 21, 80, 199, 200, 201, 0, -80, 80.5, "80", null, true, false, [80], { column: 80 }, 1e9, 1e-9];
const FLAGS: Json[] = [true, false, "true", 1, 0, null, [], {}];
const SIDES: Json[] = ["left", "right", "Left", "", "center", null, 1, ["left"]];

function writingCases(): { parse: Json[]; validate: Json[] } {
  const inputs: Json[] = [
    {}, null, [], "text", 5, true,
    { rulerEnabled: true, rulerColumn: 100, reflowEnabled: true, reflowColumn: 72, reflowKeepsTables: false, wordCountEnabled: true, headingRailEnabled: false, headingRailSide: "right" },
    ...COLUMNS.flatMap((c): Json[] => [{ rulerColumn: c }, { reflowColumn: c }]),
    ...FLAGS.flatMap((f): Json[] => [{ rulerEnabled: f }, { reflowEnabled: f }, { reflowKeepsTables: f }, { wordCountEnabled: f }, { headingRailEnabled: f }]),
    ...SIDES.map((side): Json => ({ headingRailSide: side })),
  ];
  const full = (patch: Record<string, Json>): Json => ({
    rulerEnabled: true, rulerColumn: 80, reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true, wordCountEnabled: false, headingRailEnabled: true, headingRailSide: "left", ...patch,
  });
  const toValidate: Json[] = [
    full({}), null, {}, [], "text", full({ extra: 1 }),
    ...COLUMNS.flatMap((c): Json[] => [full({ rulerColumn: c }), full({ reflowColumn: c })]),
    ...FLAGS.flatMap((f): Json[] => [full({ rulerEnabled: f }), full({ reflowEnabled: f }), full({ reflowKeepsTables: f }), full({ wordCountEnabled: f }), full({ headingRailEnabled: f })]),
    ...SIDES.map((side) => full({ headingRailSide: side })),
  ];
  return {
    parse: inputs.map((input) => ({ input, settings: parseWritingSettings(input) as unknown as Json })),
    validate: toValidate.map((input) => {
      const result = validateWritingSettings(input);
      return { input, ...(result.settings ? { settings: result.settings as unknown as Json } : { error: result.error as string }) };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------

function build(): Json {
  const { parse, validate } = writingCases();
  return {
    about:
      "Made by apps/web/src/components/notes/reflowConformance.test.ts from the desktop's reflowText.ts, liveReflow.ts and writing.ts; ReflowConformanceTests replays it. Do not edit by hand: UPDATE_FIXTURES=1 pnpm exec vitest run src/components/notes/reflowConformance.test.ts",
    reflow: reflowCases(),
    spans: spanCases(),
    typing: typingCases(),
    writingParse: parse,
    writingValidate: validate,
  };
}

function format(fixture: Json): string {
  const sections = Object.entries(fixture as { [key: string]: Json }).map(([key, value]) => `  ${JSON.stringify(key)}: ${pretty(value, "  ")}`);
  return `{\n${sections.join(",\n")}\n}\n`;
}

describe("the reflow fixture (fixtures/conformance/reflow.json)", () => {
  const file = conformancePath("reflow.json");

  it(UPDATING_FIXTURES ? "is rewritten from the TypeScript behaviour" : "is what the TypeScript makes", () => {
    const fixture = JSON.parse(JSON.stringify(build())) as { [key: string]: Json };
    if (UPDATING_FIXTURES) {
      fs.writeFileSync(file, format(fixture));
      return;
    }
    const committed = JSON.parse(fs.readFileSync(file, "utf8")) as { [key: string]: Json };
    for (const key of Object.keys(fixture)) expect(committed[key], `section "${key}"`).toEqual(fixture[key]);
    expect(Object.keys(committed)).toEqual(Object.keys(fixture));
  });

  it("covers what it is meant to", () => {
    const fixture = JSON.parse(JSON.stringify(build())) as { [key: string]: { [key: string]: Json }[] };
    expect(fixture.reflow.length).toBeGreaterThan(550);
    expect(fixture.reflow.filter((c) => c.edit !== null).length).toBeGreaterThan(200);
    expect(fixture.reflow.filter((c) => c.edit === null).length).toBeGreaterThan(150);
    expect(fixture.typing.some((c) => (c.result as { reflowed: boolean }).reflowed)).toBe(true);
    expect(fixture.typing.some((c) => !(c.result as { reflowed: boolean }).reflowed && (c.insert as string).length > 5)).toBe(true);
    expect(fixture.writingValidate.some((c) => "error" in c)).toBe(true);
  });
});
