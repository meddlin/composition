import { describe, expect, it } from "vitest";
import { APP_ORIGIN } from "./appScheme";
import { DRAWIO_ORIGIN, drawioContentSecurityPolicy } from "./drawioHost";

describe("the draw.io editor's origin", () => {
  it("is not the app's, so the editor and the notes cannot reach each other", () => {
    expect(DRAWIO_ORIGIN).toBe("app://drawio");
    expect(DRAWIO_ORIGIN).not.toBe(APP_ORIGIN);
  });
});

describe("drawioContentSecurityPolicy", () => {
  const directives = (policy: string) => new Map(policy.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)] as const));

  it("lets the editor run only its own scripts, never inline or eval", () => {
    const csp = directives(drawioContentSecurityPolicy([APP_ORIGIN]));

    expect(csp.get("script-src")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'none'"]);
  });

  it("gives it no network: it can fetch only its own files", () => {
    const csp = directives(drawioContentSecurityPolicy([APP_ORIGIN]));

    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(csp.get("form-action")).toEqual(["'none'"]);
  });

  it("lets only the given origins frame it", () => {
    expect(directives(drawioContentSecurityPolicy([APP_ORIGIN])).get("frame-ancestors")).toEqual([APP_ORIGIN]);
    expect(directives(drawioContentSecurityPolicy([APP_ORIGIN, "http://localhost:3100"])).get("frame-ancestors")).toEqual([
      APP_ORIGIN,
      "http://localhost:3100",
    ]);
  });
});
