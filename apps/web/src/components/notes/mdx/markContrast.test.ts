import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HIGHLIGHT_COLORS } from "./highlightColors";

// <Mark> tints its hue over the page (.note-mark in globals.css); the text on top must stay readable
// in every scheme. "auto" reuses the dark and light palettes, so these five cover it.
const css = fs.readFileSync(path.join(__dirname, "../../../app/globals.css"), "utf-8");

const SCHEMES = ["dark", "light", "forest", "wine", "cream"] as const;

const block = (selector: string) => css.match(new RegExp(`\\n${selector}[^{]*\\{([^}]*)\\}`))?.[1] ?? "";
const token = (body: string, name: string) => body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const blend = (top: number[], bottom: number[], alpha: number) =>
  `#${top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;

const hueOf = (color: string) =>
  color === "yellow"
    ? css.match(/\.note-mark \{[^}]*--mark-hue:\s*(#[0-9a-f]{6})/)?.[1]
    : css.match(new RegExp(`\\[data-color="${color}"\\] \\{[^}]*--mark-hue:\\s*(#[0-9a-f]{6})`))?.[1];

describe("<Mark> colours", () => {
  it.each(HIGHLIGHT_COLORS)("%s has a hue in globals.css", (color) => {
    expect(hueOf(color)).toMatch(/^#[0-9a-f]{6}$/);
  });

  describe.each(SCHEMES)("in the %s scheme", (scheme) => {
    // :root is the dark palette, which forest and wine inherit the tint strength from.
    const body = block(`\\[data-theme="${scheme}"\\]`);
    const alpha = Number.parseFloat(token(body, "mark-alpha") ?? token(block(":root,"), "mark-alpha") ?? "") / 100;
    const background = token(body, "background") ?? "";
    const foreground = token(body, "foreground") ?? "";

    it.each(HIGHLIGHT_COLORS)("keeps text on %s readable (contrast of at least 4.5)", (color) => {
      expect(alpha).toBeGreaterThan(0);
      const tinted = blend(rgb(hueOf(color) ?? "#000000"), rgb(background), alpha);

      expect(contrast(foreground, tinted)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
