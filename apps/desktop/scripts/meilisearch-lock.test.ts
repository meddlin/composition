import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadUrl, validateLock } from "./meilisearch-lock.mjs";

const good = {
  repository: "meilisearch/meilisearch",
  version: "v1.53.1",
  assets: {
    "mac-arm64": { name: "meilisearch-macos-apple-silicon", sha256: "a".repeat(64), size: 10 },
  },
};

describe("meilisearch.lock.json", () => {
  it("the committed lock is valid, and pins only community builds", () => {
    const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../meilisearch.lock.json"), "utf-8"));

    expect(validateLock(lock)).toEqual([]);
    for (const asset of Object.values<{ name: string }>(lock.assets)) {
      expect(asset.name).not.toMatch(/enterprise/i);
    }
  });

  it("accepts a well-formed lock", () => {
    expect(validateLock(good)).toEqual([]);
  });

  it("refuses an Enterprise Edition asset, which isn't allowed in production", () => {
    const lock = structuredClone(good);
    lock.assets["mac-arm64"].name = "meilisearch-enterprise-macos-apple-silicon";

    expect(validateLock(lock).join("\n")).toMatch(/Enterprise Edition/);
  });

  it.each([
    ["a missing checksum", (l: typeof good) => void (l.assets["mac-arm64"].sha256 = "")],
    ["an uppercase checksum", (l: typeof good) => void (l.assets["mac-arm64"].sha256 = "A".repeat(64))],
    ["a bad version", (l: typeof good) => void (l.version = "latest")],
    ["another repository", (l: typeof good) => void (l.repository = "someone/else")],
    ["an unknown platform", (l: typeof good) => void Object.assign(l.assets, { "win-x64": l.assets["mac-arm64"] })],
    ["no assets", (l: typeof good) => void (l.assets = {} as typeof good.assets)],
  ])("rejects %s", (_name, mutate) => {
    const lock = structuredClone(good);
    mutate(lock);

    expect(validateLock(lock).length).toBeGreaterThan(0);
  });

  it("builds the official GitHub release URL", () => {
    expect(downloadUrl(good, "mac-arm64")).toBe(
      "https://github.com/meilisearch/meilisearch/releases/download/v1.53.1/meilisearch-macos-apple-silicon",
    );
  });
});
