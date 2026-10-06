// Development loop: build, then run the app.
//
//   pnpm dev
//   COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm dev
//
// By default this uses your real data in ~/.composition. With COMPOSITION_DEV_HOME
// set, HOME is pointed at that folder, so notes, settings and the search index all
// live in a scratch home and experiments never touch real notes.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const built = spawnSync(process.execPath, [path.join(cliDir, "scripts", "build.mjs")], {
  stdio: "inherit",
});
if (built.status !== 0) process.exit(built.status ?? 1);

const env = { ...process.env };
if (env.COMPOSITION_DEV_HOME) {
  const home = path.resolve(env.COMPOSITION_DEV_HOME);
  fs.mkdirSync(home, { recursive: true });
  env.HOME = home;
  console.error(`[dev] scratch home: ${home}`);
}

const run = spawnSync(process.execPath, [path.join(cliDir, "bin", "composition.mjs")], {
  stdio: "inherit",
  env,
});
process.exit(run.status ?? 0);
