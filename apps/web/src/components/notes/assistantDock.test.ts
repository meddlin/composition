import { describe, expect, it } from "vitest";
import { dockLayout, DOCK_DEFAULT_WIDTH, dragDockWidth } from "./assistantDock";

describe("dockLayout", () => {
  it.each([
    // pane width, wanted dock width, expected
    [1200, 360, { mode: "beside", width: 360 }],
    [1200, 900, { mode: "beside", width: 720 }], // never more than 60% of the pane
    [1200, 100, { mode: "beside", width: 280 }], // never narrower than the dock needs
    [700, 360, { mode: "beside", width: 360 }],
    [700, 600, { mode: "beside", width: 380 }], // the note keeps 320 px
    [600, 360, { mode: "beside", width: 280 }], // 320 for the note, 280 left for the dock
    [599, 360, { mode: "over" }], // not enough for both: the dock covers the note
    [400, 360, { mode: "over" }],
    [0, 360, { mode: "beside", width: 360 }], // not measured yet: assume there is room
  ] as const)("a pane %ipx wide with a dock wanted at %ipx: %j", (pane, wanted, expected) => {
    expect(dockLayout(pane, wanted)).toEqual(expected);
  });

  it("has a default width the panel opens at", () => {
    expect(DOCK_DEFAULT_WIDTH).toBe(360);
  });
});

describe("dragDockWidth", () => {
  it("makes the dock wider as the divider moves left, and narrower as it moves right", () => {
    expect(dragDockWidth(360, -50)).toBe(410);
    expect(dragDockWidth(360, 50)).toBe(310);
  });
});
