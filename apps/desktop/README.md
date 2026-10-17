# Composition desktop app

The Composition web UI in Electron, for macOS. It is the same notes workspace, the same
shadcn/ui components, Tailwind styling and color schemes as `apps/web`, with no server to run and a bundled
Meilisearch for search. Plan, decisions and status: [docs/desktop-app-plan.md](../../docs/desktop-app-plan.md).

## How it fits together

```
renderer (sandboxed, app://composition/)   static export of apps/web
    │  window.composition  (contextBridge, preload.ts)
    ▼
main process                               IPC, validated and sender-checked
    ├── service.ts (from apps/web)         the same code the web app's Server Actions call
    │       └── SQLite  ~/.composition/composition.db   (shared with the CLI and web app)
    └── Meilisearch (bundled binary)       127.0.0.1, random port, own master key

Contents/Resources/cli/                    the `composition` terminal app (apps/cli), see below
```

- **The UI is `apps/web`.** `COMPOSITION_TARGET=desktop next build` makes a static export; files
  named `*.desktop.*` replace their web counterparts in that build only (see
  `apps/web/next.config.ts`). The desktop build has no `/docs` page.
- **The data layer is `apps/web/src/lib/composition`.** `src/main/backend.ts` is the only file
  here that reaches into `apps/web`.
- **The UI talks to the backend through one contract**, `CompositionApi`
  (`apps/web/src/lib/composition/api.ts`): Server Actions in the web app, Electron IPC here.

## Commands

Run `pnpm install` in `apps/web` first: the desktop build bundles code and styles from it.

| Command | What it does |
|---|---|
| `pnpm dev` | `next dev` (hot reload) plus Electron. Uses your real notes; `COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm dev` uses a scratch home instead. Needs `meilisearch` on `PATH` (`brew install meilisearch`) for search. |
| `pnpm test` | Unit tests (Vitest). `pnpm typecheck` for types. |
| `pnpm build` | Static renderer + main and preload bundles + license notices, into `dist/`. |
| `pnpm smoke` | Launches the built app and drives it end to end against a throwaway `HOME`. Never touches real notes. |
| `pnpm package` | Unsigned, unpacked `.app` in `release/`. For checking a build. |
| `pnpm dist` | Signed and notarized DMG and ZIP for this Mac's architecture. Needs the credentials below. |
| `pnpm release` | Signed, notarized and verified DMG and ZIP for both architectures, plus checksums; warns about missing requirements first (`--check` only checks, `--unsigned` skips signing). The release workflow runs the same script. |
| `pnpm fetch:meilisearch` | Downloads the pinned, checksum-verified Meilisearch binaries (about 116 MiB each) into `resources/meilisearch/`. |
| `pnpm fetch:node` | Downloads the pinned, checksum-verified Node 26 (about 57 MiB each) into `resources/node/`, for the command line tool. |
| `pnpm stage:cli` | Builds `apps/cli` and assembles the command line tool for each architecture in `resources/cli/` (needs `apps/cli` installed and `pnpm fetch:node` run). |

Check a packaged build end to end:

```bash
pnpm package
SMOKE_EXECUTABLE="$PWD/release/mac-arm64/Composition.app/Contents/MacOS/Composition" pnpm smoke
```

## Where things live on disk

| What | Where |
|---|---|
| Notes database | `~/.composition/composition.db` (shared with the CLI and web app, for now; [product-builds.md](../../docs/product-builds.md)) |
| Attached files | `~/.composition/attachments/` (desktop only; [docs/architecture/attachments.md](../../docs/architecture/attachments.md)) |
| Desktop settings | `~/Library/Application Support/Composition/settings.json` |
| Search index, key, log | `~/Library/Application Support/Composition/search/` |

## Meilisearch

