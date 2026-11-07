# Sync server

Source: [`apps/sync-server`](../../apps/sync-server/README.md), with the wire protocol in
[`PROTOCOL.md`](../../apps/sync-server/protocol/PROTOCOL.md).

The sync server is what will keep a person's notes in step across their own devices (the desktop app and, later, the iPad
app). It is **self-hosted**: the owner runs it on a personal server, a NAS or a Raspberry Pi. No hosted service is built; that waits
until the product has users to host for. The reasoning, the protocol and the other designs that were weighed are in
[the cross-device sync design](../cross-device-sync-design.md), which also describes
[the lean setup](../cross-device-sync-design.md#how-the-lean-setup-works) this app implements.

**Status.** The server is built and checked; the apps cannot connect to it yet. The desktop and iPad apps have no sync engine and
no server-address setting, and the apps will encrypt records before they upload, which is not built either. Sign-in is a token
per device, not accounts.

## What it is

- One Node 24 process, one SQLite file (`node:sqlite`), no runtime dependencies, no build step (Node runs the TypeScript directly).
- It stores **records**, one per note, placement, group or notebook, as opaque bytes with a server-assigned, gap-free,
  per-user version. It never parses a note.
- A device pushes its changes and pulls what others changed in one request (`POST /v1/sync`), and listens on a small event
  stream (`GET /v1/events`) that says "something changed, go pull".
- Device tokens are kept hashed in the same SQLite file. A "user" is a name, and devices that share one share a library.
- The container backs the file up about once a second with Litestream, to a folder or an S3-compatible bucket. After a restore the
  server changes its **epoch**, which makes every device resync and re-push whatever the restored server lacks.

## How to run it

In a container, which is how it is meant to be hosted:

```bash
cd apps/sync-server/selfhost
docker compose up -d --build
docker compose exec sync node lean/tokens.ts add me ipad    # a token per device, printed once
```

As a plain process on a machine with Node 24: `node lean/main.ts` in `apps/sync-server`. The app's
[README](../../apps/sync-server/README.md) covers both, with the settings; the
[self-hosting guide](../../apps/sync-server/selfhost/README.md) covers HTTPS, backups, restore and upgrade.

## How it is checked

`pnpm typecheck` and `pnpm test` in `apps/sync-server` (the HTTP contract suite against a throwaway server), and
`bash selfhost/smoke.sh` and `bash selfhost/contract.sh` for the container. The
[unit tests workflow](../../.github/workflows/unit-tests.yml) runs the type-check, the contract suite and the smoke test.

## Not built yet

A published image, real sign-in, end-to-end encryption, attachment blobs, quotas, and the apps' side of it all. The app's README lists
what has not been tested.
