import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INK_FLIP_LEVEL } from "./backend";
import { autoPalette, isTruecolor, mix, paletteFor, PALETTES, readableOn, type Palette } from "./theme";

describe("the palettes", () => {
  it.each(["dark", "light", "forest", "cream"] as const)("%s has every color", (name) => {
    const palette = paletteFor(name);
    for (const [key, value] of Object.entries(palette)) {
      if (key === "name") continue;
      expect(value, `${name}.${key}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("falls back to dark for a name it doesn't know, and for auto, which is computed", () => {
    expect(paletteFor("neon")).toBe(PALETTES.dark);
    expect(paletteFor("auto")).toBe(PALETTES.dark);
  });

  it("keeps the selected row readable in every scheme", () => {
    for (const name of ["dark", "light", "forest", "cream"] as const) {
      const p = paletteFor(name);
      expect(contrast(p.selectionText, p.selection), name).toBeGreaterThan(3);
      expect(contrast(p.foreground, p.background), name).toBeGreaterThan(7);
    }
  });

  // The web app owns these colors in globals.css; the terminal must not quietly drift from it.
  describe("against the web app's globals.css", () => {
    const css = fs.readFileSync(path.join(__dirname, "../../web/src/app/globals.css"), "utf-8");
    const web = (theme: string, token: string): string => {
      const block = css.match(new RegExp(`\\n\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`))?.[1] ?? "";
      return (block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? "").toUpperCase();
    };

    it.each(["dark", "light", "forest", "cream"] as const)("%s matches", (name) => {
      const p = paletteFor(name);
      expect(p.background).toBe(web(name, "background"));
      expect(p.foreground).toBe(web(name, "foreground"));
      expect(p.surface).toBe(web(name, "surface"));
      expect(p.primary).toBe(web(name, "brand"));
      expect(p.accent).toBe(web(name, "highlight"));
      expect(p.warning).toBe(web(name, "warning"));
      expect(p.error).toBe(web(name, "error"));
      expect(p.success).toBe(web(name, "success"));
    });
  });
});

describe("mix", () => {
  it("returns each end at 0 and 1 and the midpoint between", () => {
    expect(mix("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(mix("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#102030", "#304050", 0.5)).toBe("#203040");
  });
});

describe("readableOn", () => {
  it("picks white on dark colors and near-black on light ones", () => {
    expect(readableOn("#0178D4")).toBe("#FFFFFF");
    expect(readableOn("#3FB876")).toBe("#0B0B0B");
    expect(readableOn("#F7F7F4")).toBe("#0B0B0B");
  });
});

describe("autoPalette (follow the sun)", () => {
  const dark = PALETTES.dark;
  const light = PALETTES.light;

  it("is the dark palette in the dark and the light palette in the light", () => {
    expect(autoPalette(0)).toMatchObject({ background: dark.background, surface: dark.surface, foreground: dark.foreground });
    expect(autoPalette(1)).toMatchObject({ background: light.background, surface: light.surface, foreground: light.foreground });
  });

  it("fades the surfaces halfway between the two, but never blends the text", () => {
    const midway = autoPalette(0.5);
    expect(midway.background).toBe(mix(dark.background, light.background, 0.5));
    expect(midway.surface).toBe(mix(dark.surface, light.surface, 0.5));
    // Past the flip level the ink is the light scheme's, whole, as it is on the web.
    expect(midway.foreground).toBe(light.foreground);
    expect(autoPalette(INK_FLIP_LEVEL - 0.01).foreground).toBe(dark.foreground);
  });

  it("snaps to whichever scheme is nearer where the terminal can't show a blend", () => {
    expect(autoPalette(0.3, false)).toMatchObject({ background: dark.background });
    expect(autoPalette(0.7, false)).toMatchObject({ background: light.background });
  });
});

describe("isTruecolor", () => {
  it.each([
    [{ COLORTERM: "truecolor" }, true],
    [{ COLORTERM: "24bit" }, true],
    [{ COLORTERM: "" }, false],
    [{}, false],
    [{ COLORTERM: "256" }, false],
  ])("%j is %s", (env, expected) => {
    expect(isTruecolor(env)).toBe(expected);
  });
});

/** WCAG contrast ratio, to check readability in numbers rather than by eye. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type { Palette };
