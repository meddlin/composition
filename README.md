# Composition

A note-taking system with Markdown support. This is a polyglot monorepo; each app has its own toolchain.

## Layout

| Path | What | Stack |
| --- | --- | --- |
| [apps/cli](apps/cli) | Terminal note-taking app (TUI) with SQLite storage and Meilisearch search | Python, [uv](https://docs.astral.sh/uv/), Textual |
| [apps/web](apps/web) | Web app | Next.js, TypeScript, pnpm |
| [apps/desktop](apps/desktop) | Desktop app (macOS): the web UI in Electron, with bundled search | Electron, TypeScript, pnpm |
| [docs](docs) | Architecture and product docs | Markdown |

Which features each app has: [docs/feature-matrix.md](docs/feature-matrix.md).

## Getting started

CLI:

```bash
cd apps/cli
uv sync
uv run composition
uv run pytest
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

Run from the repo root (requires [uv](https://docs.astral.sh/uv/) and pnpm, with each app's dependencies installed; desktop also needs web's):

```bash
pnpm test        # CLI (pytest) + web (vitest) + desktop (typecheck + vitest)
pnpm test:cli
pnpm test:web
pnpm test:desktop
```

The same `pnpm test` runs on every pull request via `.github/workflows/unit-tests.yml`. Builds of the CLI (`build-cli.yml`), web and desktop apps (`build-apps.yml`) also run on every pull request.

See each app's README for details.
