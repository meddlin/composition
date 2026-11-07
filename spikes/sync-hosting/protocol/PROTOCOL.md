# Draft sync protocol (spike S8)

A **draft subset** of the protocol in [the design](../../../docs/cross-device-sync-design.md#the-protocol), small enough to
build three servers against before Gate B. It is for comparing hosts, not a frozen contract: S3 will change it, and what
this spike learns feeds S3 and Gate B. Version `1`, advertised with `"draft": true`.

What is in: push with `baseVersion`, pull since a cursor, a change hint, the server `epoch`, tombstones, server-assigned
gap-free per-user versions, retry-safe batches. What is not: blobs, accounts, quotas, `resync` for a cursor older than the
tombstone horizon, gzip, rate limits, encryption (payloads are random bytes standing in for ciphertext) and real sign-in
(a static token per device).

## Records

The server stores `(user, entity, uuid) → (version, deleted, schemaVersion, payload)` and nothing else. It never looks
inside a payload.

| Field | Rule |
|---|---|
| `entity` | `[a-z][a-z_]{0,31}` (`note`, `placement`, `group`, `notebook`, ...) |
| `uuid` | 32 lowercase hex characters |
| `version` | Assigned by the server: the user's counter at the write. Unique across all of a user's writes. |
| `deleted` | A tombstone. The payload may be empty. Kept (retention is not built). |
| `schemaVersion` | 1..65535, stored and returned untouched |
| `payload` | Base64 of opaque bytes, at most 512 KiB decoded |

## Endpoints

| | |
|---|---|
| `GET /v1/info` | No auth. Protocol version, `draft`, which candidate, `epoch`, `limits`, and the `hint` mechanism. |
| `POST /v1/sync` | Bearer token. Push and pull in one request. |
| `GET /v1/events` | Bearer token, SSE. Advertised by `info.hint` as `{kind:"sse"}`. Convex advertises `{kind:"convex-query"}` instead. |
| `POST /v1/admin/reset` | Admin token, dev only. `{user}` empties one user. |
| `POST /v1/admin/rotate-epoch` | Admin token. Used after a restore that the server did not perform itself. |

Errors are `{"error":{"code","message"}}`: `401 unauthorized`, `400 invalid_request | invalid_json | duplicate_in_batch`,
`413 record_too_large | batch_too_large | body_too_large`, `426 protocol_too_old`, `503 storage_unavailable` (retry).

## `POST /v1/sync`

```jsonc
// request
{ "protocolVersion": 1, "deviceId": "ipad", "batchId": "b_9f2c...", "cursor": 41, "epoch": "821fe4de...",
  "pullLimit": 200,
  "changes": [ { "entity": "note", "uuid": "...", "baseVersion": 12, "deleted": false, "schemaVersion": 1, "payload": "..." } ] }

// response
{ "protocolVersion": 1, "epoch": "821fe4de...", "head": 57,
  "applied":   [ { "entity": "note", "uuid": "...", "version": 56 } ],
  "conflicts": [ { "entity": "note", "uuid": "...", "current": { "...": "the server's record, or null if it has none" } } ],
  "changes":   [ { "entity": "note", "uuid": "...", "version": 56, "deleted": false, "schemaVersion": 1, "payload": "..." } ],
  "cursor": 57, "more": false }
```

**Push.** A change is accepted only if `baseVersion` equals the record's current version (`0` for a record that does not
exist). Accepted changes in a batch get the next consecutive versions, in order. A rejected one is returned in `conflicts`
and consumes no version. The whole batch is one transaction, and a user's writes are serialized, so versions are
**gap-free**: after any run, the versions handed out to a user are exactly `1..head`, each once.

**Retry.** `batchId` is random. A request carrying a `batchId` the server has seen returns that batch's stored `applied`
and `conflicts` and applies nothing (retry records live a day). The pull half is computed fresh.

**Pull.** `changes` holds records with `version > cursor`, ascending, **including the device's own writes** (the device
skips a version it already holds). A page stops at `pullLimit` records (max 500) or about 1 MiB of payload, always
returning at least one record; `more` says to continue from `cursor`. `pullLimit: 0` is push-only. When `more` is false,
`cursor` is at least the user's head when the pull began. Only latest state is kept, so a record edited twice appears once
and the versions in a pull are not contiguous; gap-freeness is about versions handed out, not versions still stored.

**Epoch.** Every response carries the server's `epoch`, a random id that changes whenever history is restored or rebuilt.
If a request's `epoch` differs from the server's, or its `cursor` is ahead of the user's head, the response has
`resync: "epoch" | "cursor_ahead"` and **nothing is applied or returned**. The device restarts from `cursor 0` under the new
epoch, compares what the server has with what it holds, and re-pushes whatever the server lacks. A restore that does not
change the epoch can silently starve a device whose cursor the new history has caught up to, which is why the epoch exists.

**Conflicts are the device's job.** The server only says "the record moved". The design's rule (first to the server wins,
the loser is kept as a conflict copy, an edit beats a delete) lives in `client/device.ts`.

## Change hints

A hint is `{head, epoch}`: the user's head moved (or the epoch changed). It carries no data; the device then calls
`/v1/sync`. A missed hint costs one poll interval. The mechanism differs per candidate and is advertised in `/v1/info`:

| `hint.kind` | Candidate | How |
|---|---|---|
| `sse` | lean, Postgres | `GET /v1/events` streams `event: hint`, a heartbeat every 15 s, and a hint on connect. The API process keeps each user's head in memory, so a hint costs no database read. |
| `convex-query` | Convex | Subscribe to a public query `sync:head({token})` over Convex's WebSocket. An HTTP action cannot hold a stream open without paying for a function call per tick, so this one uses the Convex client library. |
| (poll) | any | Call `/v1/sync` every N seconds. |

## Limits

`maxRecordBytes` 512 KiB (Convex documents are capped at 1 MiB), `maxBatchRecords` 100, `maxBatchBytes` 2 MiB,
`maxBodyBytes` 4 MiB, `defaultPullLimit` 200, `maxPullLimit` 500, `maxPullBytes` 1 MiB. Defined once in `types.ts`.

## What the contract suite checks

`contract/suite.test.ts` runs over HTTP against any base URL: info and auth; a new record and byte-exact round trip;
consecutive versions; update and latest-only pull; stale `baseVersion`; the null `current`; mixed batches; tombstones and
undelete; idempotent retry (including after the record moved on); cursor and paging by count and by bytes; push-only;
tenant isolation; validation and size limits; epoch and cursor-ahead resync; four concurrent devices producing exactly
`h0+1..h0+N`; racing creates and racing updates (one winner each); hints reaching the same user and not another; and, with
an admin token, reset and epoch rotation.
