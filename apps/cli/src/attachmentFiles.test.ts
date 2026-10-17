import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePaths, saveCopy } from "./attachmentFiles";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-attach-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("parsePaths", () => {
  const cwd = "/work";

  it("splits on spaces, like a shell", () => {
    expect(parsePaths("/a/one.pdf /b/two.txt", cwd)).toEqual(["/a/one.pdf", "/b/two.txt"]);
  });

  it("reads quotes and backslash escapes, which is what dragging a file into a terminal pastes", () => {
    expect(parsePaths("'/a/my file.pdf' \"/b/other file.txt\" /c/third\\ one.md", cwd)).toEqual([
      "/a/my file.pdf",
      "/b/other file.txt",
      "/c/third one.md",
    ]);
  });

  it("expands ~ and resolves a relative path against the working directory", () => {
    const [home, relative] = parsePaths("~/notes.txt ./sub/report.pdf", cwd);
    expect(home).toBe(path.join(os.homedir(), "notes.txt"));
    expect(relative).toBe("/work/sub/report.pdf");
  });

  it("takes the whole text as one path when that file exists, even with spaces in it", () => {
    const file = path.join(dir, "my report final.pdf");
    fs.writeFileSync(file, "x");
    expect(parsePaths(file, cwd)).toEqual([file]);
  });

  it("is empty for blank input", () => {
    expect(parsePaths("   ", cwd)).toEqual([]);
  });
});

describe("saveCopy", () => {
  const source = () => {
    const file = path.join(dir, "stored-abc-report.pdf");
    fs.writeFileSync(file, "the bytes");
    return file;
  };

  it("writes the copy to the path given", () => {
    const target = path.join(dir, "copy.pdf");
    expect(saveCopy(source(), "report.pdf", target, dir)).toEqual({ path: target });
    expect(fs.readFileSync(target, "utf8")).toBe("the bytes");
  });

  it("puts it in a folder under the file's own name when given a folder", () => {
    const folder = path.join(dir, "out");
    fs.mkdirSync(folder);
    expect(saveCopy(source(), "report.pdf", folder, dir)).toEqual({ path: path.join(folder, "report.pdf") });
  });

  it("never overwrites a file that is already there", () => {
    const target = path.join(dir, "taken.pdf");
    fs.writeFileSync(target, "mine");
    expect(saveCopy(source(), "report.pdf", target, dir)).toEqual({ error: expect.stringContaining("already exists") });
    expect(fs.readFileSync(target, "utf8")).toBe("mine");
  });

  it("says why when the folder is missing", () => {
    const result = saveCopy(source(), "report.pdf", path.join(dir, "nope", "copy.pdf"), dir);
    expect(result).toEqual({ error: expect.stringContaining("Could not save a copy") });
  });
});
