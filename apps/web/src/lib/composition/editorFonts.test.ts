import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_FONT, EDITOR_FONT_CHOICES, editorFontStack, isEditorFontName } from "./editorFonts";

describe("editor fonts", () => {
  it("offers the default among the choices, and it is monospace", () => {
    const fallback = EDITOR_FONT_CHOICES.find((choice) => choice.name === DEFAULT_EDITOR_FONT);
    expect(fallback?.kind).toBe("monospace");
  });

  it("has a unique name and a stack for every choice", () => {
    const names = EDITOR_FONT_CHOICES.map((choice) => choice.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(editorFontStack(name)).toMatch(/\bvar\(--font-/);
  });

  it("lists the monospace fonts before the proportional ones", () => {
    const kinds = EDITOR_FONT_CHOICES.map((choice) => choice.kind);
    expect(kinds.indexOf("proportional")).toBeGreaterThan(kinds.lastIndexOf("monospace"));
  });

  it("recognises only the listed names", () => {
    expect(isEditorFontName("jetbrains-mono")).toBe(true);
    expect(isEditorFontName("Comic Sans MS")).toBe(false);
    expect(isEditorFontName(undefined)).toBe(false);
  });
});
