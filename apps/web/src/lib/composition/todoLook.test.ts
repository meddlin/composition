import { describe, expect, it } from "vitest";
import { DEFAULT_TODO_LOOK, isHexColor, isTodoLook, needsLightText, readTodoLook, TODO_COLOR_PRESETS } from "./todoLook";

describe("readTodoLook", () => {
  it("reads a saved look", () => {
    expect(readTodoLook({ background: "dots", color: "#FBF3D9" })).toEqual({ background: "dots", color: "#fbf3d9" });
  });

  it("falls back to the default for what is missing or not valid", () => {
    expect(readTodoLook(undefined)).toEqual(DEFAULT_TODO_LOOK);
    expect(readTodoLook("dots")).toEqual(DEFAULT_TODO_LOOK);
    expect(readTodoLook({ background: "paisley", color: "red" })).toEqual(DEFAULT_TODO_LOOK);
    expect(readTodoLook({ background: "grid", color: "#fff" })).toEqual({ background: "grid", color: null });
  });
});

describe("isHexColor", () => {
  it("takes only #rrggbb", () => {
    expect(isHexColor("#a1B2c3")).toBe(true);
    for (const bad of ["#abc", "a1b2c3", "#a1b2c3d4", "url(x)", "#12345g", 5, null]) expect(isHexColor(bad)).toBe(false);
  });
});

describe("needsLightText", () => {
  it("wants light text on dark colors and dark text on light ones", () => {
    expect(needsLightText("#000000")).toBe(true);
    expect(needsLightText("#14202b")).toBe(true);
    expect(needsLightText("#ffffff")).toBe(false);
    expect(needsLightText("#fbf3d9")).toBe(false);
  });

  it("gives every preset text that can be read on it", () => {
    for (const { color } of TODO_COLOR_PRESETS) expect(typeof needsLightText(color)).toBe("boolean");
  });
});

describe("isTodoLook", () => {
  it("takes exactly a known background and a #rrggbb color or none", () => {
    expect(isTodoLook({ background: "grid", color: null })).toBe(true);
    expect(isTodoLook({ background: "notes", color: "#14202b" })).toBe(true);
    for (const bad of [null, "grid", [], {}, { background: "grid" }, { background: "paisley", color: null }, { background: "grid", color: "red" }]) {
      expect(isTodoLook(bad)).toBe(false);
    }
  });
});
