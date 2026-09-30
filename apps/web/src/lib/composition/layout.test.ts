import { describe, expect, it } from "vitest";
import {
  clampEditorRatio,
  clampSidebarWidth,
  DEFAULT_EDITOR_RATIO,
  DEFAULT_SIDEBAR_WIDTH,
  dragRatio,
  MAX_EDITOR_RATIO,
  MAX_SIDEBAR_WIDTH,
  MIN_EDITOR_RATIO,
  MIN_SIDEBAR_WIDTH,
} from "./layout";

describe("clampSidebarWidth", () => {
  it("keeps a width inside the bounds", () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("clamps to the min and max", () => {
    expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it.each([NaN, Infinity, "300", null, undefined])("falls back to the default for %s", (value) => {
    expect(clampSidebarWidth(value)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("clampEditorRatio", () => {
  it("keeps a ratio inside the bounds", () => {
    expect(clampEditorRatio(0.65)).toBe(0.65);
  });

  it("clamps to the min and max", () => {
    expect(clampEditorRatio(0)).toBe(MIN_EDITOR_RATIO);
    expect(clampEditorRatio(1)).toBe(MAX_EDITOR_RATIO);
  });

  it.each([NaN, -Infinity, "0.5", null, undefined])("falls back to the default for %s", (value) => {
    expect(clampEditorRatio(value)).toBe(DEFAULT_EDITOR_RATIO);
  });
});

describe("dragRatio", () => {
  it("moves the ratio by the drag distance as a share of the container", () => {
    expect(dragRatio(0.5, 100, 1000)).toBeCloseTo(0.6);
    expect(dragRatio(0.5, -100, 1000)).toBeCloseTo(0.4);
  });

  it("clamps when dragged past the limits", () => {
    expect(dragRatio(0.5, 5000, 1000)).toBe(MAX_EDITOR_RATIO);
    expect(dragRatio(0.5, -5000, 1000)).toBe(MIN_EDITOR_RATIO);
  });

  it("leaves the ratio unchanged when the container has no width", () => {
    expect(dragRatio(0.4, 100, 0)).toBe(0.4);
    expect(dragRatio(0.4, 100, NaN)).toBe(0.4);
  });
});
