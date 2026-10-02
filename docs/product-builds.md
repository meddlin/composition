# Product builds and data storage

Composition is shipped as three products from one repo. This page records which data store
each one uses **today**, which it is **meant to use later**, and what the difference costs, so
the gap is written down instead of remembered.

## The products

| Product | Path | Stack | Distribution |
|---|---|---|---|
| CLI | `apps/cli` | TypeScript, OpenTUI (React), Node 26.10+ | Undecided (see the distribution question in [index.md](index.md)) |
| Web | `apps/web` | Next.js | Undecided |
| Desktop | `apps/desktop` | Electron | **GitHub Releases, manual download, macOS only for now** ([plan](desktop-app-plan.md)) |

## Data storage: today

**Everything shares one database, `~/.composition/composition.db`.** That is the CLI's
default, the web app's default (`DEFAULT_APP_DATA_DIR` in `apps/web/src/lib/composition/paths.ts`),
and the desktop app's default. All three open it through the same data layer, `apps/web/src/lib/composition`.

Shared: the SQLite file.
Not shared, on purpose: each product's settings file and each product's Meilisearch index.
The index is derived data that any product rebuilds from SQLite ([search.md](architecture/search.md)).

| | CLI | Web | Desktop |
|---|---|---|---|
| Database | `~/.composition/composition.db` | same | same |
| Settings | `~/.composition-cli/settings.json` | `~/.composition-web/settings.json` | `~/Library/Application Support/Composition/settings.json` |
| Meilisearch data | `~/.composition/meili_data` | `~/.composition-web/meili_data` | `~/Library/Application Support/Composition/search/meili_data` |
| Meilisearch process | Spawned by the CLI, random port | Started by hand (`pnpm meili`), port 7700 | Spawned by the app (bundled binary), random port, own master key |

The desktop app deliberately does **not** use the CLI's `meili_data`: two server processes on
one index directory would collide whenever both apps are open. The consequence is that an edit
made in the CLI while the desktop app is closed is missing from the desktop index until the app
next starts, when it rebuilds its index from SQLite (as it also does after the data location is
changed in Settings). An edit made in the CLI *while the desktop app is open* does not appear in
desktop search until the next launch.

### What sharing costs right now

- **Several writers on one file.** SQLite WAL mode is set by `db.ts` and is stored in the file
  header, so it covers every writer. The desktop app holds a single-instance lock, so there is
  never more than one desktop writer; a terminal app and a web server can be open at the same time.
- **The schema lives in one place.** Column migrations are additive `ALTER TABLE` checks in
  `db.ts` (`ensureColumn`), which the terminal, web and desktop apps all run. (Until the CLI was
  rewritten in TypeScript there was a second copy in Python, and every schema change had to land in
  both.) `db.test.ts` opens databases as each earlier version created them. The remaining cost is
  that the three apps reach that file by relative import rather than from a package: see
  [shared-core-plan.md](shared-core-plan.md).
- **Different Node versions.** The terminal app needs Node 26.10 or newer (OpenTUI uses `node:ffi`);
  web runs on Node 22 and desktop on Electron's bundled Node. `better-sqlite3` is a native module
  built per Node, so each app resolves its own copy: the CLI's bundle and its tests load the CLI's.
  Version 12 is used because it supports all of them.

## Data storage: later

| Group | Shares a database | Why |
|---|---|---|
| **Desktop + CLI** | One database, on the user's machine | Both are local-first apps on the same computer. |
| **Web** | Its own database | The web app is a separate product and should not depend on the local files. |

Not decided yet, and deliberately out of scope until the split happens: where the web
database lives, whether the two databases ever sync, and whether the schema stays identical
across them.

### What the split will touch

It is mostly configuration, and small:

- The web app already reads its location from settings (`appDataDir`, or an explicit
  `dbPath`), so pointing it at its own file needs no code change. What changes is the
  **default**: `DEFAULT_APP_DATA_DIR` in `paths.ts` currently points at the terminal app's directory.
- `searchIndex.ts` reads the Meilisearch master key from the CLI's
  `~/.composition/meili_master_key` regardless of the configured data directory. That is a
  second hard-coded coupling to remove at the same time.
- Migrations are already in one place (`db.ts`), so a split would not duplicate them; the
  shared-core move would make that place a package.
- Desktop and CLI keep sharing the file, so the single-instance lock, WAL mode and
  schema-in-two-places rule continue to apply to them.

## Decisions recorded

- 2026-09-30: macOS only for now; Windows and Linux builds come later.
- 2026-09-30: for now all products share `composition.db`; this page is the record of the
  intended later split.
- 2026-09-30: the desktop app bundles Meilisearch in v1.
- 2026-09-30: desktop releases are manual downloads from GitHub Releases; no auto-update yet.
