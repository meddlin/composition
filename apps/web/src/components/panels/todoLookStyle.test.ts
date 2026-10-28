import { describe, expect, it } from "vitest";
import { DEFAULT_TODO_LOOK } from "@/lib/composition/todoLook";
import { todoLookStyle } from "./todoLookStyle";

describe("todoLookStyle", () => {
  it("adds only the notes' surface class for the default look", () => {
    expect(todoLookStyle(DEFAULT_TODO_LOOK)).toEqual({ className: "note-surface", style: {} });
  });

  it("draws its own pattern, and not the notes', for any other background", () => {
    const { className, style } = todoLookStyle({ background: "grid", color: null });

    expect(className).toBe("");
    expect(style.backgroundImage).toContain("linear-gradient");
    expect(style.backgroundColor).toBeUndefined();
  });

  it("draws nothing for plain", () => {
    expect(todoLookStyle({ background: "plain", color: null })).toEqual({ className: "", style: {} });
  });

  it("sets the color, with text that reads on it", () => {
    const dark = todoLookStyle({ background: "plain", color: "#14202b" }).style as Record<string, string>;
    const light = todoLookStyle({ background: "plain", color: "#fbf3d9" }).style as Record<string, string>;

    expect(dark.backgroundColor).toBe("#14202b");
    expect(dark.color).toBe("#f2f2f2");
    expect(dark["--foreground"]).toBe("#f2f2f2");
    expect(light.color).toBe("#1f2328");
  });
});
