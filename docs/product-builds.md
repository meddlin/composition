# Product builds and data storage

Composition is shipped as three products from one repo. This page records which data store
each one uses **today**, which it is **meant to use later**, and what the difference costs, so
the gap is written down instead of remembered.

## The products

| Product | Path | Stack | Distribution |
|---|---|---|---|
| CLI | `apps/cli` | TypeScript, OpenTUI (React), Node 26.10+ | **Inside the macOS desktop app** (below); from source elsewhere |
| Web | `apps/web` | Next.js | Undecided |
| Desktop | `apps/desktop` | Electron | **GitHub Releases, manual download, macOS only for now** ([plan](desktop-app-plan.md)) |

## The CLI ships inside the desktop app

The macOS desktop installer also carries the terminal app, so one download gives both. In the app
bundle, `Contents/Resources/cli/` holds a launcher, a pinned **Node 26** and the CLI bundle with its
native modules; the app's **Install Command Line Tool…** menu item links `composition` onto the PATH.
Details and build steps: [apps/desktop/README.md](../apps/desktop/README.md#the-command-line-tool).

- **Why its own Node.** Electron 44 (and 45) bundle Node 24, and Electron's Node has no `node:ffi`,
  which OpenTUI needs (Node 26.1+, on by default from 26.10). So the bundle carries the official
  Node 26 beside Electron. Re-check `import("node:ffi")` under `ELECTRON_RUN_AS_NODE=1` on each
  Electron major; if it ever works, that Node can go.
- **Signing.** Everything under `Contents/Resources/cli` is signed with the same Developer ID
  certificate as the app and notarized in the same submission (`pnpm release` verifies it).
- **Versions and updates.** The CLI is released with the desktop app: its version in the bundle is
  whatever `apps/cli` had at the desktop tag, and the app's updater replaces it along with everything else.
- **Same database, same version.** A combined install can never have the CLI and desktop disagree
  about the schema, since they ship together. Both use better-sqlite3 13 (N-API).
- **macOS only.** A Linux CLI still runs from source.

## Data storage: today

**Everything shares one database, `~/.composition/composition.db`.** That is the CLI's
default, the web app's default (`DEFAULT_APP_DATA_DIR` in `apps/web/src/lib/composition/paths.ts`),
and the desktop app's default. All three open it through the same data layer, `apps/web/src/lib/composition`.

Shared: the SQLite file, and the *location* of that file between the desktop and terminal apps
(see [One data location for desktop and CLI](#one-data-location-for-desktop-and-cli)).
Not shared, on purpose: each product's settings file (color scheme, city, column sizes and
favorites stay per app) and each product's Meilisearch index.
The index is derived data that any product rebuilds from SQLite ([search.md](architecture/search.md)).

| | CLI | Web | Desktop |
|---|---|---|---|
| Database | `~/.composition/composition.db` | same | same |
| Settings | `~/.composition-cli/settings.json` | `~/.composition-web/settings.json` | `~/Library/Application Support/Composition/settings.json` |
| Data location, as agreed between the apps | `~/.composition-location.json` | not read or written | `~/.composition-location.json` |
| Meilisearch data | `~/.composition/meili_data` | `~/.composition-web/meili_data` | `~/Library/Application Support/Composition/search/meili_data` |
| Meilisearch process | Spawned by the CLI, random port | Started by hand (`pnpm meili`), port 7700 | Spawned by the app (bundled binary), random port, own master key |

The desktop app deliberately does **not** use the CLI's `meili_data`: two server processes on
one index directory would collide whenever both apps are open. The consequence is that an edit
made in the CLI while the desktop app is closed is missing from the desktop index until the app
next starts, when it rebuilds its index from SQLite (as it also does after the data location is
changed in Settings). An edit made in the CLI *while the desktop app is open* does not appear in
desktop search until the next launch.

### One data location for desktop and CLI

Each app keeps its own settings file, and the data location (`appDataDir`, `dbPath`) is one of the
settings in it. With nothing else, moving the location in one app would leave the other opening
`~/.composition`, and the two would quietly stop sharing a database.

So the location alone is also kept in a small file both apps read and write,
`~/.composition-location.json`: `{ "appDataDir": "...", "dbPath": "..." }` (`dbPath` only when
set). It is outside every data directory, so relocating the data cannot strand it.
Implemented in `webSettings.ts`; each host opts in by setting `COMPOSITION_SHARED_LOCATION_PATH`
(as it sets `COMPOSITION_SETTINGS_PATH`). The web app does not, so it still answers to its own
settings alone.

- **Reading.** If the file exists and is valid, its location wins over the app's own setting, for
  `appDataDir` and `dbPath` together (a stale override in the app's own file is dropped). If it is
  missing or unreadable, each app uses its own setting, as before.
- **Writing.** Only a save that *changes* the location writes the file: moving the data in the
  CLI's Settings, or saving a new location in the desktop app's. Saving a color scheme or a
  favorite does not. The app's own file is written too, so deleting the shared file leaves both
  apps on the last agreed location and then free to diverge again.
- **Existing installs.** Nothing changes until someone moves the location. An install where the two
  apps already disagree (say, the desktop app was pointed at another folder earlier) stays that
  way until the next move in either app, which then brings both to that location.
- **Moving files.** The CLI moves the database, search data, images and attachments; the desktop app
  only repoints. Either way the *other* app follows on its next database call, but its
  Meilisearch index does not move with it (below), and it should not be open on the data while the
  CLI is moving files. Close the other app first.

### Search index drift between the apps

Each app has its own Meilisearch index, so a note edited in one app is missing from the other's
search until that app rebuilds its index from SQLite. Both apps do that when they start (the
shared `SearchSidecar`), and the desktop app also after its own data-location change. The gaps:

- an edit made in one app *while the other is open* stays out of the other's search until that
  app restarts;
- when the agreed location changes in the other app, a running app follows it for notes (the
  database connection re-resolves the location on every call) but its Meilisearch keeps indexing
  the old data directory, so its search describes the old database until it restarts.

Not built. Options, cheapest first:

1. Notice that the agreed location changed under a running app and restart its search sidecar there
   (the same restart the CLI already does after its own move).
2. Stamp the index with the database's `PRAGMA data_version` or the newest `updated_at` and compare
   it on focus or on a timer; rebuild when it moved.
3. Share one Meilisearch process (one app starts it and the other attaches). This needs a
   lock and handover when the owner quits, so it is the most work, and the index directory is only
   safe with one process on it.

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
- 2026-10-17: the desktop installer includes the CLI (own Node 26, launcher, Install Command Line Tool menu item), signed and notarized with the app; `apps/cli` moved to better-sqlite3 13 so one machine can stage both Mac architectures. Packaging via the existing release workflow, plus `package-desktop.yml` on pull requests.
- 2026-10-14: the desktop app updates itself from GitHub Releases (electron-updater, generic feed, asks before downloading and before restarting). Design: [desktop-updates-plan.md](desktop-updates-plan.md). Supersedes the line above.
- 2026-10-17: the desktop and terminal apps agree on the data location through
  `~/.composition-location.json`, written only when the location changes; everything else in their
  settings stays per app. The index drift above is documented, not fixed.
