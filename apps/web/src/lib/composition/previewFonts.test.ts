import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_FONT,
  isPreviewFontName,
  PREVIEW_FONT_CHOICES,
  previewFontStack,
} from "./previewFonts";

describe("preview fonts", () => {
  it("offers the default among the choices", () => {
    expect(PREVIEW_FONT_CHOICES.map((choice) => choice.name)).toContain(DEFAULT_PREVIEW_FONT);
  });

  it("has a unique name and a stack for every choice", () => {
    const names = PREVIEW_FONT_CHOICES.map((choice) => choice.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(previewFontStack(name)).toMatch(/\bvar\(--font-/);
  });

  it("recognises only the listed names", () => {
    expect(isPreviewFontName("lora")).toBe(true);
    expect(isPreviewFontName("Comic Sans MS")).toBe(false);
    expect(isPreviewFontName(undefined)).toBe(false);
  });
});
