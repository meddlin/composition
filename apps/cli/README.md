# Composition

A terminal-based note-taking app with Markdown support, SQLite storage, and Meilisearch search.

## What it is

Composition is a terminal user interface (TUI) note-taking application built with
[OpenTUI](https://opentui.com) and React, for anyone who wants to write and organize notes without
leaving the terminal. It opens the same notes as the web and desktop apps in this repo.

## What it does

- Write and edit notes in Markdown, directly in the terminal, with a live preview, side by side if
  you like: open several notes in panes next to each other
- See the MDX components a note uses (`<Info>`, `<Warning>`, `<Toc>`, `<Image>`) drawn in the preview,
  written the same way as in the web and desktop apps ([docs/ui/mdx-components.md](../../docs/ui/mdx-components.md))
- See the images in a note, as pictures: with the Kitty or Sixel graphics protocol where your terminal
  has one, and in colored block characters anywhere else ([docs/architecture/images.md](../../docs/architecture/images.md#in-the-cli))
- Store notes locally in a SQLite database, in nested groups, with YAML frontmatter for the title,
  description and tags
- Search across all notes with fuzzy full-text search and filters (`tag: work`, `created: >2026-05-30`),
  powered by [Meilisearch](https://www.meilisearch.com/)
- Pin favorites, and restore deleted notes and groups from the Trash Can for 60 days
- Five color schemes, including one that follows the sunrise and sunset of a city you choose
- Navigate a fast, keyboard-driven UI. Press `?` for every key; they are also listed in
  [docs/ui/cli-keybindings.md](../../docs/ui/cli-keybindings.md)
- Move all application data to a directory of your choice from Settings

## Requirements

- **Node 26.10 or newer.** OpenTUI uses Node's `node:ffi`, which is on by default from 26.10.
  (With [nvm](https://github.com/nvm-sh/nvm): `nvm install 26`.) The launcher says so and exits if
  your Node is older.
- **`meilisearch`** on your `PATH` for search (for instance `brew install meilisearch` on macOS).
  Without it the app still starts and notes work; searching explains why it is off. To use a
  binary somewhere else, set `COMPOSITION_MEILI_BIN`.
- macOS or Linux. Windows is not supported yet.

## Installation

This app imports its data layer from `apps/web` and its Meilisearch process code from
`apps/desktop`, so install the web app's dependencies first. From the repo root:

```bash
(cd apps/web && pnpm install)
cd apps/cli
pnpm install
```

## Usage

```bash
pnpm dev
```

builds the app and runs it. To try it without touching your real notes, give it a scratch home:

```bash
COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm dev
```

(Notes, settings and the search index then all live in that folder.) After `pnpm build`, the app
can also be started with `pnpm start`, or by running `bin/composition.mjs`, which is what the
`composition` command in `package.json` points at.

Press `q` to quit. `ctrl+c` quits too, and both save any edit still waiting.

To choose how images are drawn, set `COMPOSITION_IMAGE_PROTOCOL` to `blocks`, `kitty` or `sixel`. It is
`auto` by default, which picks the best one your terminal reports.

Where things live by default:

| What | Where |
|---|---|
| Notes | `~/.composition/composition.db`, shared with the web and desktop apps |
| Search index | `~/.composition/meili_data` (this app's own; rebuilt from the notes at every start) |
| This app's settings | `~/.composition-cli/settings.json` |

If you used the earlier Python version of this app, its `~/.composition/settings.yaml` is imported
once the first time, and your notes need no conversion.

## Development

```bash
pnpm typecheck         # TypeScript 7, including the web and desktop files this app imports
pnpm test              # vitest: logic tests, and the real UI rendered headlessly over a temp database
pnpm build             # bundle into dist/ with esbuild
pnpm seed              # 100 dummy notes in a scratch home (prints how to open them)
pnpm search:playground # a search> prompt over dummy notes, in a throwaway database and Meilisearch
```

How it is put together is in [docs/architecture.md](../../docs/architecture.md). Two things to know
before changing it:

- **Shared code.** The data layer, search, frontmatter, pane arrangement and the Meilisearch process
  manager come from `apps/web` and `apps/desktop`, through one file, `src/backend.ts`. Changing them
  changes the other apps too. [docs/shared-core-plan.md](../../docs/shared-core-plan.md) describes
  moving them into one package.
- **Never point a test or a script at real notes.** The tests use a temporary home and switch search
  off (`src/testing.tsx`); the tools in `src/tools` write only to scratch folders. When running the
  built app by hand, set `COMPOSITION_DEV_HOME` or `HOME`.
