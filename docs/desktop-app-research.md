# Desktop app: research

Findings behind [desktop-app-plan.md](desktop-app-plan.md). Researched 2026-09-30 against
first-party docs and source. Facts carry a bracketed source number (see [Sources](#sources));
anything marked **Inference** is my reasoning from those facts, not something a source states.

## Short answers

**Can this be a relatively simple Electron implementation?** The Electron shell is simple.
Three things around it are not:

1. **Server Actions.** All of the web app's writes go through `"use server"` functions, and a
   Next.js static export does not support them [1]. So the web app can't simply be loaded from
   disk: either ship a Next server inside the app, or replace the action boundary with IPC.
2. **Meilisearch.** The web app *assumes* one is already running on `:7700` (`searchIndex.ts`).
   A desktop app has to start, supervise and stop it, and the binary is large (see
   [Meilisearch](#meilisearch-as-a-sidecar)).
3. **Release engineering.** Signing and notarization are mandatory for macOS distribution and
   for `autoUpdater` [5]. In my judgment this, not Electron code, is where most of the effort goes.

**Can the desktop app live in the monorepo?** Yes: `apps/desktop`. The repo is deliberately
not a JS workspace (the root `package.json` is only a task runner; `apps/web` has its own
`pnpm-lock.yaml` and `pnpm-workspace.yaml`), so `apps/desktop` would follow the same
one-toolchain-per-app convention. The only friction is sharing code with `apps/web`; see
[Monorepo placement](#monorepo-placement).

## What the web app is coupled to

Read from `apps/web/src`:

| Concern | Where | Next-specific? |
|---|---|---|
| Writes | `lib/composition/actions.ts`, `app/settings/actions.ts` (`"use server"`) | Yes: `revalidatePath` and the server-action transport |
| Initial data load | `app/page.tsx`, `app/settings/page.tsx`, `app/docs/[[...slug]]/page.tsx` read SQLite/disk in server components | Yes |
| Rendering mode | `export const dynamic = "force-dynamic"` on layout and all three pages | Yes |
| Persistence | `db.ts`, `notesRepo.ts`, `groupsRepo.ts` (`better-sqlite3`) | **No**: plain Node |
| Search | `searchIndex.ts` (`meilisearch` client over HTTP) | **No** |
| Settings | `webSettings.ts`, `paths.ts`, `layout.ts`, `themes.ts` | **No** |
| Frontmatter, docs listing | `frontmatter.ts`, `docs.ts` | **No** |
| Client UI | `components/notes/*` | Only `next/link` (`NoteSidebar`) |

Two observations drive the plan:

- Everything under `lib/composition/` except the two `actions.ts` files has **zero Next
  imports**. The only Next coupling in the data layer is `revalidatePath`, and the UI does not
  rely on it: `NotesApp.tsx` holds notes in `useState` and updates them optimistically from
  each action's return value.
- Four client modules import an action layer directly (`NotesApp`, `SearchBar` and
  `useLayout` from `lib/composition/actions`; `SettingsForm` from `app/settings/actions`),
  and `NotesApp.test.tsx` mocks that module boundary. A transport seam there is cheap.

## Next.js and Electron: two integration shapes

### A. Static export + IPC

`output: 'export'` emits HTML/CSS/JS with no server [1]. Supported: Server Components (run at
build time), Client Components, `next/link`, `GET` route handlers marked `force-static` [1].
**Unsupported, and used by this repo**: Server Actions and dynamic routes without
`generateStaticParams()` (the `docs/[[...slug]]` route) [1]. `force-dynamic` is not in that
list, but **Inference:** it has to go too, since its whole purpose is rendering per request and
an export has no request. `next dev` errors when unsupported features are used under
`output: 'export'` [1].

Consequence: in an export build `app/page.tsx` would run `listNotes()` **at build time**, not
at launch. Data loading has to move to the client, behind an API that Electron's main process
implements over IPC. **Inference:** this is a moderate refactor (about 10 actions, 3 pages), not
a rewrite, because the data layer is already framework-free.

Electron side: load the exported files via a custom protocol rather than `file://`, because
"the `file://` protocol gets more privileges in Electron than in a web browser" [4]. The
documented way is `protocol.handle` + `net.fetch(pathToFileURL(...))`, with the scheme
registered via `protocol.registerSchemesAsPrivileged` (`standard: true` for relative URLs)
before `app` is ready [3].

### B. Embedded Next server (`output: 'standalone'`)

`standalone` builds `.next/standalone/server.js`, runnable with `node server.js`, honoring
`PORT` and `HOSTNAME` [2]. `public/` and `.next/static` must be copied in manually [2]. In a
monorepo, files outside the project dir are traced only if `outputFileTracingRoot` is set [2].
Native addons may need `outputFileTracingIncludes` [2].

Electron side: spawn it as a child process and point a `BrowserWindow` at
`http://127.0.0.1:<port>`. `utilityProcess.fork` runs a Node environment with message ports
and lets you pass `args`/`env` [6]. The plain `child_process.fork` depends on the `RunAsNode`
fuse and throws if that fuse is disabled; Electron points to utility processes as the
alternative [7].

Tradeoffs:

| | A. Static + IPC | B. Embedded server |
|---|---|---|
| App code changes | Moderate (seam, 3 pages) | ~None |
| Network surface | None | Localhost HTTP server |
| Native module loads in | Main process only | Server child process |
| Ships | Static files | Static files + Next server + traced `node_modules` |
| Startup | No server to wait for | Wait for server ready |
| Electron's security model | Fits: validated IPC, no remote-content origin | Localhost is "remote content": `nodeIntegration` off, CSP, `will-navigate` limits all required [4] |

Security detail for B: Next documents that an exported Server Action "is reachable via a
direct POST request" and should be treated as public [8], and that actions compare `Origin` to
`Host` as CSRF protection [8]. **Inference:** a DNS-rebinding page would present matching
`Origin` and `Host` and so satisfy that check, and any local process can craft the POST. The
practical exposure is that any of those can call `saveSettingsAction` (which `mkdir`s
arbitrary paths) and read or overwrite notes. Not catastrophic for a local-first app, but it
is an exposure A simply does not have.

## Electron shell

- **Versions.** Latest stable is Electron 44.5.1 (2026-09-29), bundling Node 24.21.0, Chromium
  152, module ABI 149 [9]. Electron supports the latest three stable majors (44, 43, 42) and
  ships a major every 8 weeks [10]. So the app must plan to upgrade Electron roughly quarterly.
  The web app's CI and local Node are 22; shared modules use only `node:fs/os/path` and
  `better-sqlite3`, so the skew should be harmless, but it is worth one CI run on both.
- **Security checklist** for a local UI with a preload [4]: keep `contextIsolation` on,
  enable the sandbox, leave `nodeIntegration` off, expose a narrow typed API through
  `contextBridge` (never raw `ipcRenderer`), validate the `sender` of every IPC message, set a
  CSP, keep `webSecurity` on, and restrict navigation with `will-navigate`.
- **ASAR.** Native `.node` files need unpacking; and of the `child_process` APIs only
  `execFile` can run a binary inside an ASAR, so any bundled executable must live outside it
  or be unpacked [11].
- **Electron 44 has no install script**; the binary downloads on first use (`require("electron")`
  or the `electron` CLI), so pnpm's build-script allow-list needs no entry for it. (Observed.)
- **License files are not copied into a macOS app by electron-builder.** Electron's own
  distribution has `LICENSE` and `LICENSES.chromium.html` next to the binary, but the packaged
  `.app` contained neither (only better-sqlite3's LICENSE). The desktop build now assembles
  them into `Resources/licenses` (`apps/desktop/scripts/collect-licenses.mjs`). (Observed.)
- **Fuses** are flipped at package time (`RunAsNode`, `EnableNodeCliInspectArguments`,
  `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, and others) [7].
  **Inference:** worth setting for a shipped app, and none of them should affect spawning a
  third-party binary like Meilisearch (only `child_process.fork` depends on `RunAsNode`).

## better-sqlite3 in Electron

- Electron's ABI differs from Node's, so classic native addons must be rebuilt against
  Electron; `@electron/rebuild` is the recommended tool [12].
- **The repo is on `^12.11.1`, which is ABI-specific.** 12.x releases publish ~100 Electron
  prebuilt assets each (e.g. 98 for v12.11.1, 105 for v12.12.0) via `prebuild-install` [13].
  Using them means a per-Electron-version binary, and a `node_modules` that can't be shared
  between "run tests under Node" and "run inside Electron".
- **v13 changes this, with a catch.** v13.0.0 is "the first version of `better-sqlite3` to run
  on the N-API", so "prebuilt binaries should theoretically work across different versions of
  Node.js and Electron"; `prebuild-install` is removed and binaries ship inside the npm
  package [14]. I verified the 13.0.3 tarball contains `prebuilds/` for darwin-arm64,
  darwin-x64, linux-x64/arm64 (glibc and musl) and win32-x64/arm64.
  **The catch (found by building it): v13 needs Node >= 22.14, not the advertised `>=22`.**
  v13 is compiled with `NAPI_VERSION=10`, which Node only supports from 22.14.0; on older
  Node, `new Database()` segfaults (exit 139) after `require()` succeeds. Upstream tracks this
  as issue #1514, open, with that diagnosis [27]. I reproduced it on Node 22.13.1 (darwin-arm64,
  both `:memory:` and a file) while v12.11.1 works on the same Node.
  **Verified:** v13.0.3 runs correctly under Electron 44.5.1's Node 24.21.0 (ABI 149), both from
  source and inside the packaged, ASAR-unpacked app. So desktop gets the benefit (no
  `@electron/rebuild`, `npmRebuild: false`), while the web app should stay on v12 until every
  place it runs has Node >= 22.14.
- **Dependabot PR #26 (12.11.1 -> 13.0.3) is therefore not safe to merge blindly.** On a machine
  with Node < 22.14 every test that opens a database would crash. CI passes only because
  `setup-node` with `node-version: 22` resolves to a newer 22.x. A separate report on Node 24.19.0
  (an `ObjectWrap` teardown abort during garbage collection, caused by a Node regression
  tracked as nodejs/node#65446, hit better-sqlite3 11 and 12 as well) is a reason to avoid
  Electron releases bundling that exact Node; Electron 44.5.1 bundles 24.21.0 [27][9].
- From 12.12.0: Electron 43+ Linux binaries need glibc >= 2.41 [14]. Only relevant if Linux is
  ever a target.
- better-sqlite3's own guidance: synchronous calls on the main thread are fine for most
  workloads; workers only for very slow queries [15]. A notes app is in the "fine" category,
  and in Shape A the main process is the natural owner of the connection.

## Meilisearch as a sidecar

- **Current behavior.** The CLI spawns `meilisearch` from `PATH` on a random free port with a
  generated master key (`0600`), its own `--db-path`, `--no-analytics`, polls `health()` for
  10 s, and terminates it (kill after 5 s) on exit. (This research was done against the Python CLI's version, since
  replaced by the TypeScript one; the desktop app's `meili.ts` has the same behavior and is what the
  terminal app now uses.)
  The web app does **not** start one; `pnpm meili` does, on `:7700` with
  `~/.composition-web/meili_data`. Each app's index is separate and rebuildable from SQLite
  ([search.md](architecture/search.md)). The desktop app has to implement the CLI's lifecycle
  in TypeScript.
- **Size is the big surprise.** Release binary sizes on GitHub [16], in MiB: the macOS
  Apple-silicon binary is 116 in v1.53.1 and 331 in v1.54.2 (latest, 2026-09-29); the
  v1.54.2 Linux and Windows x64 binaries are 340 and 336. Electron's own macOS download is
  ~124-127 MiB as a compressed zip [9]. **Inference:** a bundled Meilisearch may be larger than Electron
  itself, and the jump between 1.53 and 1.54 looks like a build change rather than a feature.
  Pin a version and measure the *installed and compressed* size before committing.
- **License.** Bundling the community binary is permitted; see [Licensing](#licensing).
- **Signing.** `@electron/osx-sign` walks the whole `Contents/` tree and signs discovered
  Mach-O files, and accepts extra `binaries` [18]. **Inference:** a Meilisearch binary in
  `Contents/Resources` would be found and signed, but the notarized build is where to confirm
  it, since an unsigned nested binary fails notarization.
- **Alternative (not recommended now).** SQLite FTS5 would remove the sidecar entirely, but
  [product-positioning.md](product-positioning.md) names Meilisearch typo tolerance and
  relevance ranking as a differentiator, so this is a product decision, not a packaging one.

## Licensing

Question: can Composition bundle and redistribute the Meilisearch binary inside a desktop app,
or does that need a special license? This is a reading of the project's own license files,
build configuration and docs, **not legal advice**.

**Finding: yes, with the community binary, no special license.**

- The repository is dual-licensed: `SPDX-License-Identifier: MIT AND BUSL-1.1`. The top-level
  LICENSE says that parts fall under the Enterprise Edition (BUSL-1.1) and "the other parts of
  this work are licensed under the MIT license" [23].
- The Business Source License applies only to a defined set: "any file explicitly marked as
  'Enterprise Edition (EE)' or 'governed by the Business Source License' residing in
  enterprise_editions modules/folders", and "this License does not apply to any code outside
  of the Licensed Work, which remains under the MIT license" [23]. Its Additional Use Grant
  allows non-production use only; "production use ... requires a commercial license
  agreement" [23].
- The README: Community Edition is "fully open source under the MIT license" and "free to use
  for anyone, including commercial usage"; Enterprise Edition is "not allowed in production
  without a commercial agreement" [17]. The docs page on editions says the same: CE under MIT,
  EE under BUSL and "cannot be freely used in production" [26]. The only EE feature that page
  names is sharding; the README also lists S3-streaming snapshots.
- **The two editions are separate builds, so the community binary does not contain the EE
  code.** The release workflow builds a matrix of `edition: [community, enterprise]`; only
  `enterprise` adds `--features enterprise` and the `enterprise-` filename prefix, so the
  community asset is named plain `meilisearch-<platform>` [24]. That cargo feature is what
  pulls in the EE code (`enterprise = ["meilisearch-types/enterprise",
  "index-scheduler/enterprise"]`) [25]. This holds for v1.53.1, which ships both
  `meilisearch-macos-apple-silicon` and `meilisearch-enterprise-macos-apple-silicon`, and the
  edition split exists in releases at least back to v1.28.0 [16].
- **MIT's one real obligation is attribution:** "The above copyright notice and this
  permission notice shall be included in all copies or substantial portions of the Software"
  [23]. Permission explicitly covers use, copy, modify, merge, publish, distribute, sublicense
  and sell. So the notice has to ship inside the app.

What this does **not** settle:

- **Transitive dependencies.** Meilisearch's release binary is built from many Rust crates;
  each has its own license and attribution terms. The repo has no consolidated third-party
  notices file [23], and I did not audit its `Cargo.lock`. Generate and review that list at the
  pinned version.
- **Trademark.** LICENSE-EE states it grants no rights in Meilisearch's trademarks or logos
  [23]; MIT is silent on trademarks. I found no standalone trademark policy for the open-source
  project (the Terms of Use I found govern the hosted Cloud service, so I did not rely on
  them). Conservative practice: factual mention only, no logo, no implication of endorsement.
- **Telemetry.** The README says Meilisearch sends anonymized usage data unless disabled [17].
  The CLI already starts it with `--no-analytics`; a desktop app that phones home on the user's
  behalf would need disclosure, so keep the flag.
- **Your own license.** This repo has no `LICENSE` file. Bundling MIT software does not impose
  a license on the app, but public release binaries should say what the app's own terms are.
- **If Composition is ever sold commercially,** have a lawyer confirm; nothing above changes
  for MIT software, but the decision is worth a professional's sign-off at that point.

## Packaging, signing, notarization, updates

- **Tooling.** Two credible options. *electron-builder* (26.15.3): runs `@electron/rebuild`
  by default (`npmRebuild: true`), detects native modules to unpack automatically, enables
  Hardened Runtime for macOS by default (a prerequisite for notarization), and notarizes when
  `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` (recommended) or Apple ID or keychain
  env vars are present [19]. *Electron Forge* (8.0.1): the Electron project's own all-in-one
  tool, with first-party Vite and webpack templates, and integrated `osx-sign`/`notarize` [5][20].
  **Inference:** since Next builds the renderer, Forge's bundler plugins add little; both work.
- **Apple.** Distribution outside the Mac App Store uses a Developer ID certificate and
  notarization [21]; membership is $99/year [21]. Electron's guide: the app must be signed and
  then uploaded for notarization, and `autoUpdater` "requires the app to be signed" on macOS [5].
  I could not fetch Apple's notarization documentation page (it renders client-side), so
  notarization mechanics above come from Electron's and electron-builder's docs, not Apple's.
- **Windows** (if ever): since June 2023 only extended-validation certificates help; simpler
  ones are treated as unsigned; Azure Artifact Signing is the cheapest documented option [5].
  [product-positioning.md](product-positioning.md) only mentions macOS.
- **Architectures.** Separate arm64 and x64 builds avoid merging native files;
  electron-builder also supports `universal` via `@electron/universal` [19]. **Inference:**
  per-arch is the lower-risk start: the Meilisearch binary and the `.node` file are both
  per-arch, and a universal build has to merge them.
- **Updates.** `update.electronjs.org` (free) needs: a public GitHub repo (this one is public),
  builds published to GitHub Releases, and code-signed macOS builds [22]. Matches
  [product-positioning.md](product-positioning.md)'s "use GitHub releases to host binaries".

## Monorepo placement

- `apps/desktop` with its own `package.json` and `pnpm-lock.yaml` matches the repo's
  convention. Wiring needed: a root `test:desktop` script, a Dependabot `npm` entry for
  `/apps/desktop` (today only `/apps/web`), and the CI `setup-node` `cache-dependency-path`
  (today only `apps/web/pnpm-lock.yaml`). Any new workflow step must be SHA-pinned and pass
  `pnpm lint:actions` (see the repo's `AGENTS.md`).
- **Sharing code.** Shape A needs the desktop main process to reuse `lib/composition/*`.
  Two ways:
  1. *Relative import / bundle from `../web/src/lib/composition`.* No workspace, matches
     "each app keeps its own toolchain". Cost: one app reaching into another's `src`.
  2. *Extract `packages/core` and add a root pnpm workspace.* Cleaner boundary, but it
     changes the repo's stated layout, lockfile and CI/Dependabot shape, and only pays off
     with a third consumer.
  **Inference:** start with (1) behind a single well-named entry point so (2) is a mechanical
  move later.
- Shape B would additionally need `outputFileTracingRoot` if traced files sit outside
  `apps/web` [2].
- The CLI and web share `composition.db` today, and `db.ts` sets WAL mode "so this also
  benefits the CLI's plain sqlite3 connections". A desktop app is a third writer to the same
  file, so it should hold a single-instance lock and reuse the same idempotent
  `ensureColumn` migrations.

## Questions the build has answered, and what is still open

Answered by building and running it (macOS arm64, Electron 44.5.1):

- **N-API better-sqlite3 13 in a packaged Electron app: works.** ASAR, native module unpacked,
  real DB read/write. It does **not** work on Node < 22.14 (see above).
- **Next font loading in a static export: self-hosted, offline-safe.** Next's docs: "CSS and
  font files are downloaded at build time and self-hosted with the rest of your static assets.
  No requests are sent to Google by the browser" [28]. The export contains the `.woff2` files.
- **Theme flash: avoided.** The preload fetches a synchronous `{ theme, layout }` snapshot and
  an inline script in `<head>` applies it before first paint.
- **Bundled Meilisearch from `Resources`:** spawned from outside the ASAR, healthy, searchable,
  no orphan after quit (stop -> SIGTERM -> SIGKILL; a pid file reaps one left by a crash).
- **Measured sizes** (unsigned `--dir` build, Meilisearch 1.53.1 from Homebrew as a stand-in):
  422 MB unpacked app = Electron Framework 286 MB + Meilisearch 128 MB + ~7 MB app code and
  native module. Compressed DMG size is not measured yet.

Still open (needs Apple credentials or more measurement):

- Whether the Meilisearch binary passes notarization when placed in `Resources`.
- Compressed installer size; idle memory and cold-start time; behavior with a few thousand notes.
- The license list for the Rust crates inside the Meilisearch binary (see [Licensing](#licensing)).

## Sources

1. Next.js, [Static exports](https://nextjs.org/docs/app/guides/static-exports) (v16.3.8 docs, updated 2026-08-25): supported/unsupported features.
2. Next.js, [`output`](https://nextjs.org/docs/app/api-reference/config/next-config-js/output): standalone, tracing, `outputFileTracingRoot`.
3. Electron, [`protocol`](https://www.electronjs.org/docs/latest/api/protocol): `handle`, `registerSchemesAsPrivileged`, serving bundled files.
4. Electron, [Security](https://www.electronjs.org/docs/latest/tutorial/security): isolation, sandbox, IPC sender validation, CSP, custom protocols over `file://`.
5. Electron, [Code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing): macOS signing + notarization, Windows EV requirement, `autoUpdater` signing.
6. Electron, [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process).
7. Electron, [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses): `RunAsNode` and its effect on `child_process.fork`.
8. Next.js, [Data security](https://nextjs.org/docs/app/guides/data-security): Server Actions are directly POST-able; Origin/Host comparison.
9. Electron release metadata, [releases.json](https://releases.electronjs.org/releases.json) and the `electron/electron` v44.5.1 GitHub release assets; npm registry `electron@44.5.1`.
10. Electron, [Release timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines): support policy, 8-week cadence.
11. Electron, [ASAR archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives): native modules, `execFile`.
12. Electron, [Native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules): ABI difference, `@electron/rebuild`.
13. `WiseLibs/better-sqlite3` GitHub releases (v12.11.1, v12.12.0 assets; `package.json` of 12.11.1 on npm).
14. `WiseLibs/better-sqlite3` [v13.0.0](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) and [v12.12.0](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.12.0) release notes; `better-sqlite3@13.0.3` npm tarball contents and `engines`.
15. better-sqlite3, [docs/threads.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md).
16. `meilisearch/meilisearch` GitHub releases (v1.54.2 and earlier): asset names and sizes.
17. `meilisearch/meilisearch` [README](https://github.com/meilisearch/meilisearch#-editions--licensing) and LICENSE: CE vs EE.
18. `electron/osx-sign` source (`src/util.ts`, `src/sign.ts`): `walk`, `isBinaryFile`, `binaries`.
19. `electron-userland/electron-builder` source: `macOptions.ts` (`hardenedRuntime`, `notarize`, `universal`), `PlatformSpecificBuildOptions.ts` (`asar`), `configuration.ts` (`npmRebuild`).
20. `electron/forge` `packages/plugin/vite/README.md`; [electronforge.io](https://www.electronforge.io/).
21. Apple, [Apple Developer Program](https://developer.apple.com/programs/): $99 annual fee, Developer ID + notarization.
22. Electron, [Updates](https://www.electronjs.org/docs/latest/tutorial/updates): `update.electronjs.org` requirements.
23. `meilisearch/meilisearch` [LICENSE](https://github.com/meilisearch/meilisearch/blob/main/LICENSE), [LICENSE-MIT](https://github.com/meilisearch/meilisearch/blob/main/LICENSE-MIT) and [LICENSE-EE](https://github.com/meilisearch/meilisearch/blob/main/LICENSE-EE): dual-license scope, BSL Additional Use Grant, MIT text and notice condition, trademark sentence; repo root listing (no third-party notices file).
24. `meilisearch/meilisearch` [`.github/workflows/publish-release-assets.yml`](https://github.com/meilisearch/meilisearch/blob/main/.github/workflows/publish-release-assets.yml): `edition: [community, enterprise]` matrix, `--features enterprise`, `meilisearch-<edition-suffix><platform>` asset names.
25. `meilisearch/meilisearch` [`crates/meilisearch/Cargo.toml`](https://github.com/meilisearch/meilisearch/blob/main/crates/meilisearch/Cargo.toml): the `enterprise` feature definition.
26. Meilisearch docs, [Enterprise and Community editions](https://www.meilisearch.com/docs/resources/self_hosting/enterprise_edition).
27. `WiseLibs/better-sqlite3` [issue #1514](https://github.com/WiseLibs/better-sqlite3/issues/1514) (v13.0.3 segfaults on Node < 22.14, cause `NAPI_VERSION=10`) and [issue #1515](https://github.com/WiseLibs/better-sqlite3/issues/1515) (Node 24.19.0 GC abort, nodejs/node#65446); reproduced locally.
28. Next.js docs shipped with 16.3.6 (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`): Google fonts are self-hosted at build time.

**Not retrievable:** Apple's notarization documentation page and the electron-builder docs site
returned no content (client-rendered); electron-builder claims are read from its source.
