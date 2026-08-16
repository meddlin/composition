# Composition

A terminal-based note-taking app with Markdown support, SQLite storage, and Meilisearch search.

## What it is

Composition is a terminal user interface (TUI) note-taking application built with
[Textual](https://textual.textualize.io/). It's for anyone who wants to write and organize notes
without leaving the terminal.

## What it does

- Write and edit notes in Markdown, directly in the terminal
- Store notes locally in a SQLite database
- Search across all notes with full-text search powered by [Meilisearch](https://www.meilisearch.com/)
- Navigate a fast, keyboard-driven TUI

## Requirements

- Python >= 3.11

## Installation

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
uv sync
```

## Usage

Launch the app with:

```bash
uv run composition
```

Alternatively, once installed, you can run it as:

```bash
composition
```

or:

```bash
python -m composition
```

Press `q` to quit.

## Development

- Install dev dependencies with `uv sync`
- Run tests with [pytest](https://docs.pytest.org/):

```bash
uv run pytest
```

- Lint and format with [ruff](https://docs.astral.sh/ruff/):

```bash
uv run ruff check .
uv run ruff format .
```
