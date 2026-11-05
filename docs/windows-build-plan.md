# Windows build: design and plan

Composition ships as a macOS desktop app with the terminal app (`composition`) inside it
([product-builds.md](product-builds.md)). This page is the design for the same thing on
**Windows 10 and 11, x64**: the Electron desktop app and the CLI, in one installer. Nothing here is
built yet. Dates are 2026-11-05.

**In scope:** desktop app + bundled CLI + bundled Meilisearch, an installer, in-app updates, signing,
CI and release.
**Out of scope:** Windows on Arm as a native build, the Microsoft Store / MSIX, the web app,
winget and Chocolatey (later, once releases are stable).

## What a Windows build is made of

| Piece | macOS today | Windows target |
|---|---|---|
| App | Electron 45, DMG + ZIP | Electron 45, **NSIS installer** (`.exe`) |
| Search | `meilisearch` per arch, from `meilisearch.lock.json` | `meilisearch.exe` (`meilisearch-windows-amd64.exe`) |
| CLI runtime | Node 26 `tar.gz`, `node` | Node 26 **`.zip`**, `node.exe` |
| CLI launcher | `sh` script, symlinked onto PATH | `.cmd` script, a directory on the user PATH |
| Native modules | better-sqlite3 13, `@opentui/core-darwin-*` | better-sqlite3 13 `win32-x64.node`, `@opentui/core-win32-x64` (`opentui.dll`) |
| Updates | `latest-mac.yml` + ZIP, Squirrel.Mac | `latest.yml` + installer, electron-updater's NSIS updater |
| Signing | Developer ID + notarization | Authenticode (see [W4](#decisions-to-make)) |

## What I checked

Facts, not assumptions (checked 2026-11-05):

- **Every binary we need exists for Windows x64.** Meilisearch v1.53.1 publishes
  `meilisearch-windows-amd64.exe` (community, 128,611,840 bytes, sha256 `1c242ec4…`). Node v26.12.0
  publishes `node-v26.12.0-win-x64.zip` (41,895,610 bytes, sha256 `50efaf01…`) and a bare
  `win-x64/node.exe`. better-sqlite3 13.0.3 ships `prebuilds/win32-x64.node`. `@opentui/core-win32-x64@0.7.0`
  ships `opentui.dll` (PE32+, x86-64). The lockfiles already resolve all of these.
- **Meilisearch has no Windows Arm64 binary** in v1.53.1 (only `windows-amd64`). That alone keeps a
  native Arm64 build out of scope.
- **The big unknown is the CLI.** OpenTUI [documents](https://opentui.com/docs/getting-started/runtime-support)
  native Windows artifacts, but its Node.js CI covers macOS arm64, Linux x64 and Windows x64 for *Core
  tests only*; packed-distribution runs are Linux only, and the page says an available artifact "doesn't
  prove runtime parity". We run OpenTUI on Node 26 `node:ffi`, a path nobody tests on Windows. The CLI
  README says "Windows is not supported yet" for the same reason. Step 0 exists to find out.
- **Artifact Signing** (Microsoft's code-signing service, renamed from Trusted Signing) issues public-trust
  certificates to organizations in the US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea,
  Singapore, Switzerland, Norway and Israel, but **individuals only in the US or Canada**. Identity
  validation takes 1 to 20 business days
  ([quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart)). electron-builder supports
  it through `win.azureSignOptions` ([docs](https://www.electron.build/docs/win)).
- **Only NSIS (and nsis-web) update through electron-updater.** MSI, MSIX, portable and plain archives write
  no update metadata ([docs](https://www.electron.build/docs/win)).
- **Not verified:** Electron 45's exact Windows floor (Chromium dropped Windows 7 and 8 years ago, so
  Windows 10 should be the floor; Step 0 confirms), Artifact Signing's price, and whether electron-builder
  installs the `Invoke-TrustedSigning` PowerShell module on a hosted runner by itself (Step 7 finds out).

## What has to change

The code is closer than it looks: `resolveMeiliBinary` already looks for `meilisearch.exe`,
`paths.ts` already expands `~\`, stored attachment names are reduced to `A-Za-z0-9_-`, backup file
names have no colons, the data mover already handles `EXDEV`, and `window-all-closed` already quits off
macOS. What is left is concentrated in four places.

### 1. Build scripts (`apps/desktop/scripts`)

| File | Problem on Windows |
|---|---|
| `meilisearch-lock.mjs`, `node-lock.mjs` | Platform keys are `^mac-(arm64\|x64)$`; the Node asset name is forced to `darwin-<arch>.tar.gz`. Need a `win-x64` key, a `.zip` name rule, and the same checks (no `enterprise`, sha256, size). |
| `fetch-meilisearch.mjs` | Saves the download as `meilisearch`; Windows needs `meilisearch.exe`. |
| `fetch-node.mjs` | Unpacks a `tar.gz` with `tar -xzf`. Windows ships a zip (Windows' `tar` reads zips, but the member paths differ: `node.exe` sits directly in the top folder, not in `bin/`). |
| `stage-cli.mjs` | `darwin` is hard-coded in `supportedArchitectures`, the prebuild name, `@opentui/core-darwin-*` and the `lipo` check. `spawnSync("pnpm")` fails on Windows without `shell: true` (it is `pnpm.cmd`). The "every native file is this architecture" check needs a PE-header version (machine `0x8664`). |
| `build-renderer.mjs`, `collect-licenses.mjs` | Both call `spawnSync("pnpm", …)` with no shell. On Windows that only works if a `pnpm.exe` is on PATH (`pnpm.cmd` is not found). The spike reports what the runner has; if it is only `.cmd`, `pnpm build` itself fails on Windows. |
| `release.mjs`, `release-lib.mjs` | macOS only (`codesign`, `notarytool`, Mach-O check, `latest-mac.yml`). Windows gets its own verification, not an edit to these. |
| `smoke.mjs` | Isolates the run with `HOME=<tmp>`; on Windows Node reads `USERPROFILE`, and Electron's own `home` and data folders may ignore env vars altogether (`dev.mjs` notes that its data folder ignores `$HOME`). Also uses `pgrep` and checks file mode `0600`, neither of which exists. |

### 2. The CLI inside the app

- **Launcher.** `cli/composition` is a `sh` script that follows symlinks. Windows needs a `composition.cmd`
  that finds its own folder (`%~dp0`), exports `COMPOSITION_MEILI_BIN`, and runs the bundled Node.
- **Do not put the Node folder on PATH.** On macOS only one symlinked file is exposed. If we add
  `resources\cli` to PATH on Windows, `node.exe` rides along and shadows the user's own `node`. So the
  Windows layout is `cli\bin\composition.cmd` (the only thing on PATH), `cli\composition-node.exe`,
  `cli\app\…`.
- **Rename the runtime to `composition-node.exe`.** Windows will not let an installer overwrite a running
  `.exe`. A person with the TUI open during an update would block the installer on `node.exe`, and the
  installer cannot safely kill every `node.exe` on the machine. A unique name lets the installer find and
  stop exactly ours. N-API addons resolve their symbols from whatever host loaded them (Electron relies on
  this), so the rename should be harmless; Step 0 checks it.
- **Getting on PATH.** Symlinks need admin or Developer Mode on Windows, so `cliTool.ts`'s approach does
  not port. See [W3](#decisions-to-make).
- **Menu.** `cliToolMenu.ts` and `updater.ts` only add their items on `darwin`, in the application menu.
  Windows has no application menu; the Linux branch's `appMenu.ts` already puts these items at the end of
  Help, and Windows reuses it.

### 3. The app's main process

- **`meili.ts` orphan handling does not work.** `reapOrphan` asks `ps -p <pid> -o command=` to confirm that
  a leftover process is ours before killing it. There is no `ps` on Windows, so the check returns an
  empty string and no orphan is ever reaped. That matters more here than on macOS: Windows file locking is
  mandatory, so an orphaned `meilisearch.exe` holding the LMDB index blocks the next start, and it
  also blocks the installer. Replace `commandLine(pid)` with a Windows branch (PowerShell
  `Get-CimInstance Win32_Process`; `wmic` is removed by default from current Windows 11).
- **A console window will flash.** `spawn` of a console program from a GUI app opens a console window
  on Windows unless `windowsHide: true`. Add it.
- **Stopping is a hard kill.** `child.kill("SIGTERM")` on Windows is `TerminateProcess`. Meilisearch's
  store (LMDB) is crash-safe and the index is derived data rebuilt from SQLite on start
  ([search.md](architecture/search.md)), so this is acceptable ([W8](#decisions-to-make)), but it
  becomes a test: kill during indexing, start again, search works.
- **`updater.ts`** refuses every platform but `darwin`. `releaseFeed.ts` only recognises `*-mac.yml`,
  which is how "Include pre-release versions" finds the channel; Windows uses `latest.yml` / `beta.yml`.
  The Linux branch already generalised this for `latest-linux.yml`; Windows adds one more pattern. The
  stable-feed contract test (`STABLE_FEED_URL` equals `publish.url`) is unchanged.
- **Updates must stop Meilisearch first.** `prepareToQuit` already stops it ahead of `quitAndInstall`
  (that was written for Squirrel.Mac). On Windows it becomes mandatory, not just tidy: a running
  `meilisearch.exe` under `resources\meilisearch\` fails the installer's file replacement.
- **`translucency.ts`** supports `darwin` only. Windows 11 has `backgroundMaterial: "mica"`, but v1
  stays opaque ([W9](#decisions-to-make)): `supported: false` already hides the Settings control.
- **App identity.** Add `app.setAppUserModelId("com.rushinglabs.composition")` so taskbar grouping and
  notifications use the right name and icon.

### 4. Repo hygiene

- **No `.gitattributes`.** A checkout on a Windows runner can turn LF into CRLF, which breaks tests and
  anything that reads fixtures. Add `* text=auto eol=lf` and `*.cmd text eol=crlf` before the first
  Windows run.
- **POSIX paths in tests.** About ten test files hard-code `/tmp`, `/Users/…`, `/Volumes` or
  `/Contents/Resources/cli` (`cliTool.test.ts`, `backup.test.ts`, `validate.test.ts`, `search.test.ts`,
  `ipc.test.ts`, `feedsController.test.ts`, `release-lib.test.ts`, web `backup.test.ts`,
  `attachmentNames.test.ts`, `BackupRestore.test.tsx`). Some are fixtures; some are real assumptions in the
  code under test, so a Windows test run is worth doing in its own right.
- **Docs that say "macOS only":** `desktop-app-plan.md`, `product-builds.md`, `feature-matrix.md`,
  `desktop-build-and-release.md`, `deployment/manual-build-release.md`, `apps/cli/README.md`.

## How the installer behaves

```
download Composition-<ver>-win-x64.exe  (NSIS, per-user, one click, no admin prompt)
   -> %LOCALAPPDATA%\Programs\Composition\
        Composition.exe
        resources\meilisearch\meilisearch.exe
        resources\cli\bin\composition.cmd        <- the only CLI file on PATH
        resources\cli\composition-node.exe
        resources\cli\app\…
        resources\licenses\…
   -> Start menu shortcut, "Apps & features" entry, uninstaller
data stays put on uninstall:
   %USERPROFILE%\.composition\composition.db   (shared with the CLI)
   %APPDATA%\Composition\                       (settings, search index, window state)
```

- **Per-user, not per-machine.** No UAC prompt to install or to update, and the install directory never
  changes, so a PATH entry for the CLI stays valid across updates. Per-machine would prompt for admin on
  every update.
- **Updates.** Same as macOS: the app checks `https://github.com/meddlin/composition/releases/latest/download/latest.yml`,
  asks before downloading, asks before restarting, stops Meilisearch, then electron-updater runs the new
  installer silently. The installer must also stop `composition-node.exe` (a custom NSIS macro) and
  clean up the PATH entry on uninstall.
- **Release assets** (in the same draft release as macOS and Linux): `Composition-<ver>-win-x64.exe`,
  its `.blockmap`, `latest.yml`, `SHA256SUMS-windows.txt`. File names are distinct from the other
  platforms', so one release holds all three feeds.

## Decisions to make

Recommendations are mine. W1 is decided (Linux first). **W4, W5 and W11 still need your input**; the rest I will proceed on unless you object.

| # | Decision | Recommendation | Why / what it costs |
|---|---|---|---|
| **W1** | **Sequencing with the Linux build.** The Linux work (`linux-ubuntu-desktop-install-e01053`) is uncommitted and edits the same ~20 files: `electron-builder.yml`, both lockfiles and their validators, `stage-cli.mjs`, `cliTool*.ts`, `updater.ts`, `releaseFeed.ts`, `updates.ts`, `smoke.mjs`, and all three workflows. | **Decided 2026-11-05: land Linux first, then branch Windows from `main`.** | Linux adds the multi-platform plumbing (platform keys, `appMenu.ts`, per-platform file excludes) that Windows would otherwise duplicate. Windows then becomes mostly additive. Step 0 touches none of those files, so it can start now. Alternatives: stack Windows on the Linux branch (one big PR) or build in parallel and resolve conflicts twice. |
| W2 | **Installer format.** | **NSIS, per-user, one-click.** No MSI, MSIX or portable build in v1. | It is the only format electron-updater can update (besides the unwanted `appx`). MSI/MSIX/portable are release-file additions later, not rework. A portable `.zip` is easy if you want it for testing. |
| **W3** | **How `composition` gets on PATH.** (a) menu item "Install Command Line Tool…" adds `resources\cli\bin` to the *user* PATH (parity with macOS, opt-in); (b) a checkbox in the installer; (c) a shim in `%LOCALAPPDATA%\Microsoft\WindowsApps`, which is already on PATH. | **(a)**, with the NSIS uninstaller removing the entry. | (a) matches macOS exactly and needs no installer UI. It must edit `HKCU\Environment\Path` without `setx` (which truncates at 1024 characters) and keep the value's `REG_EXPAND_SZ` type. (b) needs a custom NSIS page. (c) writes into an OS-managed folder and leaves a dangling shim. |
| **W4** | **Signing.** Unsigned installers trigger SmartScreen's "Windows protected your PC" until reputation builds; signing does not guarantee that warning disappears instantly either. Options: (a) **Artifact Signing** (cheap, cloud, CI-friendly, and electron-builder supports it); (b) an OV/EV certificate from a CA with a cloud HSM; (c) ship unsigned first. | **Start Artifact Signing identity validation now; ship early builds unsigned as pre-releases.** | Validation takes 1 to 20 business days, so it is the calendar-time long pole and costs nothing to start. **Eligibility depends on you:** as an *individual* you must be in the US or Canada; as an organization the list above applies, but you need a legal entity (is there a "Rushing Labs"?). If neither fits, option (b) costs a few hundred dollars a year. Whatever is chosen, the certificate's subject name becomes `publisherName`, which the updater pins; changing it later breaks updates for signed installs. |
| **W5** | **CLI support policy, and the fallback if Step 0 fails.** | **Support Windows Terminal (and PowerShell 7 in it); anything else is best effort.** **If OpenTUI on Node does not work, ship the Windows desktop app without the CLI** and add it when it does. | The desktop app and CLI do not depend on each other's build, so the CLI should not hold the app back. Git Bash (mintty) and the legacy console are not worth promising. |
| W6 | **OS floor and architecture.** | **Windows 10 22H2 and Windows 11, x64 only.** | Windows 11 on Arm runs x64 apps under emulation, so Arm users are probably not locked out (untested). Native Arm64 needs a Windows Arm64 Meilisearch, which does not exist. |
| W7 | **Where data lives.** | **Keep `%USERPROFILE%\.composition` for the shared database and `~\.composition-location.json`; settings and search index under `%APPDATA%\Composition`.** | One rule on all platforms, and the CLI and desktop already agree on it. The alternative (`%LOCALAPPDATA%`) would give Windows its own layout in every doc and in the shared-location file. |
| W8 | **Stopping Meilisearch is a hard kill.** | **Accept it, and test kill-during-indexing.** | Node cannot send Meilisearch a Ctrl+Break from a GUI app. The index is derived data. |
| W9 | **Window look.** | **Opaque on Windows in v1; Mica later.** | The translucency setting already reports `supported: false` off macOS. |
| W10 | **Windows leg for unit tests in CI.** | **Yes: first non-blocking, required once the POSIX-path failures are fixed.** | Catches Windows regressions on every PR, not just at release. About ten test files need attention. |
| **W11** | **What Windows do you have to hand for the manual pass?** | **A real Windows 11 machine for the final pass; a Windows 11 Arm VM (Parallels, UTM) on this Mac works for everything except true x64 performance.** | CI proves the installer installs and the smoke test passes. It cannot prove the TUI looks right in Windows Terminal, that SmartScreen behaves, or that an update lands over a running app. That takes a person and a Windows desktop. |

## Build order

Each step ends in something checkable. Builds and tests happen on a Windows runner (`windows-2025`, pinned
by name like the Linux `ubuntu-24.04`): electron-builder can write an NSIS installer from a Mac, but
setting the exe's icon and version needs Wine there and Artifact Signing needs Windows PowerShell, so
Windows packaging is **CI-only**.
Every new `uses:` is pinned to a commit SHA (`pnpm lint:actions`, [AGENTS.md](../AGENTS.md)).

0. **Spike: does it run on Windows at all?** A `workflow_dispatch`-only workflow on a Windows runner (no
   app code changes, so it cannot conflict with the Linux branch). Checks, in order of risk:
   (1) Node 26.12 + `node:ffi` + `opentui.dll` loads and `createCliRenderer` starts; (2) the same with the
   runtime renamed to `composition-node.exe`; (3) `better-sqlite3`'s `win32-x64.node` loads in Node 26 and
   in Electron 45; (4) `meilisearch.exe` starts with our flags, answers `/health`, and survives being killed
   mid-index; (5) the existing unpackaged smoke test passes; (6) the unit tests run, and the failures are
   counted. Plus a person runs the TUI by hand in Windows Terminal ([W11](#decisions-to-make)).
   **Gate A:** go or no-go on the CLI ([W5](#decisions-to-make)), and a list of real failures.

   *Status (2026-11-05):* written as [windows-spike.yml](../.github/workflows/windows-spike.yml) and
   `scripts/windows-spike/`, throwaway, to be deleted after Gate A. It runs on `windows-2022` and
   `windows-2025`, puts every result in the job summary, and also checks line endings after checkout,
   `LongPathsEnabled`, `wmic`, whether `pnpm.exe` exists, and the signatures on the bundled `node.exe` and
   `meilisearch.exe`. The harness was exercised on macOS (Node 26.10): native check, Meilisearch
   check and the full ConPTY run of the terminal app all pass there, so a failure on Windows is a Windows
   finding.

   *First run (PR 239, `windows-2022` and `windows-2025`):* it stopped at the dependency install, so none of
   the checks ran. Findings anyway:
   - **pnpm's version switch fails on Windows.** `apps/web` pins `pnpm@12.8.1`; the root, CLI and desktop pin
     `11.0.3`. `pnpm --dir apps/web install` under pnpm 11 tries to restart as 12.8.1 and Windows reports the
     path as "not recognized". Every Windows CI job and every build that touches `apps/web` hits this, so the
     pins have to be aligned, or switching turned off, before anything else works (second run tests the options).
   - **There is no `pnpm.exe`**, only `pnpm.cmd` and an extensionless shim, so `spawnSync("pnpm")` in
     `build-renderer.mjs` and `collect-licenses.mjs` will fail without a shell.
   - **`meilisearch.exe` is not signed**; the bundled `node.exe` is (OpenJS Foundation). Signing Meilisearch
     is ours to do (Step 7).
   - `wmic` is absent on Server 2025 (present on 2022), which supports the PowerShell lookup in `meili.ts`.
     The hosted images have `LongPathsEnabled=1`, so CI will not show a 260-character path problem that a
     user's machine could. `ps.exe` was on the runner's PATH (Git for Windows' bundled tools), so a `ps`
     result from CI means nothing about a real machine.

   The second run splits the installs, installs web through `npx pnpm@12.8.1`, probes the switching
   settings, and adds a spawn workaround for the desktop build.
1. **Hygiene.** `.gitattributes`; the Windows unit-test leg in `unit-tests.yml` as non-blocking; fix what
   it finds, then make it required. Needs only `main`.
2. **Fetch and lock.** `win-x64` entries in `meilisearch.lock.json` and `node.lock.json`; validators
   accept the key and the `.zip` name; `fetch-meilisearch.mjs` writes `.exe`; `fetch-node.mjs` unpacks a
   zip. The lock tests run on any OS, so this is verified on the Mac. *(After Linux lands.)*
3. **Stage the CLI.** `stage-cli.mjs` learns `win-x64`: `win32` architectures, `win32-x64.node`,
   `@opentui/core-win32-x64`, PE-header check, `cli\bin\composition.cmd`, `composition-node.exe`; `pnpm`
   spawned through a shell. Check by running `composition.cmd --version` on the runner.
4. **App code.** `meili.ts` (Windows process lookup, `windowsHide`), `updater.ts` / `releaseFeed.ts`
   (allow `win32`, read `latest.yml`), the Windows PATH install in `cliTool.ts` / `cliToolMenu.ts` and the
   Help-menu placement, `setAppUserModelId`, and `smoke.mjs` for Windows (`USERPROFILE`, no `pgrep`, no file
   mode). Every one takes `platform` as a parameter like the existing code, so the tests run on the Mac.
   **Gate B:** unit tests green on macOS, Linux and Windows.
5. **Package.** `win:` and `nsis:` blocks in `electron-builder.yml` (per-user, one-click, `win-x64`
   names for the `extraResources`, a Windows icon from `build/app-icon-1024.png`), a `dist:win` script, and a
   small NSIS include that stops `composition-node.exe` before install and removes the PATH entry on
   uninstall. A `package-desktop-windows` job: build unsigned, silent-install (`/S`), run
   `composition --version`, smoke-test the installed `Composition.exe`, uninstall, and confirm the data is
   still there. Also measure the installer size and the longest path in the install tree (260-character
   limit).
6. **Update path.** Publish two unsigned pre-release versions and update one to the other on a real
   machine, once with the TUI and search running. **Gate C:** the update lands without a manual
   "app is running" prompt.
7. **Signing.** *Start the identity validation at Step 0; do this step when it completes.* Create the
   Artifact Signing account, certificate profile and a CI identity; set `win.azureSignOptions` and
   `publisherName`; secrets or workload identity in the `release` environment. Verify with
   `Get-AuthenticodeSignature` on the installer, the app exe and the uninstaller, and confirm the updater
   accepts the signed update and rejects a differently signed one. Check the signatures on the bundled
   `node.exe` (OpenJS-signed) and `meilisearch.exe` (find out; sign it ourselves if it is unsigned).
8. **Release.** A `release-windows` job in `release-desktop.yml`, after the macOS draft exists (the Linux
   job's pattern, so the jobs never race to create the release). A Windows counterpart of `release.mjs`'s
   checks: `latest.yml` lists the installer with a sha512, the version matches the tag, the exe is a PE
   x64 with a valid signature. Uploads the installer, blockmap, `latest.yml` and `SHA256SUMS-windows.txt`.
9. **Docs and manual test.** `docs/manual-tests/windows.md` (install, SmartScreen, search, the CLI in
   Windows Terminal, update, uninstall), the "macOS only" lines listed above, `desktop-build-and-release.md`
   and `deployment/manual-build-release.md` get Windows sections, and the decision log in
   `product-builds.md` gets the Windows entries. **Gate D:** your by-hand pass on Windows 10 and 11.

Steps 1 and 7's validation can start immediately and run alongside the rest. Steps 2 to 4 are small and
can go in one pull request each; 5 is the first one that needs a Windows runner to prove anything.

## Risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| OpenTUI on Node-on-Windows has bugs (rendering, input, `node:ffi` loading) | Medium / high for the CLI, none for the app | Step 0 first; W5 lets the desktop app ship alone. |
| Installer or updater blocked by a running `meilisearch.exe` or `composition-node.exe` | High if untreated | Stop Meilisearch before `quitAndInstall` (exists); unique runtime name plus an NSIS kill macro; Gate C. |
| Orphaned Meilisearch after a crash (no `ps`; mandatory file locks) | Medium / medium | A real Windows process lookup in `meili.ts`; test a hard kill of the app, then relaunch. |
| SmartScreen / Defender warn on an unsigned installer or on `meilisearch.exe` | High before signing | W4; say so in the release notes of unsigned builds, as macOS does. |
| Signing eligibility (individual outside US/Canada, no legal entity) | Unknown, depends on you | W4; fall back to an OV/EV certificate with a cloud HSM. |
| Merge conflicts with the unlanded Linux branch | High if done in parallel | W1. |
| CRLF checkout corrupts tests or the `.cmd` launcher | Medium / low | `.gitattributes` in Step 1. |
| Deep `node_modules` paths exceed 260 characters in the install tree | Low | Measure in Step 5; the CLI's `nodeLinker: hoisted` install keeps them shallow. |
| Antivirus locks a file during the atomic temp-and-rename saves (`updates.json`, `window.json`) | Low | A short retry on `EPERM`/`EBUSY` if it ever shows up. |
