# Shared core: moving the common code into one package

Status: **a plan, not started.** Written 2026-10-02, when the terminal app (`apps/cli`) was rewritten
in TypeScript and became the third app to depend on the same code. The goal is to do this soon, as
the follow-up to that rewrite, and this page is the list of steps.

## Why

Three apps run on one set of notes: the terminal app (`apps/cli`), the web app (`apps/web`) and the
desktop app (`apps/desktop`). They already share most of their logic, but not through a package:

- the desktop app imports the web app's data layer by relative path, through one file
  ([`apps/desktop/src/main/backend.ts`](../apps/desktop/src/main/backend.ts));
- the terminal app does the same, and also imports desktop's Meilisearch process code, through
  [`apps/cli/src/backend.ts`](../apps/cli/src/backend.ts).

That works, and it was the right way to avoid a third copy of everything. But it has costs, and the
terminal rewrite made them concrete (see [What we learned](#what-we-learned-from-the-terminal-rewrite)):

- an app cannot be built or type-checked without another app's dependencies installed;
- the shared code lives under `apps/web/src/lib` and `apps/web/src/components/notes`, so "web" code
  quietly means "everyone's" code, and a web-only change can break two other apps;
- the code assumes it runs in one particular place (it reads the web app's settings file, caches its
  database in a `globalThis` slot made for Next.js hot reloading, and keeps search state in module
  variables);
- it forces the three apps onto mismatched toolchains that happen to work.

The decision recorded in [product-builds.md](product-builds.md) already points here: the code moves
into a shared package, and the apps keep their own toolchains for their own concerns.

## Goal and non-goals

**Goal:** one package, `packages/core`, holding everything the three apps share, which each app
depends on in the normal way. After it, no app imports another app's source, and each app's seam
file (`backend.ts`) becomes a thin re-export of the package.

**Not goals:**

- Merging the apps, or their UIs. The web and desktop apps share a UI; the terminal app does not.
- Changing any file format. The database schema, `settings.json`, the frontmatter and the favorites
  list stay byte-for-byte as they are. Existing notes and settings must keep working untouched.
- Choosing a runtime for everyone. Electron runs on its own Node and Next on Node; the package must run
  on all of them, and must not need Bun. (It should make Bun possible for the terminal app later;
  see [Runtime flexibility](#runtime-flexibility).)

## What is shared today

| Code | Where it lives now | Used by |
|---|---|---|
| Data layer: `db.ts`, `notesRepo`, `groupsRepo`, `trashRepo`, `attachmentsRepo`, `service.ts` | `apps/web/src/lib/composition` | web (Server Actions), desktop (`backend.ts`), CLI (`backend.ts`) |
| Frontmatter, search query parser, search index client | same folder | all three |
| Pure rules: `favorites`, `groupMove`, `trash` arithmetic, `sunSchedule`, `sunTimes`, `layout`, `themes` | same folder | all three |
| Pane arrangement (`panes.ts`) | `apps/web/src/components/notes` (a UI folder, but pure) | web, desktop (through web), CLI |
| Meilisearch process and sidecar: `meili.ts`, `search.ts` | `apps/desktop/src/main` | desktop, CLI |
| Color palettes | web: `app/globals.css`; CLI: `src/theme.ts` | two copies, held together by a test |
| Constants like `IMAGE_DIR_NAME`, `ATTACHMENT_DIR_NAME` | web | CLI reads them so its data move can't drift |

## What we learned from the terminal rewrite

These are the concrete problems the package has to solve. Each one is a step below.

1. **`better-sqlite3` is built per Node.** Web runs on Node 22 with its own copy; the terminal app on
   Node 26 with another; the desktop app on Electron's Node with a third (version 13, which needs Node 22.14 or
   newer and crashes on 22.13, so it cannot simply be shared with web). Code in `apps/web` that says `import "better-sqlite3"` resolves web's
   copy. The terminal app works around it twice: its bundle marks the module external, and its test
   config aliases it to the CLI's own copy. A package that imported the driver itself would be worse.
2. **`db.ts` finds the database by reading the web app's settings** (`loadWebSettings()`), and the
   other apps point it elsewhere by setting an environment variable,
   `COMPOSITION_SETTINGS_PATH`, before anything runs. It works, but the "dependency" is an
   environment variable.
3. **Hidden global state.** The open database is cached on `globalThis.__compositionDb` (for Next.js
   hot reload), and `searchIndex.ts` keeps its Meilisearch client, its "is the index in sync" flag and
   its "search is unavailable because…" message in module variables. Tests have to reset them, and the
   terminal tests learned the hard way that an unconfigured search quietly tries web's port 7700.
4. **`service.ts` is everyone's use cases and also web's extras.** Images, attachments and the
   sunrise lookup (which makes a network call) sit in the same file as notes and groups, so any app
   that wants only notes still carries the rest.
5. **The toolchains disagree.** TypeScript 6 (web) against 7 (desktop, CLI); pnpm 12.8.1 (web)
   against 11.0.3 (root, desktop, CLI); Node 22 (web, desktop CI) against 26 (CLI); and no root
   workspace, so four lockfiles. pnpm quietly switches itself to 12.8.1 whenever it enters `apps/web`.
6. **Things that belong together live apart.** The pure pane arrangement is in a UI folder; the
   process manager that the terminal app needs is inside the desktop app's `main` folder, and its
   `search.ts` imports types from desktop's own seam file.
7. **Duplicated values need guard tests.** The palettes exist in CSS and in `theme.ts`; `js-yaml` is a
   dependency of both web and the CLI. The tests that guard them (`theme.test.ts`, `dataLocation.test.ts`)
   exist because there are two copies, and become unnecessary when there is one.

## Target layout

```
package.json                 root: scripts only, as today
pnpm-workspace.yaml          packages: apps/*, packages/*; allowBuilds in one place
packages/
  core/                      @composition/core: source-only, no build step of its own
    src/
      domain/                pure: frontmatter, searchQuery, favorites, groupMove, trash, panes,
                             sunSchedule, layout, themes (names and palettes), constants
      data/                  repos and schema, written against a `Database` port (below)
      search/                the index client (an instance, not module state), query running
      service/               use cases: notes, groups, trash, favorites, search, settings
      node/                  Node-only: Meilisearch process manager and sidecar, binary lookup
      index.ts               what apps may import
    package.json             "exports" point at the TypeScript source
apps/cli, apps/web, apps/desktop     depend on @composition/core; own UI and toolchain
```

Three ports replace the three implicit dependencies from the list above, and are the heart of the
change. Everything else is moving files.

| Port | Replaces | Implementations |
|---|---|---|
| `Database`: the handful of methods the repos use (`prepare`, `exec`, `pragma`, `transaction`, `close`) | `import Database from "better-sqlite3"` inside the data layer | `better-sqlite3` for all three apps today, in one small adapter file. Others can follow. |
| `SettingsStore`: `load()` and `save()` for the settings model | `loadWebSettings()` and the `COMPOSITION_SETTINGS_PATH` environment variable | a JSON file at the app's own path: `~/.composition-web/settings.json`, desktop's `userData`, `~/.composition-cli/settings.json` |
| `SearchConfig`: where Meilisearch is, or why it is off | module variables in `searchIndex.ts` | an object each app creates; the sidecar fills it in |

A source-only package (its `exports` pointing at `.ts` files) is the simplest way to consume it: Next
compiles it with `transpilePackages`, desktop and the CLI bundle it with esbuild, and vitest reads it
directly. There is no separate build to keep in sync.

## Steps

Each step is one pull request that leaves every app and every test suite green, so the work can stop
or be reordered between any two. The order puts the risk-free moves first.

### 0. Settle the shared facts

Decide, and write down in this page, the things that must be one value:

- **TypeScript version.** The terminal app and the desktop app already use 7. Check web builds with
  it (Next 16, `eslint-config-next`), and move web if it does.
- **pnpm version.** One, in the root `packageManager`. Today the root says 11.0.3 and web says 12.8.1.
- **Node floor for `packages/core`:** 22. The package must not use `node:ffi` or any other
  experimental API, so web and desktop can use it. (The terminal app keeps its own 26.10 floor for
  OpenTUI; that is the app's, not the package's.)
- **Where `better-sqlite3` is declared:** only in the apps, never in the core (see step 3).

Done when these are written here and CI passes with them.

### 1. A root workspace

Add `pnpm-workspace.yaml` at the root (`apps/*`, `packages/*`), move the three `allowBuilds` blocks
into it, and generate one lockfile. Keep each app's own scripts and its own `package.json`: the apps
keep their toolchains. CI installs once instead of web, then desktop, then the CLI.

Done when `pnpm install` at the root installs everything, and `pnpm test`, `pnpm test:cli`, the
three builds, and `pnpm lint:actions` all pass. This removes the "install `apps/web` first" step
from every README.

### 2. Extract the pure modules

Move to `packages/core/src/domain/` everything that does no I/O: `frontmatter`, `searchQuery`,
`favorites`, `groupMove`, `trash`, `sunSchedule`, `layout`, `themes`, `imageRefs` and
`attachmentNames` constants, and `panes`. Their tests move with them. In `apps/web` leave one-line
re-exports at the old paths so nothing else has to change in the same pull request; remove them in
the next one.

Also here: make the palettes one thing. Put the hex values in `domain/themes`, have `theme.ts` use
them, and either generate web's CSS variables from them or keep `globals.css` and have a test read it
(the existing drift test is the template). Then `js-yaml` is declared once, in the core.

Done when no `apps/*` file defines frontmatter, query-parsing or palette logic of its own, and the
terminal app's `backend.ts` imports those from the package.

### 3. Introduce the three ports

Behind the existing code, so behavior is unchanged:

- Give the repos a `Database` instead of calling `getDb()`. Keep `getDb()` as the web adapter,
  including its `globalThis` cache (a Next.js concern, so it stays in `apps/web`).
- Add `SettingsStore` and make `loadWebSettings`/`saveWebSettings` one implementation of it. Delete
  the `COMPOSITION_SETTINGS_PATH` environment variable once the desktop and terminal apps pass their own.
- Turn `searchIndex.ts` into a class that takes a `SearchConfig`, instead of module variables.

The `better-sqlite3` adapter lives in its own file in the core (`data/adapters/better-sqlite3.ts`) and
imports the driver **lazily, by the app's own resolution**, so each app gets its own copy built for its
own Node. That deletes both of the terminal app's workarounds (the esbuild `external` stays, as it
must for any native module; the vitest alias goes).

Done when `db.test.ts` and `service.test.ts` pass unchanged against the new ports, and a test can
open two databases and two search indexes in one process, which module state made impossible.

### 4. Move the data layer and the use cases

Move `db.ts` (schema and migrations), the repos, and `service.ts` into the core, split as it is
described under "What we learned": a core service for notes, groups, trash, favorites, search and the
settings snapshot, and the app-specific extras (images, attachments, the sunrise lookup) kept as
small separate modules that an app opts into. The `CompositionApi` contract is the web and desktop
apps' UI contract; keep it in the web app and have it compose the core service with the extras.

Done when the CLI's `Api` type is derived from the core service rather than from web's, and
`apps/web/src/lib/composition` contains only web-specific code.

### 5. Move the Meilisearch process code

Move `MeiliProcessManager`, `SearchSidecar` and `resolveMeiliBinary` from `apps/desktop/src/main` to
`packages/core/src/node/`, with their tests. Desktop's `meili.ts` and `search.ts` become re-exports,
then disappear. This is Node-only (it spawns a process), so it is a separate entry point
(`@composition/core/node`) that a browser-bound bundle can never accidentally import.

Done when the terminal app imports nothing from `apps/desktop`.

### 6. Switch the three seams

The payoff, and the smallest diff. Each app's seam file changes to re-export from the package:

- `apps/cli/src/backend.ts`: every `../../web/src/...` and `../../desktop/src/...` path becomes
  `@composition/core`;
- `apps/desktop/src/main/backend.ts`: the same;
- the web app's Server Actions (`actions.ts`): import the service from the package.

Done when `git grep "\.\./\.\./web\|\.\./\.\./desktop" -- apps` finds nothing.

### 7. Keep it that way

Add a lint rule (ESLint `no-restricted-imports`, or `dependency-cruiser`) that forbids `apps/X`
importing from `apps/Y`, and any import of `better-sqlite3` inside `packages/core` outside the one
adapter file. Run the core's tests once on Node 22 and once on Node 26 in CI, since it must work on
both.

Done when a deliberate violation fails CI.

## Runtime flexibility

The rule that keeps this package from tying the repo to one runtime: it depends only on Node built-ins
and on the three ports, never on a specific SQLite driver or on anything experimental. That is what
keeps two decisions open at no cost:

- **Bun for the terminal app** (OpenTUI is first-class there, with no experimental flag): write a
  `Database` adapter over `bun:sqlite` and nothing else in the core changes. Electron and Next stay
  on Node, unaffected.
- **A single-file executable for the terminal app**, if it is ever distributed that way.

Neither is planned. Moving the whole repo to Bun was considered and rejected: Electron cannot run on
it, and the apps share a native SQLite driver that is built for Node.

## Hazards, and how each step handles them

| Hazard | Where it bites | Handled by |
|---|---|---|
| A native module resolved from the wrong place | any app that bundles the core | the driver is imported only in the adapter, by each app's own resolution (step 3) |
| Electron needs `better-sqlite3` rebuilt for its own ABI | desktop packaging | unchanged: desktop already externalizes it; the core never bundles it |
| Next.js compiling a TypeScript package | web build | `transpilePackages: ["@composition/core"]` (step 1 or 2, with a web build in CI) |
| CommonJS (desktop's bundle) and ESM (the CLI's) | bundling | a source-only package is compiled by each app's bundler into its own format |
| A test that accidentally reaches a real Meilisearch or real notes | every suite | the terminal tests' sandbox (`src/testing.tsx`) is the template: temp home, search off. Move the helper into the core's test utilities |
| Breaking existing user data | all | no file format changes in any step; `db.test.ts` opens databases as each earlier version created them |
| pnpm self-switching versions | local and CI | step 0 |

## What the terminal rewrite already did to make this cheaper

- Every cross-app import is in **one file per app** (`backend.ts`), so step 6 is a few lines per app.
- The UI talks to a small `Api` type, not to the data layer directly, so swapping what implements it
  touches no component.
- Tests pin the things that must not drift: palettes against web's CSS, the image and attachment
  folder names, the keymap against the editor's keys, and the database migrations.
- The Meilisearch code is already free of Electron, and the pure rules are already free of React, so
  steps 2 and 5 are moves, not rewrites.

## Definition of done

- `packages/core` exists, and `git grep` finds no import of one app's source from another.
- Each app installs and builds from the root workspace, on the Node version it needs.
- Every test suite that passed before still passes, and `db.test.ts`-style tests open old databases
  successfully.
- A note written by any app before the change is readable and editable by every app after it.
- This page is updated to say what was done, and the "Shared code" section of
  [architecture.md](architecture.md) and the `backend.ts` header comments are updated to match.
