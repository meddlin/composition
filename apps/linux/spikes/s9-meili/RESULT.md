# S9: Meilisearch as a bundled sidecar, driven from Rust

Run 2026-11-07. Code: `src/supervisor.rs` (the process), `src/index.rs` (the index), `src/bin/host.rs` (a stand-in app for the kill tests),
`tests/sidecar.rs`.

**Question.** Decided (D5): the Linux app bundles Meilisearch **like the Electron app and the Windows design**. Can a Rust app start,
supervise and stop it with the desktop's own flags, environment and key handling, and get from it **the same answers the desktop's own
client got**?

**Answer: yes, exactly.** The Rust twin of `meili.ts` and `searchIndex.ts` returned the committed Meilisearch answers for **all 274 corpus
queries over both the 100-note and the 1,000-note corpora, with 0 differences** (the same ids in the same order), on Linux arm64 and on macOS,
with the pinned v1.53.1 binary.

## What is the same as the desktop

| | Desktop (`meili.ts`, `searchIndex.ts`, `fetch-meilisearch.mjs`) | This spike |
|---|---|---|
| Binary | Community build pinned in `meilisearch.lock.json` (version, asset name, SHA-256, size); `pnpm fetch:meilisearch` downloads it, deletes it on a digest mismatch, and `electron-builder` puts it in `meilisearch/` beside the app | The same pin and the same verify-or-delete rule were followed by hand for the test binary (below) |
| Flags | `--db-path`, `--http-addr 127.0.0.1:<port>`, `--dump-dir`, `--snapshot-dir`, `--no-analytics`; working directory is the state folder | Identical |
| Environment | `MEILI_MASTER_KEY` (not argv), `MEILI_ENV=production` | Identical. Checked: the key is not on the command line `ps` shows; the server answers nothing without it |
| Key | 32 random bytes as hex in a `0600` file, kept between runs | Identical (mode checked) |
| Port | A random free loopback port | Identical |
| Start | Reap an orphan, start, poll `/health` every 100 ms for up to 10 s, stop and report with the log's tail if it never answers | Identical; **healthy in 143 to 317 ms** on Linux |
| Stop | `SIGTERM`, up to 5 s, then `SIGKILL`; remove the pid file | Identical |
| Orphans | A pid file; the next start kills the process only if its command line mentions our data folder | Identical (tested) |
| Index | One index `notes`, primary key `id`; searchable `title, content, description`; filterable `tags, created_at_ts, updated_at_ts`; sortable `updated_at_ts` | Identical |
| Documents | `id, title, description, content, tags[], created_at_ts, updated_at_ts` (seconds, floor) | Identical |
| Query | `q`, `limit 50`, `filter` joined with ` AND `, `attributesToSearchOn`, `sort updated_at_ts:desc` when there is no text; ids de-duplicated in order | Identical, using the ported query parser (272 of 272 queries the same as the desktop's) |

## Results

| Check | Linux arm64 (Ubuntu 24.04 container, **no network**) | macOS arm64 (the pinned binary on disk) |
|---|---|---|
| Starts with the desktop's flags; key file `0600`; pid file; loopback; no answer without the key; key not in argv | pass | pass |
| All 274 queries, 100 notes, against the committed answers | **0 differ** | **0 differ** |
| All 274 queries, 1,000 notes | **0 differ** | **0 differ** |
| A hard kill in the middle of indexing (twenty requests in flight), a start on the same folder, a rebuild, a search | pass | pass |
| The app is killed (`SIGKILL`): Meilisearch is gone | **after 54 ms** (`PR_SET_PDEATHSIG`, below) | not applicable |
| With that off, the app is killed: the orphan outlives it, and the next start reaps it by the pid file | pass | not run |
| Query time through the Rust client, 1,000 notes | median **0.6 to 0.9 ms**, slowest 2 to 3 ms | median 0.4 to 1.0 ms, slowest 1.5 to 4.4 ms |

**Memory of Meilisearch itself** (Linux arm64, `VmRSS` and `VmHWM` of the child; macOS `ps` for comparison):

| | Linux resident | Linux high-water | macOS resident |
|---|---:|---:|---:|
| Right after start | 61 to 70 MB | | 50 MB |
| After indexing 100 notes | 91 to 101 MB | 454 to 463 MB | 53 to 70 MB |
| After indexing 1,000 notes | 105 to 115 MB | **541 to 548 MB** | 135 to 138 MB |

So steady state is about **100 to 115 MB** for 1,000 notes, with a **transient of about 550 MB while indexing**. The earlier measurement of a
923 MB peak on the Mac was for a different workload and is not reproduced here. Whether the transient scales with the machine's RAM (it
should: Meilisearch sizes its indexing memory from what the machine has, from memory, not checked) and whether `--max-indexing-memory` would
cap it were **not tried**; the desktop does not pass it.

