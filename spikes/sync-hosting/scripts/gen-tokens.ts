// Generates the static per-device dev tokens (no Clerk here: sign-in is spike S4) into .env.tokens.local.
// Both the servers and the clients read SYNC_DEV_TOKENS, so one file serves everything. Re-running keeps
// existing tokens unless --rotate is passed. Tokens are never printed.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".env.tokens.local");

/** user -> device names. The contract suite and each scenario use their own user so runs never collide. */
export const USERS: Record<string, string[]> = {
  "ct-alice": ["a", "b", "c", "d"],
  "ct-bob": ["a"],
  "s-normal": ["a", "b"],
  "s-burst": ["a", "b"],
  "s-library": ["a", "b", "c"],
  "s-concurrent": ["a", "b", "c", "d", "e", "f", "g", "h"],
  "s-idle": ["a", "b"],
  "s-fault": ["a", "b", "c"],
  "s-drill": ["a", "b", "c"],
  harness: ["a", "b"],
};

const read = (name: string): string | undefined => {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1);
};

const rotate = process.argv.includes("--rotate");
const existing = rotate ? undefined : read("SYNC_DEV_TOKENS");
const tokens: Record<string, { user: string; device: string }> = existing ? JSON.parse(existing) : {};
const have = new Set(Object.values(tokens).map((t) => `${t.user}/${t.device}`));
let added = 0;
for (const [user, devices] of Object.entries(USERS)) {
  for (const device of devices) {
    if (have.has(`${user}/${device}`)) continue;
    tokens[`tok_${randomBytes(24).toString("hex")}`] = { user, device };
    added += 1;
  }
}
const admin = (rotate ? undefined : read("SYNC_ADMIN_TOKEN")) ?? `adm_${randomBytes(24).toString("hex")}`;
writeFileSync(file, `SYNC_DEV_TOKENS=${JSON.stringify(tokens)}\nSYNC_ADMIN_TOKEN=${admin}\n`, { mode: 0o600 });
// Env files the npm scripts load with --env-file-if-exists; creating them keeps Node from printing a notice.
for (const name of [".env.candidates.local", ".env.postgres.local"]) {
  const f = join(root, name);
  if (!existsSync(f)) writeFileSync(f, "", { mode: 0o600 });
}
console.log(`${file}: ${Object.keys(tokens).length} device tokens (${added} new), 1 admin token. Values not printed.`);
