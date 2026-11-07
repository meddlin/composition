// Lean candidate: one Node process, one SQLite file. Litestream (see entrypoint.sh) replicates the file.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "../core/serve.ts";
import { SqliteStorage } from "./sqlite-storage.ts";

const dbPath = process.env.DB_PATH ?? "./.local/lean/sync.db";
mkdirSync(dirname(dbPath), { recursive: true });

const storage = new SqliteStorage(dbPath);
await storage.init();
await serve("lean", storage, 8787);
