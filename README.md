# Composition

A note-taking system with Markdown and (minimal) MDX support. This is a polyglot monorepo; each app has its own toolchain.

## Layout

| Path | What | Stack |
| --- | --- | --- |
| [apps/cli](apps/cli) | Terminal note-taking app (TUI) with SQLite storage and Meilisearch search | TypeScript, [OpenTUI](https://opentui.com) (React), Node 26.10+, pnpm |
| [apps/web](apps/web) | Web app | Next.js, TypeScript, pnpm |
| [apps/desktop](apps/desktop) | Desktop app (macOS): the web UI in Electron, with bundled search | Electron, TypeScript, pnpm |
| [docs](docs) | Architecture and product docs | Markdown |

Which features each app has: [docs/feature-matrix.md](docs/feature-matrix.md).

## Getting started

CLI (needs Node 26.10 or newer, and `meilisearch` for search; installs `apps/web` first, since it reuses its data layer):

```bash
(cd apps/web && pnpm install)
cd apps/cli
pnpm install
pnpm dev
```

Web:

```bash
cd apps/web
pnpm install
pnpm dev
```

Desktop (installs `apps/web` first, since the desktop app reuses its code and UI):

```bash
(cd apps/web && pnpm install)
cd apps/desktop
pnpm install
pnpm dev
```

## Testing

Run from the repo root (requires pnpm, with each app's dependencies installed; desktop and the CLI also need web's):

```bash
pnpm test        # web (vitest) + desktop (typecheck + vitest), on Node 22
pnpm test:web
pnpm test:desktop
pnpm test:cli    # the CLI (vitest), which needs Node 26.10 or newer
pnpm test:cli:types
```

The CLI needs a newer Node than the other two (OpenTUI uses `node:ffi`), which is why it is not part
of `pnpm test`. On a machine with Node 22 as the default, `nvm use 26` first.

`pnpm test` runs on every pull request via `.github/workflows/unit-tests.yml`, and the CLI's type-check
and tests run there too in their own Node 26 job. Builds of the CLI (`build-cli.yml`), web and desktop
apps (`build-apps.yml`) also run on every pull request.

See each app's README for details.
