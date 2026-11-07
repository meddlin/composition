# Self-hosting the Composition sync server

One container, one SQLite file, backed up continuously: the **lean** setup from
[the sync design](../../../docs/cross-device-sync-design.md#how-the-lean-setup-works), packaged so you can run it on a personal
server, a NAS or a Raspberry Pi. This folder is the setup; [the app's README](../README.md) covers the code and running it without Docker.

**Status: ready ahead of the apps.** The desktop and iPad apps cannot connect to it yet (the server-address setting
and the sync engine are not built). Today you can stand it up, add tokens, and try it with `curl` or the contract suite.
Records are opaque bytes to the server; **nothing encrypts them yet**, because no client exists (the design makes the clients encrypt,
D4). Sign-in is a token per device, not accounts (the design leaves real self-hosted sign-in for later).

## You need

A machine with Docker and the Compose plugin: any x86 or ARM Linux box, about 256 MB of free memory, and a few hundred MB of disk
(a library of text notes is megabytes). The image builds for `linux/amd64` and `linux/arm64`.

## Stand it up

```bash
cd apps/sync-server/selfhost
cp .env.example .env          # optional: everything has a default
docker compose up -d --build
docker compose logs sync      # look for "listening"; it also tells you no device can sign in yet
```

It listens on `127.0.0.1:8787` (the host's loopback only), speaks plain HTTP, and backs up to `./backup`.

## Add a device

A device signs in with a token. Make one per device; a "user" is just a name, and devices sharing a user name share one library.

```bash
docker compose exec sync node lean/tokens.ts add me ipad       # prints the token once; only its hash is stored
docker compose exec sync node lean/tokens.ts add me desktop
docker compose exec sync node lean/tokens.ts list              # ids, users, devices, revoked or not
docker compose exec sync node lean/tokens.ts revoke 1da22ecc   # that device can no longer sign in
```

Check it is up: `curl http://127.0.0.1:8787/v1/info`.

## Reach it from your devices

The server speaks plain HTTP, so a token sent to it over the internet travels in the clear. **Do not open port 8787 to the internet as
it is.** Choose one:

| Way | How | Tested? |
|---|---|---|
| **Caddy, automatic HTTPS** | Point a DNS name at the machine, forward ports 80 and 443, set `SYNC_DOMAIN=sync.example.com` in `.env`, then `docker compose --profile https up -d`. | Tested locally with Caddy's own certificate, including that the event stream passes through unbuffered. **Real certificate issuance is untested.** |
| **Tailscale** | Run Tailscale on the server and your devices and use its address (or `tailscale serve` for HTTPS). No public ports at all. | Not tested. |
| **Cloudflare Tunnel** | A tunnel to `http://127.0.0.1:8787`. | Not tested. |

Only widen `SYNC_BIND` (for example to `0.0.0.0` on a trusted LAN) once something safe is in front.

## Backups and restoring

The database is copied out about once a second ([Litestream](https://litestream.io)). Set `BACKUP_DIR` in `.env` to a **second disk or a
NAS mount**: a backup on the same disk does not survive that disk. To back up to an S3-compatible bucket instead (Cloudflare R2,
Backblaze B2, MinIO), set the `LITESTREAM_*` values in `.env`; the bucket wins if both are set. With neither, the server starts but
logs a warning every time that no backup exists.

If the server's disk is lost you can lose roughly the last second of changes. Every device keeps its own full copy and re-pushes what the
restored server lacks (in the drill that checked this, the last transaction was lost and the devices put it back).

**To restore:** start the container with an empty `data` volume while the backup is reachable. It restores by itself and rotates the
server's epoch, which makes devices notice and resync.

```bash
docker compose down
docker volume rm composition-sync_data      # simulating a lost disk
docker compose up -d                        # restores from the backup, logs {"ev":"restored"}
```

If you instead put a database file back by hand, the epoch must be rotated before the server starts or devices can miss records
(`node lean/rotate-epoch.ts` inside the image; that route is untested).

## Upgrade

```bash
git pull
docker compose up -d --build
```

Data lives in the `data` volume and survives. The server creates any missing tables at start; there is no migration tooling yet. The
protocol is a draft, so expect to upgrade the server and the apps together for now.

## Look after it

- `docker compose ps` shows `healthy`; `docker compose logs sync` is one JSON line per request with ids, counts and timings and **never
  note content**.
- The container runs as root so Litestream can write to the volumes: fine on a private box, worth knowing.
- There is no rate limiting. A token is 256 random bits, and anyone who has one can read and write that user's records.
- The admin routes (reset, rotate epoch) are off: they need `SYNC_ADMIN_TOKEN`, which this compose file does not set.

## Not built yet

Real sign-in and accounts, attachment blobs, quotas, a published image (you build from source for now), a pairing flow in the apps, and
a run on real ARM hardware (the arm64 image builds and its binaries start under emulation).

## Checks

Both build their own throwaway project on other ports and leave nothing behind. Run them from `apps/sync-server`:

```bash
bash selfhost/smoke.sh            # token, restart, lose the disk and restore, revoke (add --https for the Caddy profile)
bash selfhost/contract.sh         # the 27 contract tests that run without an admin token, signing in with tokens from the CLI
```

CI runs `smoke.sh` (without `--https`) on every pull request.
