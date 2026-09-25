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

See each app's README for details.
