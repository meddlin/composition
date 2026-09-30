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
