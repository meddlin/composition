import { describe, expect, it } from "vitest";
import { highlightCode, highlightsOf, languageOf } from "./codeHighlight";

type Node = { type: string; value?: string; properties?: { className: string[] }; children?: Node[] };
const text = (value: string): Node => ({ type: "text", value });
const span = (className: string[], ...children: Node[]): Node => ({ type: "element", properties: { className }, children });

describe("languageOf", () => {
  it("is the first word of the info string, lowercased", () => {
    expect(languageOf("ts")).toBe("ts");
    expect(languageOf('  Python title="x.py"')).toBe("python");
  });

  it("is nothing for a fence with no language", () => {
    expect(languageOf(undefined)).toBeUndefined();
    expect(languageOf("")).toBeUndefined();
    expect(languageOf("   ")).toBeUndefined();
  });
});

describe("highlightsOf", () => {
  it("gives each scope's text its style, as offsets into the code", () => {
    // const x = "hi"
    const tree = {
      type: "root",
      children: [span(["hljs-keyword"], text("const")), text(" x = "), span(["hljs-string"], text('"hi"'))],
    };
    expect(highlightsOf(tree)).toEqual([
      [0, 5, "code.keyword"],
      [10, 14, "code.string"],
    ]);
  });

  it("colors a scope with no style of its own as what it is inside, and the innermost scope wins", () => {
    const tree = {
      type: "root",
      children: [span(["hljs-string"], text("a"), span(["hljs-subst"], text("b")), span(["hljs-keyword"], text("c")), text("d"))],
    };
    expect(highlightsOf(tree)).toEqual([
      [0, 2, "code.string"],
      [2, 3, "code.keyword"],
      [3, 4, "code.string"],
    ]);
  });

  it("colors a class's name as a type, not a function", () => {
    const tree = { type: "root", children: [span(["hljs-title", "class_"], text("Note")), span(["hljs-title", "function_"], text("go"))] };
    expect(highlightsOf(tree)).toEqual([
      [0, 4, "code.type"],
      [4, 6, "code.function"],
    ]);
  });
});

describe("highlightCode", () => {
  const styleAt = (code: string, highlights: [number, number, string][], word: string) => {
    const at = code.indexOf(word);
    return highlights.find(([start, end]) => start <= at && at + word.length <= end)?.[2];
  };

  it.each([
    ["ts", 'const answer: number = 42; // yes', { const: "code.keyword", "42": "code.number", "// yes": "code.comment" }],
    ["python", 'def go(): return "hi"', { def: "code.keyword", '"hi"': "code.string" }],
    ["rust", "fn main() { let x = 1; }", { fn: "code.keyword", "1": "code.number" }],
    ["bash", "echo $HOME # note", { "# note": "code.comment" }],
    ["json", '{"a": true}', { '"a"': "code.attr", true: "code.keyword" }],
  ] as const)("highlights %s, in the languages web does", async (language, code, expected) => {
    const highlights = (await highlightCode(code, language))!;
    for (const [word, style] of Object.entries(expected)) expect(styleAt(code, highlights, word), word).toBe(style);
  });

  it("knows a language by an alias, and reads it off a longer info string", async () => {
    const code = "const a = 1;";
    expect(await highlightCode(code, "js")).toEqual(await highlightCode(code, "javascript"));
    expect(await highlightCode(code, 'js title="a.js"')).toEqual(await highlightCode(code, "js"));
  });

  it("leaves a fence with no language, or one it doesn't know, as plain text", async () => {
    expect(await highlightCode("const a = 1;", undefined)).toBeUndefined();
    expect(await highlightCode("const a = 1;", "")).toBeUndefined();
    expect(await highlightCode("const a = 1;", "no-such-language")).toBeUndefined();
  });
});
