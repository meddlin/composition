import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * Keeps the suite away from the developer's real data (vitest `setupFiles`: runs before each test file
 * imports anything).
 *
 * The data layer reads `os.homedir()` when it is imported, and opening the database runs its schema
 * migrations, so a test that reaches `getDb()` without stubbing HOME would migrate the real
 * `~/.composition/composition.db` (that is how the `uuid` column landed in one by accident). Every test file
 * gets a fresh empty home instead. Tests that stub HOME themselves still can: `vi.unstubAllEnvs()` puts this
 * one back.
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-web-test-home-"));
process.env.HOME = home;
// os.homedir() reads USERPROFILE on Windows.
process.env.USERPROFILE = home;
// Hosts of this code (the desktop app) export these to move the settings; unset, both fall back to files under
// HOME, which is the temp dir. Pointing them at a fixed file would override the HOME-derived defaults that the
// settings tests rely on.
delete process.env.COMPOSITION_SETTINGS_PATH;
delete process.env.COMPOSITION_SHARED_LOCATION_PATH;

afterAll(() => {
  // A test that opened the database through getDb() leaves the connection cached for the process.
  try {
    (globalThis as { __compositionDb?: { connection: { close(): void } } }).__compositionDb?.connection.close();
  } catch {
    // already closed
  }
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
});
