// Runs the HTTP contract suite against a throwaway server: a plain `node lean/main.ts` process on a temporary database,
// signed in with device tokens made by the CLI an owner would use (lean/tokens.ts). An admin token is set so the admin
// tests run too (30 tests); --no-admin leaves it off (27 tests). Anything else is passed on to `node --test`.
//   pnpm test
//   pnpm test --no-admin
//   pnpm test --test-name-pattern=tombstone

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const withAdmin = !args.includes("--no-admin");
const passThrough = args.filter((a) => a !== "--no-admin");

// The users and devices protocol/contract/suite.test.ts signs in as.
const IDENTITIES = ["ct-alice/a", "ct-alice/b", "ct-alice/c", "ct-alice/d", "ct-bob/a"];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, server: ChildProcess): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`the server exited with code ${server.exitCode}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the server did not answer /healthz within 10 s");
}

const dir = mkdtempSync(join(tmpdir(), "sync-contract-"));
const dbPath = join(dir, "sync.db");
let server: ChildProcess | undefined;
let exitCode = 1;
try {
  const tokens: Record<string, { user: string; device: string }> = {};
  for (const identity of IDENTITIES) {
    const [user, device] = identity.split("/") as [string, string];
    const made = spawnSync(process.execPath, ["lean/tokens.ts", "add", user, device], { cwd: root, env: { ...process.env, DB_PATH: dbPath }, encoding: "utf8" });
    const token = made.stdout.trim().split("\n").at(-1) ?? "";
    if (made.status !== 0 || !token.startsWith("cst_")) throw new Error(`could not create a token for ${identity}: ${made.stderr || made.stdout}`);
    tokens[token] = { user, device };
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const admin = withAdmin ? `adm_${randomBytes(24).toString("hex")}` : undefined;
  const serverLog: string[] = [];
  server = spawn(process.execPath, ["lean/main.ts"], {
    cwd: root,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), LOG: "0", SYNC_ADMIN_TOKEN: admin ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d: Buffer) => serverLog.push(String(d)));
  server.stderr?.on("data", (d: Buffer) => serverLog.push(String(d)));
  try {
    await waitForHealth(base, server);
  } catch (err) {
    console.error(serverLog.join(""));
    throw err;
  }

  const suite = spawn(process.execPath, ["--test", ...passThrough, "protocol/contract/suite.test.ts"], {
    cwd: root,
    env: { ...process.env, BASE_URL: base, SYNC_DEV_TOKENS: JSON.stringify(tokens), SYNC_ADMIN_TOKEN: admin ?? "" },
    stdio: "inherit",
  });
  exitCode = await new Promise<number>((resolve) => suite.on("close", (code) => resolve(code ?? 1)));
  if (exitCode !== 0) console.error(`\nserver output:\n${serverLog.join("")}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server!.once("close", r));
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
