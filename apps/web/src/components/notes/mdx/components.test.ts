import { describe, expect, it } from "vitest";
import { usesMdxComponent } from "./components";

describe("usesMdxComponent", () => {
  it.each(["<Warning>hi</Warning>", "<Info>hi</Info>", "text\n\n<Info>\n\nhi\n\n</Info>", "<Info />", '<Info type="x">'])(
    "detects %j",
    (md) => expect(usesMdxComponent(md)).toBe(true),
  );

  it.each(["plain text", "a < b and {c}", "<Warnings>", "<warning>", "<Information>", "<info>", "Info", "<https://example.com>"])(
    "ignores %j",
    (md) => expect(usesMdxComponent(md)).toBe(false),
  );
});
