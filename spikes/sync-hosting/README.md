# Sync hosting spike (S8, with S6)

Throwaway prototypes of the three hosted sync-server candidates in
[the cross-device sync design](../../docs/cross-device-sync-design.md#comparing-the-three-by-hand), so D3 can be decided by
hand: **lean** (Node + one SQLite file + Litestream to R2 on one Fly machine), **managed Postgres** (the same Node core on Neon),
and **Convex** (the same operations as Convex functions behind HTTP actions). One draft protocol, one HTTP contract suite, one
scripted client and one set of scenarios run against all three.

**This branch is not meant to merge.** It exists so the results can be written back into the design doc; it is deleted after D3 is
decided. Nothing here touches `apps/`, the root `package.json`, `scripts/` or any workflow, and no code imports from `apps/`.

**What this is not.**
- **Not the desktop app.** The app's server-address setting and the real sync engine do not exist yet. The two "devices" are
  simulated clients in `protocol/client/`, and [the harness](#the-two-device-harness) is a small local page, not Composition.
- **Not encrypted.** Records are random opaque bytes standing in for ciphertext (encryption is spike S5).
- **Not signed in.** Each device has a static dev token (sign-in is spike S4).
- **Not load-tested.** Scenarios measure one user's traffic, not a crowd.

## Layout

| Path | What |
|---|---|
| [protocol/PROTOCOL.md](protocol/PROTOCOL.md) | The draft protocol: push with `baseVersion`, pull since a cursor, a change hint, the server `epoch`, tombstones, gap-free per-user versions. |
| `protocol/types.ts`, `validate.ts`, `b64.ts` | Wire types, limits, request validation. Shared by the Node core and the Convex functions. |
| `protocol/contract/suite.test.ts` | The contract suite: 30 tests over HTTP against any base URL. |
| `protocol/client/` | The simulated device (outbox, same-batch retry, conflict copies, epoch resync), HTTP transport, hint sources (SSE, Convex live query, poll) and fault injection. |
| `protocol/scenarios/` | The scenarios and the runner (`pnpm scenario`). |
| `core/` | The shared Node server: auth, routing, `/v1/sync`, SSE hints, and the storage interface. |
| `lean/` | SQLite adapter, Dockerfile, entrypoint (restore from the replica, rotate the epoch), Litestream config, `fly.toml`, a compose file with an S3 mock. |
| `postgres/` | Postgres adapter, Dockerfile, `fly.toml`, a compose file for a local Postgres. |
| `convex/` | The Convex functions (`functions/`), and [FINDINGS.md](convex/FINDINGS.md) (backups, export, regions, terms, serializability). |
| `harness/` | The two-device page. |
| `scripts/` | `wizard.sh` (your accounts and keys), `deploy-*.sh`, `run-all.sh`, `drills/`, `teardown.sh`, `summarize.ts`. |
| `results/` | Numbers from the runs. `local/` is infrastructure-only (everything on this laptop); `real/` is the three deployed hosts. |

## Run it locally (no accounts)

Needs Node 24, pnpm and Docker.

```bash
cd spikes/sync-hosting
pnpm install
pnpm gen-tokens            # writes .env.tokens.local (gitignored); tokens are never printed
```

Start the three candidates:

```bash
docker compose -f lean/compose.yaml up -d --build        # lean as the real image, replicating to an S3 mock, on :8787
docker compose -f postgres/compose.yaml up -d && pnpm postgres     # Postgres candidate on :8788 (leave running)
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev         # a local Convex backend, no account; leave running (:3210, :3211)
pnpm exec convex env set --from-file .env.tokens.local   # in another terminal, once
```

Without Docker, `pnpm lean` runs lean as a plain Node process on :8787 (no replication). The S3 mock only rehearses the
replicate and restore flow; it says nothing about Cloudflare R2.

Run the contract suite against each, then the scenarios:

```bash
CANDIDATE=lean pnpm contract        # also: CANDIDATE=postgres, CANDIDATE=convex, or BASE_URL=https://...
pnpm scenario normal --candidate lean
pnpm scenario all --candidate convex    # normal, burst, library, concurrent, faults
bash scripts/run-all.sh local           # everything, including the drills, for all three; writes results/local/
```

### The scenarios

| Scenario | What it does |
|---|---|
| `normal` | Device A edits a note every 1.5 s, device B is told by a hint. Push ack and propagation, p50/p95. The push is immediate; the app adds a 2 s debounce. |
| `burst` | 500 edits over 100 notes in about 5 s. Time to converge, requests used, push latency under load. |
| `library` | A 10 MB library (2,000 notes plus placements): upload from a device that has it, then a pull from cursor 0 on an empty device, byte-compared. |
| `concurrent` | 8 devices of one user push at once (fresh records plus contended ones). Checks versions are exactly `1..head`, none repeated; counts conflicts, 5xx retries and latency. |
| `faults` | Three devices through dropped requests, dropped responses, duplicates, 503s and delays (seeded). Solo phase: no conflicts despite duplicates (idempotent retry). Then every device's last text per note must survive, and all replicas must agree. |
| `idle` | Warm pushes, an idle pause (`--idle-seconds`, default 600), then a push: the first sync after idle. |
| `outage` | Takes the target down with `--down-cmd`, back with `--up-cmd`; measures the longest sync pause and checks no edit was lost. |
| `restore` | Backs up, writes more, restores, counts what the server lost, then lets the devices heal through the epoch. `--devices offline` (default) measures loss before anything can heal it. |

## Run it on real hosts

You do the account steps; the rest is scripted. Fly, Neon, Convex and Cloudflare R2 each need an account (Fly and R2 want a payment
card even for tiny usage).

```bash
bash scripts/wizard.sh              # walks you through the four accounts; secrets go to gitignored .env.*.local files
bash scripts/deploy-all.sh          # Fly (lean, Postgres API), Convex functions; runs the contract suite on each
bash scripts/run-all.sh real        # every scenario and drill, 600 s idle pause; writes results/real/ and SUMMARY.md
```

Deploys use your logged-in `flyctl` and the Convex deploy key from the wizard. The scripts read secrets by name and never print
them; Fly secrets are set through stdin.

### Teardown (stops all spend)

```bash
bash scripts/teardown.sh            # asks before deleting each real host
bash scripts/teardown.sh --local    # only the local containers and processes
```

It deletes the two Fly apps (machines, volume and secrets go with them), empties the R2 bucket (and deletes it if the token may),
and deletes the Neon project. **Convex has to be deleted in its dashboard** (Settings, Delete Project); on Starter it costs nothing
at rest. The script ends by listing any `comp-sync-*` apps still on your Fly account.

Cost while running, at prices read 2026-11-05 (re-check): two Fly `shared-cpu-1x` 256 MB machines about $2.19 each, a 1 GB volume
$0.15, R2 free under 10 GB, Neon Free $0, Convex Starter pay-as-you-go. Fly's page says invoices under $5 are waived.

## The two-device harness

```bash
pnpm harness            # http://127.0.0.1:8799
```

Type on device A and watch device B, with a readout of how long the other device took to hold the text. Switch candidate with the
buttons. A candidate has to be running to be chosen (an unreachable one is greyed out, with its address in the tooltip, and the
list refreshes every 5 s); a switch that fails says why and leaves you on the previous candidate; if the harness itself stops, a red
banner says so and the page reconnects when it is back. Other controls: change the push debounce (0 ms shows the infrastructure alone, 2000 ms is the
design), choose live hints or a 5 s poll, and take either device offline to edit both and see the conflict rule: the first writer to
reach the server wins and the other text becomes a conflict copy on both devices. Local only; it binds to 127.0.0.1.

## What the candidates are

- **lean**: `core/` plus `lean/sqlite-storage.ts` (`node:sqlite`, WAL, one writer, so versions are gap-free with no lock). The image
  runs `litestream replicate -exec "node lean/main.ts"`; if the disk is empty and a replica exists it restores first and rotates the
  epoch, which is what makes devices resync. One database file for all users.
- **postgres**: the same `core/`, with `postgres/pg-storage.ts`. A push locks the user's `user_seq` row, so one user's pushes
  serialize. The API is stateless apart from the in-memory head and SSE connections, so it assumes one process.
- **convex**: `convex/functions/sync.ts` (mutation, query, live-query hint) and `http.ts` (the same routes as HTTP actions). A second
  implementation of the contract, not a port: it shares only the types and the request validator.

## Not verified here

Listed in the results write-up in the design doc. In short: Fly and Neon CLI/API steps that I could not run without accounts are
untested until the real run; Cloudflare R2 behaviour with Litestream is untested (the local flow uses an S3 mock); Convex's
Terms of Service text did not load; no load beyond one user; cost is read from vendor pages, not billed.
