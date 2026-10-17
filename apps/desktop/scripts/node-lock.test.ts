import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadUrl, validateLock } from "./node-lock.mjs";

const good = {
  version: "v26.12.0",
  assets: {
    "mac-arm64": { name: "node-v26.12.0-darwin-arm64.tar.gz", sha256: "a".repeat(64), size: 10 },
  },
};

describe("node.lock.json", () => {
  it("the committed lock is valid, covers both Mac architectures, and satisfies the CLI's engines", () => {
    const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../node.lock.json"), "utf-8"));
    const cli = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../cli/package.json"), "utf-8"));

    expect(validateLock(lock)).toEqual([]);
    expect(Object.keys(lock.assets).sort()).toEqual(["mac-arm64", "mac-x64"]);
    // engines.node is ">=26.10": the bundled Node must be at least that.
    const [major, minor] = cli.engines.node.replace(/^>=/, "").split(".").map(Number);
    const [lockMajor, lockMinor] = lock.version.slice(1).split(".").map(Number);
    expect(lockMajor > major || (lockMajor === major && lockMinor >= minor)).toBe(true);
  });

  it("accepts a well-formed lock", () => {
    expect(validateLock(good)).toEqual([]);
  });

  it("refuses a Node older than the one that has node:ffi switched on", () => {
    const lock = { ...structuredClone(good), version: "v26.9.0" };
    lock.assets["mac-arm64"].name = "node-v26.9.0-darwin-arm64.tar.gz";

    expect(validateLock(lock).join("\n")).toMatch(/older than the 26\.10\.0/);
  });

  it.each([
    ["a missing checksum", (l: typeof good) => void (l.assets["mac-arm64"].sha256 = "")],
    ["an uppercase checksum", (l: typeof good) => void (l.assets["mac-arm64"].sha256 = "A".repeat(64))],
    ["a bad version", (l: typeof good) => void (l.version = "latest")],
    ["an asset for another version", (l: typeof good) => void (l.assets["mac-arm64"].name = "node-v26.11.0-darwin-arm64.tar.gz")],
    ["an asset for another architecture", (l: typeof good) => void (l.assets["mac-arm64"].name = "node-v26.12.0-darwin-x64.tar.gz")],
    ["an unknown platform", (l: typeof good) => void Object.assign(l.assets, { "win-x64": l.assets["mac-arm64"] })],
    ["no assets", (l: typeof good) => void (l.assets = {} as typeof good.assets)],
  ])("rejects %s", (_name, mutate) => {
    const lock = structuredClone(good);
    mutate(lock);

    expect(validateLock(lock).length).toBeGreaterThan(0);
  });

  it("builds the official nodejs.org URL", () => {
    expect(downloadUrl(good, "mac-arm64")).toBe("https://nodejs.org/dist/v26.12.0/node-v26.12.0-darwin-arm64.tar.gz");
  });
});
