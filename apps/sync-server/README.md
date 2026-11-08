# Composition sync server

The server that keeps your notes in step across your own devices. You run it yourself: on a personal server, a NAS or a
Raspberry Pi. It stores each note as an opaque record and never reads one; the design has the apps encrypt before they upload
(not built yet). One Node process and one SQLite file, backed up continuously.

It is the **lean** setup from [the sync design](../../docs/cross-device-sync-design.md#how-the-lean-setup-works); the
[architecture page](../../docs/architecture/sync-server.md) says where it fits.

**Status: the server is ready ahead of the apps.** The desktop and iPad apps cannot connect to it yet (neither has a sync engine
or a server-address setting). There is no real sign-in: each device gets a token, made with the command line below. The
protocol is a draft ([protocol/PROTOCOL.md](protocol/PROTOCOL.md)), so expect to upgrade the server and the apps together.

## Run it in a container (the way to host it)

[selfhost/README.md](selfhost/README.md) is the guide: Docker Compose, a token per device, HTTPS with Caddy, backups to a folder or
an S3-compatible bucket, restore, upgrade.

```bash
cd apps/sync-server/selfhost
docker compose up -d --build
docker compose exec sync node lean/tokens.ts add me ipad
```

## Run it as a plain process

For development, or a machine that has Node 24 and no Docker. There are no dependencies to install: `node:sqlite` and `node:http`
ship with Node, and Node runs the TypeScript directly (no build step).

```bash
cd apps/sync-server
node lean/tokens.ts add me ipad     # prints the token once; only its hash is stored
node lean/main.ts                   # or: pnpm start      listens on :8787
curl http://127.0.0.1:8787/v1/info
```

The server listens on **all interfaces** and speaks plain HTTP, so keep it off the internet until HTTPS is in front (the container
setup binds loopback and offers Caddy for that). A plain process has no backup; run it under Litestream the way
[`lean/entrypoint.sh`](lean/entrypoint.sh) does, or copy the database file.

| Setting | Default | What |
|---|---|---|
| `DB_PATH` | `./.local/lean/sync.db` (`/data/sync.db` in the image) | The SQLite file. The tokens command opens the same file. |
| `PORT` | `8787` (`8080` in the image) | Listen port. |
| `LOG` | on | `LOG=0` silences the per-request log lines (they never contain note content). |
| `SYNC_ADMIN_TOKEN` | unset | Turns on the admin routes (`/v1/admin/reset`, `/v1/admin/rotate-epoch`). Leave it unset in production. |
| `SYNC_DEV_TOKENS` | unset | Extra tokens as JSON, `{"<token>":{"user":"me","device":"ipad"}}`, checked before the database. For tests and development. |

Device tokens: `node lean/tokens.ts add <user> <device>`, `list`, `revoke <id>`. A "user" is a name, and devices sharing one share a
library.

## What is in the folder

| Path | What |
|---|---|
| `core/` | The HTTP app (auth, routing, `/v1/sync`, the event stream), the in-memory hint hub, the storage interface, and the process bootstrap. |
| `lean/` | The SQLite storage and device tokens, the `tokens.ts` and `rotate-epoch.ts` commands, the Dockerfile, the entrypoint (restore from the backup, rotate the epoch) and the Litestream configs. |
| `protocol/` | The wire types, request validation and `PROTOCOL.md`; `client/` and `contract/` hold the contract suite and what it needs. |
| `selfhost/` | The Compose file, the optional Caddy HTTPS profile, `.env.example`, the guide, and two end-to-end checks. |
| `scripts/contract.ts` | What `pnpm test` runs: a throwaway server and the contract suite. |

## Checks

```bash
pnpm install                  # only the dev dependencies (TypeScript, Node types)
pnpm typecheck
pnpm test                     # the contract suite (30 tests) against a throwaway server, made and torn down for you
pnpm test --no-admin          # the 27 tests that need no admin token
```

The suite runs over HTTP against any server. Against one you started yourself:

```bash
BASE_URL=http://127.0.0.1:8787 SYNC_DEV_TOKENS='{"<token>":{"user":"ct-alice","device":"a"},...}' \
  node --test protocol/contract/suite.test.ts
```

It needs a token for `ct-alice/a`, `b`, `c`, `d` and `ct-bob/a`, and runs the three admin tests only if `SYNC_ADMIN_TOKEN` is also set.
(It writes records for those two users, and its admin tests reset `ct-bob` and rotate the server's epoch: use a throwaway server.)

The container checks need Docker and run on their own compose project and ports, leaving nothing behind:

```bash
bash selfhost/smoke.sh            # token, restart, lose the disk and restore from the backup folder, revoke (--https adds the Caddy profile)
bash selfhost/contract.sh         # the 27 contract tests against the container, signing in with tokens from its CLI
```

CI runs the type-check, `pnpm test` and `selfhost/smoke.sh`.

## Not built yet

Real sign-in and accounts, end-to-end encryption (the apps do it), attachment blobs, quotas, rate limiting, a published image (you
build from source), and the apps' side: a server-address setting and the sync engine. Not tested: real Let's Encrypt certificates
through Caddy, Tailscale, Cloudflare Tunnel, real ARM hardware, and putting a database file back by hand and then running
`node lean/rotate-epoch.ts`. The server reads its epoch once at start, so rotating from another process needs a server restart; the
container's entrypoint rotates before starting the server, which is the tested path.
