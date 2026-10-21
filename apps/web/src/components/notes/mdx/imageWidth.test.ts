import { describe, expect, it } from "vitest";
import { imageWidthCss, parseImageWidth } from "./imageWidth";

describe("parseImageWidth", () => {
  it.each([
    ["400", { value: 400, unit: "px" }],
    ["400px", { value: 400, unit: "px" }],
    ["400PX", { value: 400, unit: "px" }],
    [" 400 ", { value: 400, unit: "px" }],
    ["50%", { value: 50, unit: "%" }],
    ["33.5%", { value: 33.5, unit: "%" }],
    [320, { value: 320, unit: "px" }],
  ])("reads %j", (raw, expected) => expect(parseImageWidth(raw)).toEqual(expected));

  it("caps a percentage at the whole width", () => expect(parseImageWidth("150%")).toEqual({ value: 100, unit: "%" }));

  it.each(["", "0", "0%", "-5", "wide", "50 %%", "1e3", "40em", "calc(1px)", undefined, null, NaN, {}])(
    "ignores %j",
    (raw) => expect(parseImageWidth(raw)).toBeNull(),
  );
});

describe("imageWidthCss", () => {
  it("writes the width as CSS", () => {
    expect(imageWidthCss("400")).toBe("400px");
    expect(imageWidthCss("50%")).toBe("50%");
  });

  it("is undefined for a width it can't use, so the image keeps its full size", () => {
    expect(imageWidthCss("big")).toBeUndefined();
  });
});
