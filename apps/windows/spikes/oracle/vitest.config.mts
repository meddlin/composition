// Runs the spike's oracle files against the desktop's REAL TypeScript data layer (apps/web/src/lib/composition).
// The root is apps/web so its node_modules (better-sqlite3, vitest) resolve; the include reaches back into this folder.
// Nothing under apps/web is edited or added to. Run through ../run-core-spike.sh.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  root: path.resolve(here, "../../../web"),
  test: {
    include: ["../windows/spikes/oracle/*.oracle.ts"],
    globals: true,
    environment: "node",
    testTimeout: 120_000,
    fileParallelism: false,
  },
};
