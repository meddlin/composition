import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUpdatePrefsStore } from "./updatePrefs";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "update-prefs-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("createUpdatePrefsStore", () => {
  it("checks for updates when there is no file yet", () => {
    expect(createUpdatePrefsStore(path.join(dir, "updates.json")).load()).toEqual({
      autoCheck: true,
      allowPrerelease: false,
    });
  });

  it("remembers the choice, creating the folder if needed", () => {
    const file = path.join(dir, "nested", "updates.json");
    createUpdatePrefsStore(file).save({ autoCheck: false, allowPrerelease: true });
    expect(createUpdatePrefsStore(file).load()).toEqual({ autoCheck: false, allowPrerelease: true });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["updates.json"]);
  });

  it.each([["not json"], ["null"], ["[]"], ['{"autoCheck":"no"}'], ["{}"]])("falls back to the defaults for %s", (contents) => {
    const file = path.join(dir, "updates.json");
    fs.writeFileSync(file, contents);
    expect(createUpdatePrefsStore(file).load()).toEqual({ autoCheck: true, allowPrerelease: false });
  });

  it("reads a file written before pre-releases existed as pre-releases off", () => {
    const file = path.join(dir, "updates.json");
    fs.writeFileSync(file, '{"autoCheck":false}');
    expect(createUpdatePrefsStore(file).load()).toEqual({ autoCheck: false, allowPrerelease: false });
  });
});
