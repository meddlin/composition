// SPIKE-ONLY WORKAROUND, loaded with `node --import ../../scripts/windows-spike/spawn-shell.mjs <script>`.
//
// apps/desktop/scripts/build-renderer.mjs and collect-licenses.mjs run `spawnSync("pnpm", …)` with no shell.
// Windows only finds a bare `pnpm` as pnpm.exe, and pnpm ships pnpm.cmd, so those calls fail with ENOENT.
// This makes calls for `pnpm` use a shell, which finds pnpm.cmd. It is what the real fix in the scripts has
// to do (or call pnpm.cmd); it exists here only so the rest of the build can be exercised.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

if (process.platform === "win32" || process.env.SPIKE_FORCE_SPAWN_SHELL === "1") {
  const patch = (name) => {
    const original = childProcess[name];
    childProcess[name] = function (command, ...rest) {
      if (command !== "pnpm") return original.call(this, command, ...rest);
      const hasArgs = Array.isArray(rest[0]);
      const args = hasArgs ? rest[0] : [];
      const options = (hasArgs ? rest[1] : rest[0]) ?? {};
      return original.call(this, command, args, { shell: true, ...options });
    };
  };
  patch("spawnSync");
  patch("spawn");
  syncBuiltinESMExports();
  console.log("[spike] spawn(Sync)('pnpm') now uses a shell");
}
