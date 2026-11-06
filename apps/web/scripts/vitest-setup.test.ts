import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

// The guard in vitest.setup.ts must hold before a test file imports anything, so these import the data layer
// the way a component test would: with no HOME stub of their own.

it("points the home directory at a temp dir, not the user's real one", () => {
  const home = os.homedir();
  // userInfo() reads the account database, not the environment, so it is the real home whatever HOME says.
  expect(home).not.toBe(os.userInfo().homedir);
  expect(path.dirname(home)).toBe(os.tmpdir());
  expect(process.env.HOME).toBe(home);
  expect(fs.readdirSync(home)).toEqual([]);
});

it("resolves every default data location inside that home", async () => {
  const { DEFAULT_APP_DATA_DIR } = await import("@/lib/composition/paths");
  const { loadWebSettings, resolvedDbPath, settingsPath, sharedLocationPath } = await import(
    "@/lib/composition/webSettings"
  );
  const home = os.homedir();
  expect(DEFAULT_APP_DATA_DIR.startsWith(home + path.sep)).toBe(true);
  expect(settingsPath().startsWith(home + path.sep)).toBe(true);
  expect(sharedLocationPath()).toBeUndefined();
  expect(resolvedDbPath(loadWebSettings()).startsWith(home + path.sep)).toBe(true);
});

it("opens the default database inside that home", async () => {
  const { closeDb, getDb } = await import("@/lib/composition/db");
  try {
    getDb();
  } finally {
    closeDb();
  }
  expect(fs.existsSync(path.join(os.homedir(), ".composition", "composition.db"))).toBe(true);
});