The app bundles a **community-edition** Meilisearch (MIT). `meilisearch.lock.json` pins the
version and SHA-256 per architecture; the test suite rejects any `enterprise` asset (the
Enterprise Edition isn't allowed in production without a commercial agreement). Where the app
finds the binary: `COMPOSITION_MEILI_BIN`, then `Resources/meilisearch` when packaged, then
`meilisearch` on `PATH` in development. If it can't start, notes keep working and search says
why it's unavailable.

License notices for everything shipped are assembled into `Resources/licenses` by
`scripts/collect-licenses.mjs`. The license list for the Rust crates inside the Meilisearch
binary still has to be generated (it warns until then).

## The command line tool

The app also ships the terminal app (`apps/cli`) so one install gives both. It lives in
`Contents/Resources/cli/`:

```
composition     launcher script: finds its own folder (through symlinks), points search at the
                app's Meilisearch (COMPOSITION_MEILI_BIN) and runs the bundled node
node            Node 26 (node.lock.json), because Electron's own Node has no node:ffi
app/            apps/cli's bundle and a production-only node_modules for this architecture
```

**Installing the `composition` command.** A disk image can only copy the app, so the app's menu has
**Composition > Install Command Line Tool…**. It symlinks the launcher into the first of
`/opt/homebrew/bin`, `/usr/local/bin` (only if they exist and are writable) or `~/.local/bin` (created),
so it needs no password. Choosing it again offers to uninstall. It refuses an app that is running from
a disk image or another volume, and never replaces a file or link it didn't make
(`src/main/cliTool.ts`, tested on temporary folders). The link survives updates because the app is
replaced in place.

**What is shared with the desktop app.** The database (`~/.composition/composition.db`), pasted images
and attachments. Not shared: settings files and the Meilisearch index ([docs/product-builds.md](../../docs/product-builds.md)).

**Building it.** `pnpm release` does everything. By hand: `pnpm fetch:node`, install `apps/cli`, then
`pnpm stage:cli`, then `pnpm package` / `pnpm dist`. `scripts/stage-cli.mjs` installs the CLI's
production dependencies from `apps/cli`'s own lockfile once per architecture (pnpm's
`supportedArchitectures` fetches the other Mac's native packages), drops type-only packages and the
foreign-platform prebuilds, and checks with `lipo` that every native file matches. `pnpm release`
then checks the packaged app: the launcher is there, its Node matches the app's architecture, and
`composition --version` runs; when signing, that every Mach-O file under `cli/` is signed and the
bundled Node has the hardened runtime.

## Signing and releases

Credentials are read from the environment, never from files:
`CSC_LINK` and `CSC_KEY_PASSWORD` (Developer ID Application certificate) and `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (notarization). The app identifier in
`electron-builder.yml` is `com.rushinglabs.composition`; don't change it after the first release.

Getting the certificate and API key, building by hand, and releasing from GitHub Actions (a
`desktop-v*` tag push): [docs/deployment/manual-build-release.md](../../docs/deployment/manual-build-release.md).

## Updates

The packaged app updates itself from GitHub Releases ([design](../../docs/desktop-updates-plan.md)).
`src/main/updates.ts` is the state machine (tested without Electron), `src/main/updater.ts` the
Electron side, and Settings > Updates the UI. The feed URL is `publish` in `electron-builder.yml`.
A development run reports "not supported" and never touches the network. `pnpm release` also
writes and checks `latest-mac.yml`, which every release must carry; only a normal (non-pre-release)
published release is offered to installed apps.

## Things worth knowing

- **Node floor for better-sqlite3 13.** This app uses v13 (N-API), which needs Node >= 22.14
  and crashes on older Node. It only ever loads inside Electron (Node 24), so it's unaffected.
  The web app stays on v12. Details: [desktop-app-research.md](../../docs/desktop-app-research.md).
- **Electron downloads on first use.** Electron 44 has no install script; the first `pnpm dev`,
  `pnpm smoke` or `pnpm package` fetches the binary.
- **Apps launched from Finder start in `/`, which is read-only.** Anything that writes relative
  to the working directory fails there. Meilisearch writes `./dumps` by default and died at
  startup this way, so it now gets explicit directories (`src/main/meili.ts`) and `pnpm smoke`
  always launches the app from `/` to catch a regression.
- **`pnpm pack` is not the packaging command.** It's a built-in that makes an npm tarball; use
  `pnpm package`.
