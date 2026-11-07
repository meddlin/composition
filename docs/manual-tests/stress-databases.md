# Stress-test databases

Sample databases of 1,000, 10,000 and 50,000 generated notes, for stress-testing the Markdown/MDX editor and the notes
browser. What they found is in [stress-test-findings.md](../stress-test-findings.md).

Every note is sample data: lorem ipsum, generated stories, generated test code (TypeScript, Python, Go, Rust, SQL, shell,
JSON, YAML, CSS, with unit tests among them), MDX notes that use the note components (`<Info>`, `<Warning>`, `<Mark>`,
`<Toc>`, `<Chart>`, `<Footnotes>`, `<Repo>`, `<YouTube>`), and task lists, meeting notes and journal entries that link to
each other with `note:<id>`. The same `--seed` always produces the same file.

## Make one

```bash
pnpm --dir apps/web stress:db --notes 1000  --out ~/composition-stress/1k
pnpm --dir apps/web stress:db --notes 10000 --out ~/composition-stress/10k
pnpm --dir apps/web stress:db --notes 50000 --out ~/composition-stress/50k
```

Each takes under 10 seconds and writes three files into `--out`: `composition.db`, a `settings.json` that points the web
app at it, and a `manifest.json` that says what is in it. `*.db` is gitignored, so keep them outside the repo. The sizes
are about 20 MB, 60 MB and 230 MB.

| Option | Meaning |
|---|---|
| `--notes N` | How many notes, at least 100. The edge-case notes count towards it. |
| `--out DIR` | Where to write. Refuses to replace an existing database unless `--force`. |
| `--seed N` | Random seed. Default 1. |
| `--layout realistic\|flat` | `realistic` (default): several notebooks, groups nested four deep, a few very large groups, about 6% of notes ungrouped. `flat`: one notebook, no groups, every note ungrouped: the worst case for a long list. |
| `--no-huge` | Leave out the edge-case notes tagged `huge` (about 15 MB). Use it to see what the note count alone costs. |

## Open it

The web app reads its data location from a settings file, so a scratch settings file keeps `~/.composition` out of it:

```bash
COMPOSITION_SETTINGS_PATH=~/composition-stress/10k/settings.json pnpm --dir apps/web dev
```

Use `pnpm --dir apps/web build` and `start` instead of `dev` when the numbers matter: a development build renders
several times slower, and the app's slowest paths are React rendering. A note you edit is saved into the file, so
open a copy if you want to run the same database twice.

Only the web app has been checked against these files. The desktop and terminal apps open the same `composition.db`.

## Measure it

`apps/web/scripts/sample-db/measure/` is the Playwright harness the [findings](../stress-test-findings.md) were taken with.
It copies a database, starts the built app on a free port, drives headless Chromium through the sidebar, the note tabs,
typing and autosave, and writes a JSON file of timings (wall time, main-thread blocking, per-key latency, autosave
payloads):

```bash
pnpm --dir apps/web build
NODE_PATH=$(npm root -g) apps/web/scripts/sample-db/measure/run-suite.sh ~/composition-stress/10k
```

It needs Playwright, which `apps/web` does not depend on (`npm i -g playwright && npx playwright install chromium`).
Pass a comma-separated list as the second argument to run only some sections (`load,sidebar,open,typing,autosave,pages,linkpicker`,
or `heavy` for the big edge-case notes), and see the top of `measure.mjs` for the knobs. The 50,000-note run needs about
3 GB for the server and several for the browser, and takes the better part of an hour.

## What is in them

| Part | In a database of N notes |
|---|---|
| Notebooks | 3 at 1,000 notes, 5 at 10,000, 6 at 50,000; the first (the one the app opens) holds 70% of the notes |
| Groups | about N/40, nested up to four deep, sizes heavy-tailed (the biggest group holds 3,752 notes at 50,000) |
| Ungrouped | about 6% of each notebook's notes, always listed under "Ungrouped" |
| Sizes | median about 2 KB, 90th percentile about 7 KB, a few up to 120 KB |
| Frontmatter | written the way the app writes it, with tags, a description on 60% of notes, and dates that rise with the note's id |
| Hand-ordered groups | 5% of groups carry hand-set positions, as if their notes had been dragged into place |

The group **00 Edge cases** (first notebook, about 50 notes, identical in every database of the same options) holds the
shapes most likely to break an editor or a list:

- size: prose, story, code and MDX documents of about 200 KB, 1 MB and 3 MB; one 1.6 MB code block; one 200,000-character
  line; one 100,000-character word; 20,000 short lines; 5,000 headings under a `<Toc />`; a 2,000-row table and a
  40-column table; 3,000 task items; 300 footnotes; 300 code blocks; 60 charts on one note; a chart of exactly 500 rows (the
  limit) and one of 700; 200 `<Mark>` highlights; a list nested 100 levels deep and a quote nested 100 deep
- text: emoji, CJK, right-to-left text, combining marks, zero-width characters, CRLF line endings, tabs
- broken input: an unknown MDX component, `{expressions}` and `import`, unclosed tags, an unterminated code fence, stray `<`
  and `{` in prose, `<script>` and `javascript:` links, links to notes that don't exist, a frontmatter-looking block
  mid-note
- titles: empty, 600 characters, with leading spaces, with quotes and colons, with emoji, and repeated

## What to try

- Time from opening the page to a first click that works (the sidebar's sort menu opening is a good probe).
- Type in an ordinary note on each of the **Markdown**, **Split** and **Live** tabs, with the sidebar's groups open and
  with them all collapsed.
- Open each note in **00 Edge cases** on each tab, then type a few characters and wait for the autosave.
- Collapse all, expand all, change the sort, switch notebooks, open Home, open Settings.
- Type `[[` in a note to bring up the note-link picker.

`generate.test.ts` (run with `pnpm --dir apps/web test scripts/sample-db`) checks that the generator's hand-written schema
is the one the app expects: it opens a generated database through the real data layer and fails if the app would have
to migrate it.
