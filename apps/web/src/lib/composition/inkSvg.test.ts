import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conformancePath } from "./__fixtures__/conformance";
import { parseInk, parseInkText, type InkDrawing } from "./ink";
import { CSS_INK_PALETTE, INK_MARK_HUES, MAX_SAMPLES, darkStyleOf, inkColor, inkPicture, styleOf } from "./inkSvg";

const page = parseInkText(fs.readFileSync(conformancePath("ink/drawing.json"), "utf8"));

/** A drawing of one stroke: `points` are `[x, y, width, opacity]`. */
function stroke(ink: string, points: number[][], color = "ink"): InkDrawing {
  return parseInk({
    format: "composition-ink",
    version: 1,
    canvas: { width: 200, height: 100 },
    fields: ["x", "y", "width", "height", "opacity"],
    strokes: [{ ink, color, points: points.map(([x, y, width = 3, opacity = 1]) => [x, y, width, width, opacity]) }],
  });
}

/** The box a path's corners lie in. */
function bounds(d: string) {
  const corners = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), corners: corners.length };
}

describe("the tables the renderers share", () => {
  const corpus = JSON.parse(fs.readFileSync(conformancePath("ink/renderer.json"), "utf8")) as {
    inks: Record<string, { alpha: number; oneWidth: boolean }>;
    marks: Record<string, string>;
    unknownColourName: string;
    darkStyle: { pairs: [string, string][] };
  };

  it("show each ink at the corpus's share of its colour, and draw the same inks one width", () => {
    expect(Object.keys(corpus.inks).length).toBeGreaterThanOrEqual(8);
    for (const [ink, { alpha, oneWidth }] of Object.entries(corpus.inks)) expect(styleOf(ink), ink).toEqual({ alpha, constantWidth: oneWidth });
  });

  it("have the corpus's hues for the <Mark> colours, and draw a name nobody knows as ink", () => {
    expect(INK_MARK_HUES).toEqual(corpus.marks);
    expect(corpus.unknownColourName).toBe("ink");
    expect(inkColor("teal")).toBe(CSS_INK_PALETTE.ink);
  });
});

describe("a fixed colour on a dark scheme", () => {
  const { darkStyle } = JSON.parse(fs.readFileSync(conformancePath("ink/renderer.json"), "utf8")) as { darkStyle: { pairs: [string, string][] } };

  it("is the colour PencilKit shows in a dark interface style: the lightness of HSL reversed (pairs measured on the iPad Simulator)", () => {
    expect(darkStyle.pairs.length).toBeGreaterThanOrEqual(12);
    for (const [stored, shown] of darkStyle.pairs) expect(darkStyleOf(stored), stored).toBe(shown);
  });

  it("is drawn by `light-dark()`, which the page's `color-scheme` decides; a colour that does not change is plain", () => {
    expect(inkColor("#c81e1e")).toBe(`light-dark(#c81e1e, ${darkStyleOf("#c81e1e")})`);
    expect(inkColor("#0d2680")).toBe("light-dark(#0d2680, #7f98f2)");
    expect(inkColor("#ff0000")).toBe("#ff0000");
    expect(inkColor("#ffcc00")).toBe("#ffcc00");
  });

  it("leaves a name where the scheme puts it: ink, accent and a mark hue are the same on every scheme but through their own variables", () => {
    expect(inkColor("blue")).toBe(INK_MARK_HUES.blue);
    expect(inkColor("ink")).toBe("var(--foreground)");
  });
});

