// Run by entrypoint.sh after it restored the database from the replica: history was rebuilt, so devices
// must be told (a new epoch makes them resync and re-push what the restored server lacks).

import { SqliteStorage } from "./sqlite-storage.ts";

const storage = new SqliteStorage(process.env.DB_PATH ?? "./.local/lean/sync.db");
await storage.init();
const epoch = await storage.rotateEpoch();
console.log(JSON.stringify({ ev: "epoch-rotated", epoch }));
await storage.close();
