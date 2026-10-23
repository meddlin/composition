import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveRoot, archiveUrl, isIncluded, listFiles, treeDigest, validateLock } from "./drawio-lock.mjs";

const good = {
  repository: "jgraph/drawio",
  version: "v32.5.5",
  commit: "a".repeat(40),
  include: ["index.html", "js/shapes-", "images/"],
  treeSha256: "b".repeat(64),
  files: 3,
  size: 10,
};

describe("drawio.lock.json", () => {
  it("the committed lock is valid", () => {
    const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../drawio.lock.json"), "utf-8"));

    expect(validateLock(lock)).toEqual([]);
  });

  it("accepts a well-formed lock", () => {
    expect(validateLock(good)).toEqual([]);
  });

  it.each([
    ["another repository", (l: typeof good) => void (l.repository = "someone/else")],
    ["a tag in place of a version", (l: typeof good) => void (l.version = "latest")],
    ["a short commit", (l: typeof good) => void (l.commit = "17b367b")],
    ["an uppercase digest", (l: typeof good) => void (l.treeSha256 = "B".repeat(64))],
    ["nothing to include", (l: typeof good) => void (l.include = [])],
    ["an include that climbs out", (l: typeof good) => void (l.include = ["../secrets"])],
    ["an absolute include", (l: typeof good) => void (l.include = ["/etc/passwd"])],
    ["no files", (l: typeof good) => void (l.files = 0)],
  ])("rejects %s", (_name, mutate) => {
    const lock = structuredClone(good);
    mutate(lock);

    expect(validateLock(lock).length).toBeGreaterThan(0);
  });

  it("downloads by commit, from the folder GitHub names after it", () => {
    expect(archiveUrl(good)).toBe(`https://codeload.github.com/jgraph/drawio/tar.gz/${"a".repeat(40)}`);
    expect(archiveRoot(good)).toBe(`drawio-${"a".repeat(40)}`);
  });
});

describe("isIncluded", () => {
  it("takes folders and prefixes, and never source maps", () => {
    expect(isIncluded(good, "index.html")).toBe(true);
    expect(isIncluded(good, "images/close.png")).toBe(true);
    expect(isIncluded(good, "js/shapes-14-6-5.min.js")).toBe(true);
    expect(isIncluded(good, "js/shapes-14-6-5.min.js.map")).toBe(false);
    expect(isIncluded(good, "js/integrate.min.js")).toBe(false);
    expect(isIncluded(good, "templates/basic/a.xml")).toBe(false);
  });
});

describe("treeDigest", () => {
  const a = { path: "a.txt", sha256: "1".repeat(64) };
  const b = { path: "b/c.txt", sha256: "2".repeat(64) };

  it("does not depend on the order files were found in", () => {
    expect(treeDigest([a, b])).toBe(treeDigest([b, a]));
  });

  it("changes with a file's contents or its path", () => {
    expect(treeDigest([a, b])).not.toBe(treeDigest([a, { ...b, sha256: "3".repeat(64) }]));
    expect(treeDigest([a, b])).not.toBe(treeDigest([a, { ...b, path: "b/d.txt" }]));
  });

  it("is the same for a folder as listFiles reads it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-lock-"));
    try {
      fs.mkdirSync(path.join(dir, "b"));
      fs.writeFileSync(path.join(dir, "a.txt"), "one");
      fs.writeFileSync(path.join(dir, "b", "c.txt"), "two");

      const files = listFiles(dir);

      expect(files.map((f: { path: string }) => f.path).sort()).toEqual(["a.txt", "b/c.txt"]);
      expect(treeDigest(files)).toBe(treeDigest([...files].reverse()));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
