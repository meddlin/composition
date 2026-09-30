# Product builds and data storage

Composition is shipped as three products from one repo. This page records which data store
each one uses **today**, which it is **meant to use later**, and what the difference costs, so
the gap is written down instead of remembered.

## The products

| Product | Path | Stack | Distribution |
|---|---|---|---|
| CLI | `apps/cli` | Python, Textual | Undecided (see the PyPI question in [index.md](index.md)) |
| Web | `apps/web` | Next.js | Undecided |
| Desktop | `apps/desktop` (planned) | Electron | **GitHub Releases, manual download, macOS only for now** ([plan](desktop-app-plan.md)) |

## Data storage: today

**Everything shares one database, `~/.composition/composition.db`.** That is the CLI's
default, the web app's default (`DEFAULT_APP_DATA_DIR` in `apps/web/src/lib/composition/paths.ts`),
and the desktop app's planned default.

Shared: the SQLite file.
Not shared, on purpose: each product's settings file and each product's Meilisearch index.
The index is derived data that any product rebuilds from SQLite ([search.md](architecture/search.md)).

| | CLI | Web | Desktop (planned) |
|---|---|---|---|
| Database | `~/.composition/composition.db` | same | same |
| Settings | `~/.composition/settings.yaml` | `~/.composition-web/settings.json` | its own file |
| Meilisearch data | `~/.composition/meili_data` | `~/.composition-web/meili_data` | its own directory |
| Meilisearch process | Spawned by the CLI, random port | Started by hand (`pnpm meili`), port 7700 | Spawned by the app, random port |

Desktop must **not** point its Meilisearch at the CLI's `meili_data`: two server processes on
one index directory would collide whenever both apps are open.

### What sharing costs right now

- **Several writers on one file.** SQLite WAL mode is set by the web app's `db.ts` and is
  stored in the file header, so it covers the other writers too. The desktop app should also
  hold a single-instance lock.
- **Schema changes land twice.** Column migrations are additive `ALTER TABLE` checks
  implemented separately in Python (`storage.py`, `_ensure_*_column`) and TypeScript
  (`db.ts`, `ensureColumn`). While the file is shared, any schema change must be made in both,
  or the product that is not updated will quietly run against a schema it does not know.

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
  **default**: `DEFAULT_APP_DATA_DIR` in `paths.ts` currently points at the CLI's directory.
- `searchIndex.ts` reads the Meilisearch master key from the CLI's
  `~/.composition/meili_master_key` regardless of the configured data directory. That is a
  second hard-coded coupling to remove at the same time.
- The duplicated migrations stop being a cross-product hazard for the web app, and remain one
  for desktop and CLI.
- Desktop and CLI keep sharing the file, so the single-instance lock, WAL mode and
  schema-in-two-places rule continue to apply to them.

## Decisions recorded

- 2026-09-30: macOS only for now; Windows and Linux builds come later.
- 2026-09-30: for now all products share `composition.db`; this page is the record of the
  intended later split.
- 2026-09-30: the desktop app bundles Meilisearch in v1.
- 2026-09-30: desktop releases are manual downloads from GitHub Releases; no auto-update yet.
