import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INK_FLIP_LEVEL } from "./sunSchedule";
import { DEFAULT_SUN_PAIR, SUN_PAIR_CHOICES, inkFlipLevelOf, isSunPairName } from "./sunPairs";
import { DEFAULT_THEME, THEME_CHOICES, isThemeName } from "./themes";

describe("isThemeName", () => {
  it.each(THEME_CHOICES.map((c) => c.name))("accepts %s", (name) => {
    expect(isThemeName(name)).toBe(true);
  });

  it.each([["neon"], [""], [null], [undefined], [42], [{}]])("rejects %j", (value) => {
    expect(isThemeName(value)).toBe(false);
  });
});

describe("DEFAULT_THEME", () => {
  it("is one of the available choices", () => {
    expect(isThemeName(DEFAULT_THEME)).toBe(true);
  });
});

describe("the auto scheme's surface blend in globals.css", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8");

  function paletteValue(theme: "dark" | "light", token: string): string {
    const block = css.match(new RegExp(`\\n\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`))?.[1] ?? "";
    return block.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`))?.[1] ?? "";
  }

  it.each(["background", "surface", "panel"])("fades --%s between the dark and light palettes", (token) => {
    const blend = css.match(new RegExp(`--${token}: color-mix\\(in srgb, (#[0-9a-f]{6}) var\\(--auto-light, 0%\\), (#[0-9a-f]{6})\\)`));

    expect(blend?.[1]).toBe(paletteValue("light", token));
    expect(blend?.[2]).toBe(paletteValue("dark", token));
    expect(blend?.[1]).toMatch(/^#/);
  });

  it("shares the dark and light palettes with the matching tone", () => {
    expect(css).toMatch(/\[data-theme="auto"\]\[data-tone="dark"\]\s*\{/);
    expect(css).toMatch(/\[data-theme="auto"\]\[data-tone="light"\]\s*\{/);
  });
});

describe("the Follow the sun pairs in globals.css", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations of the rule whose selector list has `selector`, by property name (a custom property without its `--`). */
  function tokens(selector: string): Record<string, string> {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors.split(",").some((part) => part.trim() === selector)) continue;
      return Object.fromEntries([...body.matchAll(/(?:--)?([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    }
    return {};
  }

  const palette = (pair: (typeof SUN_PAIR_CHOICES)[number], tone: "light" | "dark") =>
    pair.name === "classic"
      ? tokens(`[data-theme="${tone}"]`)
      : tokens(`[data-theme="auto"][data-sun-pair="${pair.name}"][data-tone="${tone}"]`);

  // WCAG contrast, from 8-bit sRGB hex.
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
  };
  /** `share` of `a` over `b`, mixed the way `color-mix(in srgb)` does. */
  const mix = (a: string, b: string, share: number) =>
    "#" +
    channels(a)
      .map((value, i) => Math.round(value * share + channels(b)[i] * (1 - share)).toString(16).padStart(2, "0"))
      .join("");

  const pairs = SUN_PAIR_CHOICES.map((pair) => [pair.name, pair] as const);

  it.each(pairs)("%s has a complete day palette and night palette", (_name, pair) => {
    // The dark palettes may leave --mark-alpha to the root's; a light one sets its own, as the tint is paler there.
    const required = Object.keys(tokens(`[data-theme="dark"]`)).filter((token) => token !== "mark-alpha");
    for (const tone of ["light", "dark"] as const) {
      const colors = palette(pair, tone);
      expect(Object.keys(colors), `${pair.name} ${tone}`).toEqual(expect.arrayContaining(required));
      expect(colors["color-scheme"], `${pair.name} ${tone}`).toBe(tone);
    }
    expect(palette(pair, "light")["mark-alpha"]).toBeDefined();
  });

  it.each(pairs)("%s: the text is readable on all three surfaces, and links and code on their own", (_name, pair) => {
    for (const tone of ["light", "dark"] as const) {
      const colors = palette(pair, tone);
      for (const surface of ["background", "surface", "panel"]) {
        expect(contrast(colors.foreground, colors[surface]), `${pair.name} ${tone} text on ${surface}`).toBeGreaterThanOrEqual(7);
      }
      expect(contrast(colors.link, colors.background), `${pair.name} ${tone} link`).toBeGreaterThanOrEqual(4.5);
      for (const [token, value] of Object.entries(colors).filter(([token]) => token.startsWith("syntax-"))) {
        expect(contrast(value, colors.surface), `${pair.name} ${tone} ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(pairs.filter(([name]) => name !== "classic"))("%s: the surfaces blend between its two palettes", (_name, pair) => {
    const blend = tokens(`[data-theme="auto"][data-sun-pair="${pair.name}"][data-tone]`);
    const day = palette(pair, "light");
    const night = palette(pair, "dark");

    for (const token of ["background", "surface", "panel"]) {
      expect(blend[token], `${pair.name} ${token}`).toBe(`color-mix(in srgb, ${day[token]} var(--auto-light, 0%), ${night[token]})`);
    }
  });

  it.each(pairs)("%s: the ink flips where the day and night inks are equally readable", (_name, pair) => {
    const day = palette(pair, "light");
    const night = palette(pair, "dark");
    let crossover = 1;
    for (let level = 0; level <= 1; level += 0.005) {
      const background = mix(day.background, night.background, level);
      if (contrast(day.foreground, background) >= contrast(night.foreground, background)) {
        crossover = level;
        break;
      }
    }

    expect(Math.abs(inkFlipLevelOf(pair.name) - crossover)).toBeLessThanOrEqual(0.02);
    // The least readable moment of the ramp: text just before the flip, and just after it.
    const flip = inkFlipLevelOf(pair.name);
    const before = mix(day.background, night.background, flip - 0.005);
    const after = mix(day.background, night.background, flip);
    expect(Math.min(contrast(night.foreground, before), contrast(day.foreground, after))).toBeGreaterThanOrEqual(3);
  });
});

describe("the Follow the sun pair choices", () => {
  it("starts from the classic pair", () => {
    expect(DEFAULT_SUN_PAIR).toBe("classic");
    expect(isSunPairName(DEFAULT_SUN_PAIR)).toBe(true);
  });

  it.each(SUN_PAIR_CHOICES.map((choice) => choice.name))("accepts %s", (name) => {
    expect(isSunPairName(name)).toBe(true);
  });

  it.each([["neon"], [""], [null], [undefined], [42], [{}]])("rejects %j", (value) => {
    expect(isSunPairName(value)).toBe(false);
  });

  it("flips the classic pair's ink at the level the terminal app uses, and any unknown pair's too", () => {
    expect(inkFlipLevelOf("classic")).toBe(INK_FLIP_LEVEL);
    expect(inkFlipLevelOf("nonsense")).toBe(INK_FLIP_LEVEL);
    expect(inkFlipLevelOf(undefined)).toBe(INK_FLIP_LEVEL);
  });
});
