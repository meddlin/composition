# Composition

A note-taking system with Markdown support. This is a polyglot monorepo; each app has its own toolchain.

## Layout

| Path | What | Stack |
| --- | --- | --- |
| [apps/cli](apps/cli) | Terminal note-taking app (TUI) with SQLite storage and Meilisearch search | Python, [uv](https://docs.astral.sh/uv/), Textual |
| [apps/web](apps/web) | Web app | Next.js, TypeScript, pnpm |
| [docs](docs) | Architecture and product docs | Markdown |

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

## Testing

Run from the repo root (requires [uv](https://docs.astral.sh/uv/) and pnpm, with each app's dependencies installed):

```bash
pnpm test        # CLI (pytest) + web (vitest)
pnpm test:cli
pnpm test:web
```

The same `pnpm test` runs on every pull request via `.github/workflows/unit-tests.yml`.

See each app's README for details.
