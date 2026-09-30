import path from "node:path";
import { describe, expect, it } from "vitest";
import { mimeTypeFor, resolveRendererFile } from "./rendererFiles";

const root = path.resolve("/app/dist/renderer");
const files = new Set(
  [
    "index.html",
    "404.html",
    "settings/index.html",
    "_next/static/chunks/app.js",
    "_next/static/media/font.woff2",
    "__next.settings.txt",
  ].map((f) => path.join(root, f)),
);
const isFile = (p: string) => files.has(p);
const resolve = (p: string) => resolveRendererFile(root, p, isFile);

describe("resolveRendererFile", () => {
  it("serves the home page for the root and for an empty path", () => {
    expect(resolve("/")).toBe(path.join(root, "index.html"));
    expect(resolve("")).toBe(path.join(root, "index.html"));
  });

  it("finds an exported route with or without the trailing slash", () => {
    expect(resolve("/settings/")).toBe(path.join(root, "settings", "index.html"));
    expect(resolve("/settings")).toBe(path.join(root, "settings", "index.html"));
  });

  it("serves static assets as they are", () => {
    expect(resolve("/_next/static/chunks/app.js")).toBe(path.join(root, "_next/static/chunks/app.js"));
    expect(resolve("/__next.settings.txt")).toBe(path.join(root, "__next.settings.txt"));
  });

  it("returns null for files that don't exist", () => {
    expect(resolve("/docs/")).toBeNull();
    expect(resolve("/nope.js")).toBeNull();
  });

  it.each([
    "/../secret.txt",
    "/_next/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2fsecret.txt",
    "/settings/..%2f..%2fsecret",
    "/a\\..\\b",
    "/index.html%00.png",
    "/%E0%A4%A",
  ])("never resolves outside the renderer directory: %s", (attempt) => {
    expect(resolve(attempt)).toBeNull();
  });

  it("does not treat a sibling directory with the same prefix as inside the root", () => {
    const sneaky = resolveRendererFile(root, "/../renderer-evil/index.html", () => true);
    expect(sneaky).toBeNull();
  });
});

describe("mimeTypeFor", () => {
  it("knows the types a Next export contains, and defaults to a safe binary type", () => {
    expect(mimeTypeFor("a/index.html")).toMatch(/^text\/html/);
    expect(mimeTypeFor("a/chunk.js")).toMatch(/^text\/javascript/);
    expect(mimeTypeFor("a/style.css")).toMatch(/^text\/css/);
    expect(mimeTypeFor("a/font.woff2")).toBe("font/woff2");
    expect(mimeTypeFor("a/__next.settings.txt")).toMatch(/^text\/plain/);
    expect(mimeTypeFor("a/unknown.xyz")).toBe("application/octet-stream");
  });
});
