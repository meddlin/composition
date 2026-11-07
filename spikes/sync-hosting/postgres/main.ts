// Postgres candidate: the same Node core on managed Postgres. DATABASE_URL defaults to the local container
// (see compose.yaml); on Fly it is a secret holding the Neon connection string.

import { serve } from "../core/serve.ts";
import { PgStorage } from "./pg-storage.ts";

const url = process.env.DATABASE_URL ?? "postgres://sync:sync@127.0.0.1:55432/sync";
const storage = new PgStorage(url);
await storage.init();
await serve("postgres", storage, 8788);
