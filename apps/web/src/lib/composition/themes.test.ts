import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