describe("inkColor", () => {
  it("resolves the names against the palette", () => {
    expect(inkColor("ink")).toBe("var(--foreground)");
    expect(inkColor("accent")).toBe("var(--brand)");
    for (const [name, hue] of Object.entries(INK_MARK_HUES)) expect(inkColor(name)).toBe(hue);
    expect(inkColor("#c81e1e", { ...CSS_INK_PALETTE, fixed: undefined })).toBe("#c81e1e");
  });

  it("draws a name it does not know as ink, even one that is a property of every object", () => {
    expect(inkColor("teal")).toBe("var(--foreground)");
    expect(inkColor("constructor")).toBe("var(--foreground)");
    expect(inkColor("__proto__")).toBe("var(--foreground)");
  });

  it("follows another palette (black ink is white on a dark scheme)", () => {
    const palette = { ink: "#e6e6e6", accent: "#4f8ff0", marks: {} };
    expect([inkColor("ink", palette), inkColor("accent", palette), inkColor("pink", palette)]).toEqual(["#e6e6e6", "#4f8ff0", "#e6e6e6"]);
  });

  it("has the hues the stylesheet gives <Mark>", () => {
    const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8");
    const hue = (color: string) =>
      color === "yellow"
        ? css.match(/\.md-mark \{[^}]*--mark-hue:\s*(#[0-9a-f]{6})/)?.[1]
        : css.match(new RegExp(`\\[data-color="${color}"\\] \\{[^}]*--mark-hue:\\s*(#[0-9a-f]{6})`))?.[1];
    expect(Object.keys(INK_MARK_HUES)).toEqual(["yellow", "green", "blue", "pink", "orange"]);
    for (const [name, value] of Object.entries(INK_MARK_HUES)) expect(hue(name)).toBe(value);
  });
});

describe("inkPicture", () => {
  it("draws the committed page: a shape a stroke, in the colour and opacity of its ink", () => {
    const { width, height, shapes } = inkPicture(page);
    expect([width, height]).toEqual([200, 120]);
    expect(shapes.map(({ fill, opacity }) => [fill, opacity])).toEqual([
      ["var(--foreground)", 1],
      [INK_MARK_HUES.yellow, 0.225], // a marker (0.45) of points at 0.5
      [`light-dark(#c81e1e, ${darkStyleOf("#c81e1e")})`, 1],
      ["var(--brand)", 1],
    ]);
    for (const { d } of shapes) expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+)+Z/);
  });

  it("uses a palette it is given", () => {
    const palette = { ink: "#fff", accent: "#0af", marks: {} };
    expect(inkPicture(page, palette).shapes.map((shape) => shape.fill)).toEqual(["#fff", "#fff", "#c81e1e", "#0af"]);
    expect(inkPicture(page, CSS_INK_PALETTE).shapes[0].fill).toBe("var(--foreground)");
  });

  it.each([
    ["pen", 1],
    ["fountainPen", 1],
    ["monoline", 1],
    ["marker", 0.45],
    ["pencil", 0.8],
    ["watercolor", 0.4],
    ["crayon", 0.9],
    ["airbrush", 1], // an ink this version does not know is drawn like a pen
  ])("draws %s at %s of its colour", (ink, opacity) => {
    expect(inkPicture(stroke(ink, [[10, 10], [50, 10]])).shapes[0].opacity).toBe(opacity);
  });

  it("scales a stroke's opacity by its points'", () => {
    expect(inkPicture(stroke("pencil", [[10, 10, 3, 0.5], [50, 10, 3, 0.5]])).shapes[0].opacity).toBe(0.4);
    expect(inkPicture(stroke("pen", [[10, 10, 3, 0], [50, 10, 3, 0]])).shapes[0].opacity).toBe(0);
  });

  it("sweeps the nib along the stroke: a line of width 4 reaches 2 points past its ends and sides", () => {
    const { x0, x1, y0, y1 } = bounds(inkPicture(stroke("pen", [[10, 10, 4], [50, 10, 4]])).shapes[0].d);
    expect([x0, x1, y0, y1]).toEqual([8, 52, 8, 12]);
  });

  it("follows the nib's size along the stroke, except a monoline's, which is the mean", () => {
    const points = [[10, 10, 2], [50, 10, 10]];
    const pen = bounds(inkPicture(stroke("pen", points)).shapes[0].d);
    expect([pen.y0, pen.y1]).toEqual([5, 15]);
    const monoline = bounds(inkPicture(stroke("monoline", points)).shapes[0].d);
    expect([monoline.y0, monoline.y1]).toEqual([7, 13]);
  });

  it("draws a lone point as its nib, and a stroke with no points as nothing", () => {
    const dot = bounds(inkPicture(stroke("pen", [[100, 60, 8]])).shapes[0].d);
    expect([dot.x0, dot.x1, dot.y0, dot.y1, dot.corners]).toEqual([96, 104, 56, 64, 12]);
    expect(inkPicture(stroke("pen", [])).shapes).toEqual([]);
  });

  it("draws an oval nib at its own width and height", () => {
    const drawing = parseInk({
      format: "composition-ink",
      version: 1,
      canvas: { width: 100, height: 100 },
      fields: ["x", "y", "width", "height"],
      strokes: [{ ink: "marker", color: "ink", points: [[50, 50, 20, 4]] }],
    });
    const { x0, x1, y0, y1 } = bounds(inkPicture(drawing).shapes[0].d);
    expect([x0, x1, y0, y1]).toEqual([40, 60, 48, 52]);
  });

  it("keeps a page's path small by thinning samples it does not need", () => {
    // A thousand control points in a line, a hundredth of a point apart: a nib of 3 needs a handful of them.
    const points = Array.from({ length: 1000 }, (_, index) => [10 + index / 100, 10]);
    expect(inkPicture(stroke("pen", points)).shapes[0].d.length).toBeLessThan(2500);

    // And a drawing of far more samples than any page needs stays within what the renderer budgets.
    const dense = parseInk({
      format: "composition-ink",
      version: 1,
      canvas: { width: 100, height: 100 },
      strokes: Array.from({ length: 400 }, (_, row) => ({ points: Array.from({ length: 2000 }, (_, i) => [i / 20, (row + (i % 2) * 0.2) / 4]) })),
    });
    const { shapes } = inkPicture(dense);
    const corners = shapes.reduce((total, shape) => total + (shape.d.match(/M/g)?.length ?? 0), 0);
    expect(corners).toBeLessThanOrEqual(MAX_SAMPLES);
    // 800,000 points: about half a second here, several times that on a busy CI runner, so it gets more than vitest's 5 s.
  }, 60_000);
});
