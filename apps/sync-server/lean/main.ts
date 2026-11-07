// The sync server: one Node process, one SQLite file. Litestream (see entrypoint.sh) replicates the file.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "../core/serve.ts";
import { SqliteStorage } from "./sqlite-storage.ts";

const dbPath = process.env.DB_PATH ?? "./.local/lean/sync.db";
mkdirSync(dirname(dbPath), { recursive: true });

const storage = new SqliteStorage(dbPath);
await storage.init();
if (!process.env.SYNC_DEV_TOKENS && storage.activeDeviceCount() === 0) {
  console.log(JSON.stringify({ ev: "no-devices", hint: "no device can sign in yet: run `node lean/tokens.ts add <user> <device>` (in a container: docker compose exec sync node lean/tokens.ts add <user> <device>)" }));
}
await serve("lean", storage, 8787);
