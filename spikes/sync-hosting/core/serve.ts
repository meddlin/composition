// Process bootstrap shared by the lean and Postgres entry points: read the environment, start the app,
// stop cleanly on SIGTERM (Fly and Docker send it on deploy and stop).

import { createApp, parseTokens } from "./app.ts";
import type { SyncStorage } from "./storage.ts";
import type { ServerKind } from "../protocol/types.ts";

export async function serve(kind: ServerKind, storage: SyncStorage, defaultPort: number): Promise<void> {
  const port = Number(process.env.PORT ?? defaultPort);
  const quiet = process.env.LOG === "0";
  const staticTokens = process.env.SYNC_DEV_TOKENS ? parseTokens(process.env.SYNC_DEV_TOKENS) : undefined;
  if (!staticTokens && !storage.authenticate) throw new Error("SYNC_DEV_TOKENS is not set (run `pnpm gen-tokens`) and this storage keeps no tokens of its own");
  const app = await createApp({
    kind,
    storage,
    tokens: staticTokens,
    adminToken: process.env.SYNC_ADMIN_TOKEN,
    log: quiet ? undefined : (line) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line })),
  });

  await new Promise<void>((resolve) => app.server.listen(port, "0.0.0.0", resolve));
  console.log(JSON.stringify({ t: new Date().toISOString(), ev: "listening", kind, port }));

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ t: new Date().toISOString(), ev: "stopping", signal }));
    await app.shutdown();
    await storage.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
