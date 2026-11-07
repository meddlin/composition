// Manage device tokens for a self-hosted server. Opens the same SQLite file as the server (WAL lets both run).
//   node lean/tokens.ts add <user> <device>     create a token; it is printed once and cannot be shown again
//   node lean/tokens.ts list                    who has one (the id is the first 8 characters of the token's hash)
//   node lean/tokens.ts revoke <id>             that device can no longer sign in
// In the container:  docker compose exec sync node lean/tokens.ts add me ipad

import { SqliteStorage } from "./sqlite-storage.ts";

const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const [command, ...args] = process.argv.slice(2);
const usage = () => {
  console.error("usage: tokens.ts add <user> <device> | list | revoke <id>");
  process.exit(2);
};

const storage = new SqliteStorage(process.env.DB_PATH ?? "./.local/lean/sync.db");
await storage.init();

if (command === "add") {
  const [user, device] = args;
  if (!user || !device || !NAME.test(user) || !NAME.test(device)) {
    console.error("user and device must be 1-64 characters of letters, digits, '.', '_' or '-'");
    process.exit(2);
  }
  const { token, id } = storage.addDevice(user, device);
  console.log(`Token for ${user}/${device} (id ${id}). Copy it now: it is not stored and cannot be shown again.\n`);
  console.log(token);
} else if (command === "list") {
  const devices = storage.listDevices();
  if (devices.length === 0) console.log("No devices yet.");
  for (const d of devices) console.log(`${d.id}  ${d.user}/${d.device}  created ${d.createdAt}${d.revokedAt ? `  REVOKED ${d.revokedAt}` : ""}`);
} else if (command === "revoke") {
  const n = args[0] ? storage.revokeDevice(args[0]) : 0;
  console.log(n > 0 ? `Revoked ${n} device.` : "No active device with that id (see `list`).");
  if (n === 0) process.exitCode = 1;
} else {
  usage();
}
await storage.close();
