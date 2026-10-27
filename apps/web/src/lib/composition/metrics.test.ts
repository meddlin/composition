import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeMetrics, countCharacters, countWords } from "./metrics";

describe("metrics", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("counts words and characters", () => {
    expect(countWords("  hello   brave\nnew world ")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countCharacters("a😀b")).toBe(3);
  });

  it("totals notes and sizes on disk", () => {
    const dbPath = path.join(dir, "composition.db");
    fs.writeFileSync(dbPath, "x".repeat(100));
    fs.writeFileSync(`${dbPath}-wal`, "x".repeat(20));
    fs.mkdirSync(path.join(dir, "attachments"));
    fs.writeFileSync(path.join(dir, "attachments", "a.bin"), "x".repeat(7));
    fs.mkdirSync(path.join(dir, "app_data"));
    fs.writeFileSync(path.join(dir, "app_data", "i.png"), "x".repeat(5));
    expect(computeMetrics({ contents: ["one two", "three"], dbPath, appDataDir: dir })).toEqual({
      noteCount: 2,
      words: 3,
      characters: 12,
      averageWords: 2,
      databaseBytes: 120,
      assetsBytes: 7,
      mediaBytes: 5,
    });
  });

  it("is all zeros with nothing on disk", () => {
    expect(computeMetrics({ contents: [], dbPath: path.join(dir, "no.db"), appDataDir: dir })).toEqual({
      noteCount: 0, words: 0, characters: 0, averageWords: 0, databaseBytes: 0, assetsBytes: 0, mediaBytes: 0,
    });
  });
});
