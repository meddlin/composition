import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMeiliBinary } from "./search";

const base = {
  env: {} as NodeJS.ProcessEnv,
  packaged: false,
  resourcesPath: "/Applications/Composition.app/Contents/Resources",
  platform: "darwin" as NodeJS.Platform,
};

describe("resolveMeiliBinary", () => {
  it("uses COMPOSITION_MEILI_BIN when set and executable, even in a packaged app", () => {
    const result = resolveMeiliBinary({
      ...base,
      packaged: true,
      env: { COMPOSITION_MEILI_BIN: "/custom/meilisearch" },
      isExecutable: (f) => f === "/custom/meilisearch",
    });
    expect(result).toBe("/custom/meilisearch");
  });

  it("does not fall back to another binary when the override isn't executable", () => {
    const result = resolveMeiliBinary({
      ...base,
      env: { COMPOSITION_MEILI_BIN: "/missing", PATH: "/usr/bin" },
      isExecutable: () => false,
    });
    expect(result).toBeNull();
  });

  it("uses the bundled copy in a packaged app and ignores PATH", () => {
    const bundled = path.join(base.resourcesPath, "meilisearch", "meilisearch");
    const result = resolveMeiliBinary({
      ...base,
      packaged: true,
      env: { PATH: "/usr/local/bin" },
      isExecutable: (f) => f === bundled || f === "/usr/local/bin/meilisearch",
    });
    expect(result).toBe(bundled);
  });

  it("reports a missing bundled binary instead of searching PATH", () => {
    const result = resolveMeiliBinary({
      ...base,
      packaged: true,
      env: { PATH: "/usr/local/bin" },
      isExecutable: (f) => f === "/usr/local/bin/meilisearch",
    });
    expect(result).toBeNull();
  });

  it("searches PATH in order during development", () => {
    const result = resolveMeiliBinary({
      ...base,
      env: { PATH: ["", "/opt/homebrew/bin", "/usr/local/bin"].join(path.delimiter) },
      isExecutable: (f) => f === "/opt/homebrew/bin/meilisearch" || f === "/usr/local/bin/meilisearch",
    });
    expect(result).toBe("/opt/homebrew/bin/meilisearch");
  });

  it("looks for meilisearch.exe on Windows", () => {
    const result = resolveMeiliBinary({
      ...base,
      platform: "win32",
      env: { PATH: "C:\\tools" },
      isExecutable: (f) => f.endsWith("meilisearch.exe"),
    });
    expect(result?.endsWith("meilisearch.exe")).toBe(true);
  });
});
