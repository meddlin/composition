# Desktop app: from `git pull` to a GitHub Release

A runbook for testing and building the Electron app in `apps/desktop`, then publishing the
binary to GitHub Releases. Background and decisions live in [desktop-app-plan.md](desktop-app-plan.md);
the command reference is [apps/desktop/README.md](../apps/desktop/README.md).

**macOS only.** Run every command from the repository root unless a step says otherwise.

## What works today, and what doesn't

| Part | Status |
|---|---|
| Install, test, build, smoke test, unsigned `.app` | Works. Verified 2026-09-30. |
| Unsigned DMG/ZIP, uploaded by hand | Steps 7 and 8 below. Not yet run end to end: check the output before you upload it. |
| Signed and notarized DMG | **Blocked** on Apple Developer credentials (Phase 0 of the plan). |
| Tag-triggered release workflow | **Not built.** There is no release workflow in `.github/workflows/`, so every release is manual for now. |

An unsigned build is fine for your own testing and for a **draft** release you hand to a few
people. Do not publish it as a normal release: macOS Gatekeeper will warn or refuse to open it
(see [What users will see](#what-users-will-see-with-an-unsigned-build)).

## Prerequisites (one time)

- macOS, `git`, [pnpm](https://pnpm.io) 11 (the version is pinned by `packageManager` in `package.json`).
- Node >= 22.14 is recommended on the machine. The desktop app itself isn't affected by an older
  Node (better-sqlite3 13 only loads inside Electron's own Node), but the web app's install
  and build run on your local Node. See [Things worth knowing](../apps/desktop/README.md#things-worth-knowing).
- [`uv`](https://docs.astral.sh/uv/) if you want to run the CLI tests as part of `pnpm test`.
- The [GitHub CLI](https://cli.github.com) (`gh`), signed in with write access to `meddlin/composition`:
  ```bash
  gh auth status
  ```
- `brew install meilisearch` is only needed for `pnpm dev` (search). Packaged builds bundle their own.

## 1. Pull and install

```bash
git checkout main
git pull
pnpm --dir apps/web install --frozen-lockfile
pnpm --dir apps/desktop install --frozen-lockfile
```

Install `apps/web` **first**: the desktop build bundles code and styles from it, and
`build-renderer.mjs` exits with an error if `apps/web/node_modules` is missing.

The first command that needs Electron (`dev`, `smoke`, `package`) downloads its binary, so it is slower.

## 2. Run the unit tests

```bash
pnpm test
```

This runs, in order: the repo scripts, the CLI (pytest), the web app (Vitest), then the desktop
type check and unit tests. To test only the desktop app:

```bash
pnpm test:desktop
```

Also run the pinning check if you touched anything in `.github/` (repo rule in [AGENTS.md](../AGENTS.md)):

```bash
pnpm lint:actions
```

## 3. Try it by hand (optional)

```bash
cd apps/desktop
COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm dev
```

`next dev` runs on port 3100 with hot reload and Electron opens against it. `COMPOSITION_DEV_HOME`
points the app at a scratch home so your real notes in `~/.composition` are not touched. Press
Ctrl+C to stop both processes.

## 4. Build

```bash
cd apps/desktop
pnpm build
```

This runs three scripts: the static renderer export of `apps/web`, the esbuild bundles for the main
and preload processes, and the license notices collector. Output goes to `apps/desktop/dist/`.

The license step warns that the Rust-crate license list for Meilisearch is not generated yet. That
warning is a **release blocker for a public release**, not for local testing.

## 5. Smoke test the built app

```bash
pnpm smoke
```

Launches the built app with Playwright against a throwaway `HOME`, from `/` (as Finder would), and
prints `PASS`/`FAIL` per check. It never touches real notes. Set `SMOKE_OUT=/some/dir` to keep the
screenshots. Fix any `FAIL` before going on.

## 6. Fetch Meilisearch and package the `.app`

Packaged builds bundle Meilisearch from `resources/meilisearch/<os>-<arch>/`. That folder is
gitignored, so a fresh clone has none:

```bash
pnpm fetch:meilisearch mac-arm64      # Apple Silicon; omit the argument for both architectures
```

About 116 MiB per architecture. Each download is checked against the SHA-256 in
`meilisearch.lock.json`; a mismatch deletes the file and fails the run. The lock pins the
**community** (MIT) build. Never swap in an `enterprise` asset.

Then package and smoke test the real bundle:

```bash
pnpm package
SMOKE_EXECUTABLE="$PWD/release/mac-arm64/Composition.app/Contents/MacOS/Composition" pnpm smoke
```

`pnpm package` produces an unsigned, unpacked `.app` in `apps/desktop/release/`. It is for checking
a build, and is not something you upload. (Use `pnpm package`, not `pnpm pack`, which makes an npm tarball.)

You can also open it: `open release/mac-arm64/Composition.app`.

## 7. Produce the release artifacts

Decide the version, then set it in `apps/desktop/package.json` (`"version"`); electron-builder
names the files from it. Commit that change.

**Unsigned (what you can do today)**, from `apps/desktop`:

```bash
pnpm build
pnpm exec electron-builder -c.mac.identity=null
ls release/*.dmg release/*.zip
```

This is `pnpm package` without `--dir`, so it also builds the DMG and ZIP targets from
`electron-builder.yml`. Add `--x64` or `--arm64` to choose an architecture (fetch that
architecture's Meilisearch first). Check the output names with `ls`: electron-builder picks them.

**Signed and notarized (once credentials exist):**

```bash
export CSC_LINK=...            # Developer ID Application certificate (.p12 path or base64)
export CSC_KEY_PASSWORD=...
export APPLE_API_KEY=...       # App Store Connect API key (.p8 path)
export APPLE_API_KEY_ID=...
export APPLE_API_ISSUER=...
pnpm dist
```

Credentials come from the environment only, never from files in the repo. Confirm the app
identifier in `electron-builder.yml` is final before the first public release: it is part of the code
signature, and changing it later orphans existing installs.

Before you upload, verify the signature if you signed it:

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Composition.app
spctl --assess --type execute --verbose release/mac-arm64/Composition.app
```

## 8. Publish to GitHub Releases

Tag convention from the plan: `desktop-v<version>`. Create a **draft** first so you can check it
before anyone sees it.

```bash
cd apps/desktop
VERSION=$(node -p "require('./package.json').version")
TAG="desktop-v$VERSION"

# Checksums to publish alongside the binaries
(cd release && shasum -a 256 *.dmg *.zip > SHA256SUMS.txt)

# The version bump must be on GitHub before the release points at it. A draft release
# doesn't create its tag until you publish it.
git push origin main

gh release create "$TAG" \
  --repo meddlin/composition \
  --target main \
  --draft \
  --title "Composition desktop $VERSION" \
  --notes "macOS desktop build. See docs/desktop-build-and-release.md." \
  release/*.dmg release/*.zip release/SHA256SUMS.txt
```

For an unsigned build, add `--prerelease` and say so in `--notes` (for example "Unsigned build;
see the release notes for how to open it"). Then:

1. Open the draft in the browser (`gh release view "$TAG" --web`) and check the assets, the notes and
   that the file sizes look right.
2. Download the DMG *from the draft* onto a Mac that has not built the app, install it and open it.
3. Publish: `gh release edit "$TAG" --draft=false`.

To add a forgotten file to an existing release: `gh release upload "$TAG" <file> --clobber`.

## What users will see with an unsigned build

macOS quarantines downloaded files. An unsigned app is blocked by Gatekeeper: on recent macOS the
user has to open **System Settings > Privacy & Security** and choose **Open Anyway**, or run
`xattr -dr com.apple.quarantine /Applications/Composition.app`. Only mention the second option to
people who know and trust where the file came from. If a downloaded build reports "damaged",
that is the same signature problem, and it goes away only with signing and notarization.

## Checklist before a public (non-draft, non-pre-release) release

- [ ] Developer ID certificate and App Store Connect API key exist, and the build is signed and notarized.
- [ ] `codesign` and `spctl` checks above pass; the packaged smoke test passes.
- [ ] The app identifier in `electron-builder.yml` is final.
- [ ] The Meilisearch Rust-crate license list is generated and shipped
      (see [Licensing Meilisearch](desktop-app-plan.md#licensing-meilisearch)).
- [ ] The repo has a `LICENSE` file. It has none today, so the app's own license is undefined.
- [ ] The app icon is in place (not done yet; see Phase 6 of the plan).
- [ ] Both architectures are built if you want to support Intel Macs (`mac-x64`).

## Later: automate it

The plan's Phase 5 describes the workflow this runbook stands in for: a macOS runner triggered by
a `desktop-v*` tag that builds per architecture, signs, notarizes and attaches the files to a draft
release, using the five signing secrets above. It needs the Apple credentials first. When you
write it, pin every `uses:` to a commit SHA and run `pnpm lint:actions`, then replace steps 6 to 8 here with a link to it.
