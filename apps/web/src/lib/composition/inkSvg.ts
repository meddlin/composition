import type { InkDrawing, InkPoint, InkStroke } from "./ink";

/**
 * A drawing as shapes for an SVG (docs/architecture/ink.md, "The renderer"): view only, generated at render time, never a
 * file a note stores or accepts (`images.ts` refuses SVG on purpose). It follows the iPad's `InkRenderer`: each stroke is
 * the outline swept by its nib (a Catmull-Rom curve through the control points, the convex hull of two neighbouring
 * ellipses between samples), filled once at one opacity, so a stroke's overlapping parts don't darken. The textured inks
 * are approximated by opacity alone and their grain and bleed are not reproduced; a monoline is one width, the mean of its
 * points'. Matching PencilKit's own render is not the goal.
 *
 * Pure, so the preview, the live editor and tests share it. Where the Swift renderer draws a sample for about every half
 * nib width, this one first drops control points closer than a quarter of one (a pencil samples at 240 Hz, far denser than
 * the nib needs) and caps the whole drawing at `MAX_SAMPLES`, so a page's path stays a few hundred kilobytes.
 */

/** The hue of each `<Mark>` colour (`--mark-hue` in globals.css), the same in every scheme. */
export const INK_MARK_HUES: Readonly<Record<string, string>> = {
  yellow: "#f5c518",
  green: "#3fb876",
  blue: "#3b9eff",
  pink: "#ff6fae",
  orange: "#ff8a2b",
};

/** What the names in a drawing look like: `ink` and `accent` follow the scheme, a `<Mark>` colour name is that hue. */
export type InkPalette = { ink: string; accent: string; marks: Readonly<Record<string, string>> };

/** The page's own tokens, so a drawing already on screen follows a change of colour scheme: black ink is white on a dark one. */
export const CSS_INK_PALETTE: InkPalette = { ink: "var(--foreground)", accent: "var(--brand)", marks: INK_MARK_HUES };

/** The colour a stroke is drawn in. A name the palette doesn't know is drawn as ink. */
export function inkColor(color: string, palette: InkPalette = CSS_INK_PALETTE): string {
  if (color.startsWith("#")) return color;
  if (color === "accent") return palette.accent;
  return Object.hasOwn(palette.marks, color) ? palette.marks[color] : palette.ink;
}

export type InkShape = { d: string; fill: string; opacity: number };
export type InkPicture = { width: number; height: number; shapes: InkShape[] };

/** How much of the colour each textured ink shows, and which draw one width (the mean of the points') all along. */
function styleOf(ink: string): { alpha: number; constantWidth: boolean } {
  switch (ink) {
    case "marker":
      return { alpha: 0.45, constantWidth: false };
    case "pencil":
      return { alpha: 0.8, constantWidth: false };
    case "watercolor":
      return { alpha: 0.4, constantWidth: false };
    case "crayon":
      return { alpha: 0.9, constantWidth: false };
    case "monoline":
      return { alpha: 1, constantWidth: true };
    default:
      return { alpha: 1, constantWidth: false };
  }
}

/** A point of the smoothed outline: where, how big the nib is there, and how much of the stroke's colour shows. */
type Sample = { x: number; y: number; w: number; h: number; opacity: number };

/** Most samples a drawing draws; past it the spacing between them grows until it fits. */
export const MAX_SAMPLES = 60_000;

const MIN_NIB = 0.5;

export function inkPicture(drawing: InkDrawing, palette: InkPalette = CSS_INK_PALETTE): InkPicture {
  const drawn = drawing.strokes.filter((stroke) => stroke.points.length > 0);
  // Thin the control points until the drawing's samples fit; most pages fit the first time.
  let strokes: Sample[][] = [];
  for (let spacing = 0.25; ; spacing *= 2) {
    strokes = drawn.map((stroke) => samplesOf(stroke, spacing));
    if (spacing >= 64 || strokes.reduce((total, samples) => total + samples.length, 0) <= MAX_SAMPLES) break;
  }

  const shapes = drawn.map((stroke, index): InkShape => {
    const samples = strokes[index];
    const { alpha } = styleOf(stroke.ink);
    const polygons =
      samples.length === 1 ? [outline(samples[0])] : samples.slice(1).map((sample, at) => hull([...outline(samples[at]), ...outline(sample)]));
    const opacity = samples.reduce((sum, sample) => sum + sample.opacity, 0) / samples.length;
    return {
      d: polygons.map(polygonPath).join(""),
      fill: inkColor(stroke.color, palette),
      opacity: Math.round(alpha * Math.min(Math.max(opacity, 0), 1) * 1000) / 1000,
    };
  });
  return { width: drawing.width, height: drawing.height, shapes };
}

