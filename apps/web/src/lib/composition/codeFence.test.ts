import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeLines, hasLineOptions, isHighlighted, parseCodeFence } from "./codeFence";

type Case = {
  info: string;
  language: string;
  lineNumbers: boolean;
  start: number;
  highlight: [number, number][];
  lineCount?: number;
  lines?: { number: number; highlighted: boolean }[];
};

const casesFile = fileURLToPath(new URL("../../../../../fixtures/conformance/code-fence-cases.json", import.meta.url));
const { cases } = JSON.parse(readFileSync(casesFile, "utf8")) as { cases: Case[] };

describe("parseCodeFence (fixtures/conformance/code-fence-cases.json)", () => {
  it.each(cases)("reads $info", ({ info, language, lineNumbers, start, highlight, lineCount, lines }) => {
    const fence = parseCodeFence(info);
    expect(fence).toEqual({ language, lineNumbers, start, highlight });
    if (lineCount !== undefined) expect(codeLines(fence, lineCount)).toEqual(lines);
  });
});

describe("hasLineOptions", () => {
  it("is false for a plain fence and true with numbers or a highlight", () => {
    expect(hasLineOptions(parseCodeFence("ts"))).toBe(false);
    expect(hasLineOptions(parseCodeFence("ts title=x"))).toBe(false);
    expect(hasLineOptions(parseCodeFence("ts showLineNumbers"))).toBe(true);
    expect(hasLineOptions(parseCodeFence("ts {2}"))).toBe(true);
  });
});

describe("isHighlighted", () => {
  it("uses the numbers the block shows", () => {
    const fence = parseCodeFence("ts showLineNumbers=107 {109}");
    expect(isHighlighted(fence, 109)).toBe(true);
    expect(isHighlighted(fence, 3)).toBe(false);
  });
});
