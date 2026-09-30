import { describe, expect, it } from "vitest";
import { isAllowedOrigin, originOf } from "./origin";

describe("originOf", () => {
  it("gives custom-scheme URLs a real origin, unlike Node's URL.origin", () => {
    expect(new URL("app://composition/x").origin).toBe("null");
    expect(originOf("app://composition/x?y=1#z")).toBe("app://composition");
  });

  it("keeps the standard origin for http(s), with port", () => {
    expect(originOf("http://localhost:3100/settings/")).toBe("http://localhost:3100");
    expect(originOf("https://example.com/a")).toBe("https://example.com");
  });

  it("has no origin for urls without a host, or that don't parse", () => {
    expect(originOf("file:///etc/passwd")).toBeNull();
    expect(originOf("data:text/html,<b>x</b>")).toBeNull();
    expect(originOf("about:blank")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("")).toBeNull();
  });
});

describe("isAllowedOrigin", () => {
  const allowed = ["app://composition", "http://localhost:3100"];

  it("accepts our own pages and rejects lookalikes", () => {
    expect(isAllowedOrigin("app://composition/", allowed)).toBe(true);
    expect(isAllowedOrigin("app://composition/settings/", allowed)).toBe(true);
    expect(isAllowedOrigin("app://composition.evil.example/", allowed)).toBe(false);
    expect(isAllowedOrigin("app://evil/composition", allowed)).toBe(false);
    expect(isAllowedOrigin("app://composition@evil.example/", allowed)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3101/", allowed)).toBe(false);
    expect(isAllowedOrigin("https://localhost:3100/", allowed)).toBe(false);
  });
});