/** A stroke's samples: its control points thinned to `spacing` nib widths, smoothed, and its nib made one size if it's a monoline. */
function samplesOf(stroke: InkStroke, spacing: number): Sample[] {
  const { constantWidth } = styleOf(stroke.ink);
  const samples = smooth(thin(stroke.points, spacing));
  if (constantWidth) {
    const mean = stroke.points.reduce((sum, point) => sum + point.width, 0) / stroke.points.length;
    for (const sample of samples) sample.w = sample.h = Math.max(mean, MIN_NIB);
  }
  return samples;
}

/** The points that are at least `spacing` of their nib's width from the last kept one; the first and the last always stay. */
function thin(points: InkPoint[], spacing: number): InkPoint[] {
  if (points.length <= 2) return points;
  const kept = [points[0]];
  for (const point of points.slice(1, -1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= Math.max(MIN_NIB * 0.5, Math.min(point.width, last.width) * spacing)) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

const sampleOf = (point: InkPoint): Sample => ({
  x: point.x,
  y: point.y,
  w: Math.max(point.width, MIN_NIB),
  h: Math.max(point.height, MIN_NIB),
  opacity: point.opacity,
});

/** The points between the control points: a Catmull-Rom curve through them, a sample about every half nib width. */
function smooth(points: InkPoint[]): Sample[] {
  if (points.length <= 2) return points.map(sampleOf);
  const out: Sample[] = [sampleOf(points[0])];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(index - 1, 0)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(index + 2, points.length - 1)];
    const step = Math.max(0.5, Math.min(p1.width, p2.width) * 0.5);
    const pieces = Math.min(16, Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step)));
    for (let piece = 1; piece <= pieces; piece++) {
      const t = piece / pieces;
      const spline = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      const line = (a: number, b: number) => a + (b - a) * t;
      out.push({
        x: spline(p0.x, p1.x, p2.x, p3.x),
        y: spline(p0.y, p1.y, p2.y, p3.y),
        w: Math.max(line(p1.width, p2.width), MIN_NIB),
        h: Math.max(line(p1.height, p2.height), MIN_NIB),
        opacity: line(p1.opacity, p2.opacity),
      });
    }
  }
  return out;
}

type Corner = readonly [x: number, y: number];

/** The nib at a sample: an ellipse of a dozen corners (six for a tiny one). */
function outline(sample: Sample): Corner[] {
  const corners = sample.w < 2 && sample.h < 2 ? 6 : 12;
  return Array.from({ length: corners }, (_, corner): Corner => {
    const angle = (2 * Math.PI * corner) / corners;
    return [sample.x + (Math.cos(angle) * sample.w) / 2, sample.y + (Math.sin(angle) * sample.h) / 2];
  });
}

/** The convex hull of some points (Andrew's monotone chain): what a nib sweeps between two samples. */
function hull(points: Corner[]): Corner[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Corner, a: Corner, b: Corner) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (ordered: Corner[]) => {
    const chain: Corner[] = [];
    for (const point of ordered) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** A number to a hundredth of a point, with no trailing zeros. */
const num = (value: number) => String(Math.round(value * 100) / 100);

/** A closed polygon as path data. Every piece is wound the same way, so filling with the non-zero rule joins them into one shape. */
function polygonPath(corners: Corner[]): string {
  return corners.map(([x, y], index) => `${index === 0 ? "M" : "L"}${num(x)} ${num(y)}`).join("") + "Z";
}
