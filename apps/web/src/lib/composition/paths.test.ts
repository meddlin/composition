import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_APP_DATA_DIR, defaultDatabasePath, expandHome } from "./paths";

describe("expandHome", () => {
  const home = os.homedir();

  it("expands a bare tilde", () => {
    expect(expandHome("~")).toBe(home);
  });

  it("expands ~/ and ~\\ prefixes", () => {
    expect(expandHome("~/notes/x.db")).toBe(path.join(home, "notes", "x.db"));
    expect(expandHome("~\\notes")).toBe(path.join(home, "notes"));
  });

  it("leaves other paths untouched", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("relative/path")).toBe("relative/path");
    expect(expandHome("~user/path")).toBe("~user/path");
  });
});

describe("defaultDatabasePath", () => {
  it("places composition.db inside the app data dir", () => {
    expect(defaultDatabasePath("/data")).toBe(path.join("/data", "composition.db"));
  });
});

describe("DEFAULT_APP_DATA_DIR", () => {
  it("lives under the home directory", () => {
    expect(DEFAULT_APP_DATA_DIR).toBe(path.join(os.homedir(), ".composition"));
  });
});
