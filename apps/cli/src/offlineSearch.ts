import { vi } from "vitest";
import { searchIndex } from "./backend";

/** Nothing listens here, and it is on fetch's list of blocked ports, so a request never leaves the process. */
export const UNREACHABLE_MEILI_URL = "http://127.0.0.1:1";

/**
 * Keeps a test away from any real Meilisearch. Call it before the test, and undo it with
 * `vi.unstubAllEnvs()` afterwards.
 *
 * `disableSearch` alone isn't enough. It only makes searches fail with a message: saving or
 * deleting a note still tries to index it, and with no server configured the shared search
 * layer then falls back to $MEILI_URL, then to 127.0.0.1:7700 (where `pnpm meili` listens),
 * using the key in $MEILI_MASTER_KEY or in ~/.composition/meili_master_key. Pointing both
 * variables at nothing makes those attempts fail at once, and keeps a test's dummy notes out
 * of a developer's own index.
 *
 * A test that starts its own Meilisearch (runtime.test.ts) is unaffected: a configured server
 * takes precedence over the environment.
 */
export function keepSearchOffline(): void {
  vi.stubEnv("MEILI_URL", UNREACHABLE_MEILI_URL);
  vi.stubEnv("MEILI_MASTER_KEY", "not-a-real-key");
  // After the stubs: this also drops any client that was built from the old environment.
  searchIndex.disableSearch("Search is off in tests.");
}