## Things this found

1. **Feed the documents in the desktop's order, or the order of equal results changes.** The first run failed 203 of 274 queries on
   100 notes: the same *sets* of notes, in a different order. Meilisearch breaks ties between equally relevant notes by the order it was
   given the documents, and the desktop indexes `listNotes()`, which is `ORDER BY position IS NOT NULL, position, updated_at DESC, id DESC`
   (`DISPLAY_ORDER`). The test had loaded by id. With the desktop's order, 0 differ. The Rust core's `list_notes` must use `DISPLAY_ORDER`
   and the index must be fed from it.
2. **Ask Meilisearch for `id` only.** The desktop's query has no `attributesToRetrieve`, so every search returns up to 50 whole notes it
   then discards. In this client on Linux that made the **median query 44 to 47 ms**; adding `"attributesToRetrieve": ["id"]` (same hits,
   same order, 0 differ) made it **0.6 to 0.9 ms**. A `curl` of a one-document search on the same server took under 5 ms, so the server is
   not slow. The cause of the 40-odd milliseconds was **not isolated** (a TCP delayed-acknowledgement interaction on large responses is the
   usual suspect; `TCP_NODELAY` on the client did not change it). **Unverified:** whether the desktop's own TypeScript client pays the same on
   Linux. It is a one-line change there too.
3. **`PR_SET_PDEATHSIG` fixes the orphan problem instead of detecting it.** The Electron app only notices an orphan at its next start. On
   Linux the child can be told to die with its parent: Meilisearch was gone 54 ms after the app was `SIGKILL`ed. It is the counterpart of the
   Windows design's Job Object (which compiled and never ran). **Caveat that bites:** the signal fires when the *thread* that spawned the
   child exits, not the process, so the app must spawn it from its main thread (or a thread that outlives everything). The pid-file reaper
   stays as the second line of defence. The Flatpak sandbox's effect on this is **unverified**.
4. **A zombie looks alive.** `kill(pid, 0)` succeeds on a zombie, and a container's PID 1 does not reap. The kill tests need `docker run
   --init`; a real session has a real init.

## The binary used, and the pin Linux needs

| | |
|---|---|
| File | `meilisearch-linux-aarch64`, v1.53.1, community build |
| Source | `https://github.com/meilisearch/meilisearch/releases/download/v1.53.1/meilisearch-linux-aarch64` |
| Size | 127,575,104 bytes |
| SHA-256 | `c156cbf7914c7af737422bcb60196366e9f9680a7ebd19ea5fd78fdaf7ac1256`, from GitHub's own asset digest; the download matched, or it would have been deleted |
| Approval | Downloaded with the user's explicit yes in chat, into the session's scratch folder; run only in the throwaway container; never committed |
| The macOS binary | The one already in `apps/desktop/resources/meilisearch/mac-arm64/`, whose SHA-256 equals `meilisearch.lock.json`'s |

`apps/desktop/meilisearch.lock.json` has `linux-x64` and no `linux-arm64`; its validator `meilisearch-lock.mjs` accepts only
`mac-(arm64|x64)` and `linux-x64`. For the native app to bundle for arm64 the lock needs this entry and the validator's pattern needs
`linux-arm64` (the `linux-amd64` digest GitHub shows is the desktop's existing pin, `cd8e446b...`, which is a useful cross-check that the digest field can be
trusted). **Neither file was edited here** (`apps/desktop` is not this session's to change):

```json
"linux-arm64": {
  "name": "meilisearch-linux-aarch64",
  "sha256": "c156cbf7914c7af737422bcb60196366e9f9680a7ebd19ea5fd78fdaf7ac1256",
  "size": 127575104
}
```

## Not covered

- x86-64 Linux (the amd64 binary was not run, not even emulated); a Flatpak or `.deb` sandbox; Ubuntu 24.04 AppArmor; a real desktop session
  (the container is not one).
- `meilisearch-sdk` or another client crate: the ten REST calls were written by hand over `ureq` 3.5.1 (a blocking client); the desktop uses
  the official JavaScript SDK. Which Rust client the app uses is open.
- Running it from the GTK app: no GTK was involved. The supervisor must be started from the main thread (item 3), and search calls moved off it.
- Index upkeep after the first build (`indexNote`, `deleteNote` were written and not exercised), the `data_version` poll for foreign writes,
  rebuilding when a restore replaces the database.
- Licence notices: the desktop's build warns that the Meilisearch **Rust-crate licence list is not generated yet and calls that a release
  blocker for a public release** ([desktop-build-and-release.md](../../../../docs/desktop-build-and-release.md)); the same holds here.
