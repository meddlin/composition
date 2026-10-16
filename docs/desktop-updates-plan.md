# Desktop over-the-air updates: design and plan

Today a new desktop release means downloading the DMG from GitHub by hand
([desktop-build-and-release.md](desktop-build-and-release.md)). This page is the design for the
desktop app updating itself from GitHub Releases, and the order we build it in.

## Decisions (2026-10-14)

| # | Decision | Why |
|---|---|---|
| U1 | **`electron-updater`** (the library that ships with electron-builder), reading a **generic feed** at `https://github.com/meddlin/composition/releases/latest/download/`. | electron-builder already writes `latest-mac.yml` and `.blockmap` files; we only have to upload them. "latest" is a GitHub redirect, so no server, no API token, no rate limits, and no third party between us and users. |
| U2 | **Not** electron-updater's `github` provider. | It parses each release tag as semver (`/\/tag\/(v?[^/]+)$/`), so `desktop-v0.1.3` is skipped whenever pre-releases are allowed, and "latest" would break if the repo ever releases something else. The generic feed doesn't care about tag names. |
| U3 | **Not** `update.electronjs.org`. | Needs `-mac`/`-darwin`/`-osx` in ZIP names (ours have none, so every Mac would be treated as Intel), and it's a hosted service whose tag handling we couldn't confirm. |
| U4 | **Ask before downloading, ask before restarting.** Nothing downloads or restarts without a click. A downloaded update also installs on the next normal quit. | The notes app must never restart under someone mid-thought, and an update is 100+ MB. |
| U5 | **Checks are on by default**, with a Settings toggle. Each check contacts github.com; the app is otherwise fully local, so the toggle and a one-line explanation of what is contacted are part of the feature. | Opt-in would leave most installs permanently stale. |
| U6 | **Only normal releases update, unless the person opts in (U8).** The feed follows GitHub's "latest release", which ignores pre-releases and drafts. Releases are published as normal (non-pre-release) from now on; versions with a `-` suffix remain pre-releases and are never offered. | Publishing a draft is already the "check it first" gate; it now also means "ship it to everyone". |
| U7 | **Update state lives in its own file** (`<userData>/updates.json`), not the shared settings file. | The settings file is shared with the web app and CLI; an update toggle is meaningless to them. |
| U8 | **"Include pre-release versions" is an opt-in toggle** (off by default, stored in `updates.json` beside U7's flag). When on, the app asks `api.github.com/repos/meddlin/composition/releases` for the newest published `desktop-v*` release of any kind and points the generic provider at that release's download folder, with the channel taken from its update file's name (`latest-mac.yml` is `latest`, `beta-mac.yml` is `beta`). Turning it off points back at the U1 feed. Code: `releaseFeed.ts`, `UpdateManager.pointUpdaterAtFeed`. | The "latest release" redirect (U1) can never return a pre-release, and the `github` provider can't read our tags (U2). Listing releases ourselves keeps the generic provider and needs no token (60 unauthenticated requests an hour is plenty at one check per six). The toggle widens what is contacted from github.com to api.github.com, which the Settings text says. A pre-release never downgrades a newer stable build. |

## How it works

```
launch + every 6h        Settings / app menu
        |                       |
        v                       v
   UpdateManager (src/main/updates.ts)  -- state: idle | checking | available
        |                                          | downloading | ready | error
        |  electron-updater (autoDownload = false)
        v
   https://github.com/meddlin/composition/releases/latest/download/latest-mac.yml
        |  names Composition-<ver>-<arch>.zip + sha512 + blockmap
        v
   download (differential when possible) -> Squirrel.Mac verifies the code signature
        v
   "Restart to update"  ->  stop Meilisearch, close the DB, quitAndInstall
```

- Authenticity comes from code signing: Squirrel.Mac refuses an update not signed by the same
  Developer ID as the running app. The `sha512` in `latest-mac.yml` guards against corruption.
- `UpdateManager` takes its updater, clock, persistence and timers as parameters, so the whole
  state machine is unit tested without Electron (the `backup.ts` / `meili.ts` style).
- The update API is desktop-only, like attachments and backup: `window.composition` gets
  `getUpdateState`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `setAutoCheckUpdates`
  and `onUpdateState`. The renderer never supplies a URL or a path; the feed URL is fixed in
  `electron-builder.yml`.
- **Quit handling.** `src/main/index.ts` intercepts `before-quit` to stop Meilisearch and close
  the database. For an update we run that same cleanup *first*, then call `quitAndInstall`, so
  the update never depends on how Squirrel interacts with a prevented `before-quit`.
- Not packaged (dev), or not macOS: the manager reports `supported: false` with a reason and
  never touches the network.

## Build order

1. **Core**: `src/main/updates.ts` + tests (state machine, schedule, persistence).
2. **Wiring**: IPC contract (`updatesApi.ts` in the web lib, validators, `ipc.ts`, preload, push
   channel), `index.ts` (create the manager, check schedule, quit preparation, "Check for
   Updates…" in the app menu).
3. **UI**: a Settings "Updates" section (version, state, buttons, toggle), web build shows
   nothing; a small "Update available" indicator in the sidebar footer linking to it.
4. **Pipeline**: `publish` block in `electron-builder.yml`; `release.mjs` (passing `--publish never`) and
   `release-desktop.yml` upload `latest-mac.yml` and the blockmaps, and `release.mjs` verifies
   both architectures are named in `latest-mac.yml`; docs and feature matrix updated.
5. **Real-world test** (needs your signing identity): build 0.1.4 signed, install it, publish
   a draft-then-normal 0.1.5, and watch the app offer, download and install it.

## Status (2026-10-14)

Steps 1 to 4 are built and tested. Checked on this branch: unit tests (desktop, web, repo scripts);
an unsigned `pnpm release --unsigned` for both architectures, which produced `latest-mac.yml`
naming both ZIPs plus every blockmap, with `app-update.yml` and `electron-updater` inside the app;
and the packaged-app smoke test, which now covers the Updates screen, the bridge surface and the
preference file.

**Not verified: step 5.** Squirrel.Mac only applies signed updates, and a feed needs two real
releases, so only you can run this:

1. Publish a signed `0.1.4` as a **normal** release (it is the first build that can update itself;
   0.1.3 users install it by hand once). Install it into `/Applications`.
2. Bump to `0.1.5`, release it the same way, publish as a normal release.
3. Open 0.1.4: Settings > Updates > Check for updates. Expect "Version 0.1.5 is available".
4. Download, then Restart to update. Expect the app to come back as 0.1.5 with notes and search
   intact, and exactly one Meilisearch process.
5. Repeat, but choose **Later** and quit with Cmd+Q: the next launch should be 0.1.5.
6. Check an Intel Mac (or a Rosetta launch) against the same release.
7. Differential downloads: not checked. `latest-mac.yml` has no `blockMapSize`; if the 0.1.4 to
   0.1.5 download is the full ~220 MB, that is the expected fallback, just slower.

## Risks and open items

- **Existing releases (0.1.0 to 0.1.3) are all pre-releases** and don't carry `latest-mac.yml`.
  The first release built with this feature (0.1.4) can't update itself *to* anything until a
  later normal release exists, and 0.1.3 users must install 0.1.4 by hand once. After that it's
  automatic.
- **End-to-end needs a signed, packaged build.** Unit tests cover the logic; step 5 is the only
  proof that Squirrel.Mac accepts our update, and it can't run in CI.
- **Intel** is cross-built in CI only; test arm64 first, then x64 from a CI release.
- **Downgrade and rollback.** None. A bad release is fixed by a newer release, and by editing
  the release back to draft so "latest" points at the previous one.
- **Meilisearch format changes.** An update that bumps the bundled Meilisearch needs the index
  rebuilt; the sidecar already reindexes, but confirm when upgrading its pinned version.
- **Database schema.** The app, CLI and web share `composition.db`; an auto-updated desktop may
  migrate the schema ahead of the other two. Not new, but updates make it more likely.
