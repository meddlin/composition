import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { conformancePath, loadConformance } from "./__fixtures__/conformance";
import { INK_FIELDS, INK_LIMITS, InkError, inkToJSON, parseInk, parseInkText, readColor, storedNumber } from "./ink";

type Case = { name: string; input: unknown } & ({ stored: unknown; invalid?: never } | { invalid: true; stored?: never });

/** The rules the Swift core follows too: the cases are in fixtures/conformance/ink/validation.json. */
const { cases } = loadConformance<{ cases: Case[] }>("ink/validation.json");

describe("parseInk against the corpus", () => {
  it("has the cases the Swift side counts on", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.filter((entry) => entry.invalid).length).toBeGreaterThanOrEqual(20);
  });

  for (const entry of cases) {
    it(entry.name, () => {
      if (entry.invalid) {
        expect(() => parseInk(entry.input)).toThrow(InkError);
      } else {
        const drawing = parseInk(entry.input);
        expect(inkToJSON(drawing)).toEqual(entry.stored);
        // What is written back is stable: reading it and writing it again changes nothing (the first write already rounded).
        expect(inkToJSON(parseInk(inkToJSON(drawing)))).toEqual(inkToJSON(drawing));
      }
    });
  }
});

describe("the committed drawing", () => {
  const text = fs.readFileSync(conformancePath("ink/drawing.json"), "utf8");

  it("reads, and is written back to the same text", () => {
    const drawing = parseInkText(text);
    expect(drawing.width).toBe(200);
    expect(drawing.strokes.map((stroke) => [stroke.ink, stroke.color, stroke.points.length])).toEqual([
      ["pen", "ink", 14],
      ["marker", "yellow", 3],
      ["monoline", "#c81e1e", 3],
      ["pen", "accent", 1],
    ]);
    // "Written the way JavaScript writes them": the text Swift wrote is the text JSON.stringify gives for the same drawing.
    expect(JSON.stringify(inkToJSON(drawing))).toBe(text.trim());
  });
});

describe("parseInkText", () => {
  it("refuses text that is not JSON", () => {
    expect(() => parseInkText("{not json")).toThrow("damaged");
  });

  it("refuses a drawing from a newer version, and says so", () => {
    expect(() => parseInk({ format: "composition-ink", version: 2, canvas: { width: 1, height: 1 }, strokes: [] })).toThrow("newer version");
  });

  it("refuses more strokes than a page may have, and more points", () => {
    const base = { format: "composition-ink", version: 1, canvas: { width: 10, height: 10 } };
    expect(() => parseInk({ ...base, strokes: new Array(INK_LIMITS.strokes + 1).fill({ points: [] }) })).toThrow("too many strokes");
    const stroke = { points: new Array(INK_LIMITS.points / 2 + 1).fill([1, 1]) };
    expect(() => parseInk({ ...base, strokes: [stroke, stroke] })).toThrow("too many points");
  });

  it("keeps a member called __proto__ as a member, and reads a colour name like `constructor` as a name", () => {
    const text =
      '{"format":"composition-ink","version":1,"canvas":{"width":10,"height":10},"__proto__":{"x":1},"strokes":[{"color":"constructor","points":[[1,1]]}]}';
    const drawing = parseInkText(text);
    expect(Object.keys(drawing.extra)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(drawing.extra)).toBe(Object.prototype);
    expect(drawing.strokes[0].color).toBe("constructor");
    expect(JSON.stringify(inkToJSON(drawing))).toContain('"__proto__":{"x":1}');
  });
});

describe("what the corpus does not pin, as the Swift reader has it", () => {
  const base = { format: "composition-ink", version: 1, canvas: { width: 10, height: 10 } };

  it("refuses `ink`, `color` and `fields` set to null: only a member that is absent takes the default", () => {
    expect(() => parseInk({ ...base, strokes: [{ ink: null, points: [] }] })).toThrow(InkError);
    expect(() => parseInk({ ...base, strokes: [{ color: null, points: [] }] })).toThrow(InkError);
    expect(() => parseInk({ ...base, fields: null, strokes: [] })).toThrow(InkError);
  });

  it("gives a null in a known column its default, and keeps a null in an extra one", () => {
    const drawing = parseInk({ ...base, fields: ["x", "y", "width", "tag"], strokes: [{ points: [[1, 2, null, null], [3, 4, 5, "kept"]] }] });
    expect(drawing.strokes[0].points.map((point) => point.width)).toEqual([3, 5]);
    expect(drawing.strokes[0].extraColumns).toEqual([{ name: "tag", values: [null, "kept"] }]);
    expect(inkToJSON(drawing).strokes).toEqual([
      { ink: "pen", color: "ink", points: [[1, 2, 0, 1, 1.571, 0, 3, 3, 1, null], [3, 4, 0, 1, 1.571, 0, 5, 3, 1, "kept"]] },
    ]);
  });

  it("refuses a number that is not finite, which JSON can write as 1e999", () => {
    expect(() => parseInkText('{"format":"composition-ink","version":1,"canvas":{"width":10,"height":10},"strokes":[{"points":[[1e999,2]]}]}')).toThrow(InkError);
  });

  it("writes a column some strokes lack as null, in the strokes that lack it", () => {
    const drawing = parseInk({ ...base, strokes: [{ points: [[1, 1]] }, { points: [[2, 2]] }] });
    drawing.strokes[1].extraColumns.push({ name: "extra", values: [9] });
    const written = inkToJSON(drawing);
    expect(written.fields).toEqual([...INK_FIELDS, "extra"]);
    expect((written.strokes as { points: unknown[][] }[]).map((stroke) => stroke.points[0].at(-1))).toEqual([null, 9]);
  });
});

describe("storedNumber", () => {
  it("rounds half away from zero, in both directions", () => {
    expect(storedNumber(0.125, 0.01)).toBe(0.13);
    expect(storedNumber(-0.125, 0.01)).toBe(-0.13);
    expect(storedNumber(2.5, 1)).toBe(3);
    expect(storedNumber(-2.5, 1)).toBe(-3);
    expect(storedNumber(0.0005, 0.001)).toBe(0.001);
  });

  it("writes a tiny negative number as zero, not negative zero", () => {
    expect(Object.is(storedNumber(-0.001, 0.01), 0)).toBe(true);
    expect(JSON.stringify(storedNumber(-0.001, 0.01))).toBe("0");
  });
});

describe("readColor", () => {
  it("lower-cases a fixed colour and keeps a name", () => {
    expect(readColor("#C81E1E")).toBe("#c81e1e");
    expect(readColor("accent")).toBe("accent");
    expect(readColor("dark-blue-2")).toBe("dark-blue-2");
  });

  it("refuses what is neither", () => {
    for (const text of ["", "Red", "#fff", "#12345", "#1234567", "#gggggg", "a".repeat(33), "pink!", "red green"]) expect(readColor(text)).toBeNull();
  });
});
