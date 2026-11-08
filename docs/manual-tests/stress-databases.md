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
| `--line-notes LIST` | Also add one note per line count in the list (`500,5000,10000`), titled `LINES: 5,000 lines`, ungrouped, in the first notebook. They are written last from a random stream of their own, so asking for them changes no other note. |
| `--line-profile mixed\|plain` | What those notes hold. `mixed` (default) is headings, wrapped paragraphs, lists, code, quotes and tables; `plain` is wrapped paragraphs only. |

## Open it

The web app reads its data location from a settings file, so a scratch settings file keeps `~/.composition` out of it:

```bash
COMPOSITION_SETTINGS_PATH=~/composition-stress/10k/settings.json pnpm --dir apps/web dev
```

Use `pnpm --dir apps/web build` and `start` instead of `dev` when the numbers matter: a development build renders
several times slower, and the app's slowest paths are React rendering. A note you edit is saved into the file, so
open a copy if you want to run the same database twice.

Only the web app has been checked against these files. The desktop and terminal apps open the same `composition.db`.

## Run the stress test from the terminal

One command builds the web app, makes the databases, drives headless Chromium through each one (the sidebar, the note
tabs, typing, autosave, the Home and Settings pages, the `[[` picker), and prints a table of what it found:

```bash
pnpm manual:stress --quick                        # about two minutes: 1,000 notes, load, open and typing only
pnpm manual:stress                                # 1,000 and 10,000 notes, everything (a few minutes each)
pnpm manual:stress --sizes 1k,10k,50k             # add the 50,000-note run (see below)
pnpm manual:stress --skip-build --sections typing # reuse the last build, measure only typing
```

| Option | Meaning |
|---|---|
| `--sizes LIST` | `1k`, `10k`, `50k` or a note count, comma separated. Default `1k,10k`. |
| `--sections LIST` | `load,sidebar,open,typing,autosave,pages,linkpicker` (default all of them). `heavy` opens the big edge-case notes in every editor tab and takes much longer. |
| `--quick` | `1k` with `load,open,typing`. |
| `--lean` | Databases without the giant edge-case notes (`--no-huge`), to see what the note count alone costs. |
| `--seed N` | The databases' seed. Default 1, so runs are comparable. |
| `--results DIR` | Where the output goes. Default `stress-results/<time>` at the repo root (gitignored). |
| `--skip-build` | Do not rebuild first. The default builds, so the numbers match the code you have checked out. |
| `--install-playwright` | Install the pinned Playwright and its Chromium if they are missing. |
| `--keep-databases` | Keep the generated databases instead of deleting them. |

**You need** `pnpm --dir apps/web install`, and Playwright, which `apps/web` does not depend on. `--install-playwright`
installs the version pinned in `apps/web/scripts/sample-db/measure/PLAYWRIGHT_VERSION` into `~/.cache/composition-stress`
(not into the repo); on a fresh Linux machine set `PLAYWRIGHT_WITH_DEPS=1` as well, to get the system libraries Chromium needs.
Or install it yourself (`npm install --global playwright@<that version> && npx playwright install chromium`, with
`NODE_PATH=$(npm root -g)` if it is still not found).

**Output** in the results folder: `summary.md` (the table, also printed), `<size>.json` (every step's timings, for diffing
two runs), `<size>.server.log` (where an error behind a failed step shows up) and `build.log`.

**Exit status:** 0 when every step completed; 1 when a step timed out, a tab crashed or a run stopped early; 2 for a
usage or set-up problem. How slow things are is reported but never fails the run: absolute times move with the machine
(the cloud sandbox these numbers were first taken on ran the same work 3 to 4 times slower after it was restored: the
generator took 1.3–2 s where it had taken 0.5 s), so compare sizes within one run, and runs with each other only on the same
kind of machine. If you want to gate on speed, gate on ratios
between sizes (for example a 10,000-note keystroke against a 1,000-note one in the same run), which cancel the machine out.

**The 50,000-note run** needs about 4 GB for the server and several more for the browser. With the groups open (the app's
default) it killed the browser tab in my runs, so `stress-test.sh` holds every group closed from the start and works in an
ungrouped note for that size, with longer timeouts. That run took about ten minutes. It is not in the weekly run.

To measure one database you already have, without building or generating anything, use the lower-level script:
`NODE_PATH=$(npm root -g) apps/web/scripts/sample-db/measure/run-suite.sh <folder holding composition.db> [sections]`.
The top of `measure/measure.mjs` lists its knobs.

## Notes of 500, 5,000 and 10,000 lines

A second test, for one question: what does the editor do as a single note gets longer? It makes a small database (100 notes,
so the sidebar costs next to nothing and the line count is what changes) with one extra note for each line count, opens each
in the built app on the Split tab, types ten characters on Split, Markdown and Live, and visits Preview.

```bash
pnpm manual:stress:lines                         # 500, 5,000 and 10,000 lines (a few minutes)
pnpm manual:stress --lines 1000,20000            # other line counts
pnpm manual:stress:lines --line-profile plain    # paragraphs only: no headings, lists or code
pnpm manual:stress --sizes 1k --lines            # the 1,000-note run and this one in one go
```

It takes the other options of the stress test too (`--skip-build`, `--results`, `--install-playwright`; `--sections` does
not apply to it). From GitHub, **Actions, Stress test (line counts), Run workflow** lets you pick the line counts and the
profile. It runs only when you start it and never on a schedule; a pull request that changes the workflow or the scripts runs
the 500-line note alone as a smoke test.

**What the notes hold.** A note of *N* lines has *N* body lines (its frontmatter is extra), all hard-wrapped at 80 columns.
`mixed` is a title, then a heading about every 25 lines, with paragraphs, lists, code blocks, quotes and tables between them
(with the default seed: about 20, 160 and 370 headings, and 19, 200 and 390 KB for 500, 5,000 and 10,000 lines). `plain` has no
headings and no markup (29, 290 and 585 KB). Run both to tell the effect of *more lines* from the effect of *more headings*:
the Markdown tab places its heading rail once per heading, so a `mixed` note costs more there than a `plain` one of the same
length ([finding 6](../stress-test-findings.md)).

**Reading the table.** One column per note. Each keystroke row shows the median and the worst key, because a long note can type
quickly and still freeze for seconds now and then. Typing stops after 30 seconds, so a slow note gets fewer than ten keys, and
the cell says how many (`2.3 s / 16 s (5 of 10 keys)`): trust a median over five keys less than one over ten. The results
are `lines.json` (or `lines-plain.json`) in the results folder, with the rest.

## The weekly run

`.github/workflows/stress-test.yml` runs that same script:

- **Every Monday** at 05:17 UTC, on 1,000 and 10,000 notes.
- **On demand**: Actions, Stress test, Run workflow, where you choose the sizes and sections.
- **On a pull request that changes the workflow or `apps/web/scripts/sample-db/`**, as the two-minute `--quick` version, so
  changes to the stress test itself are tried before they merge. No other pull request runs it.

The table is in the run's job summary, and the JSON and logs are kept for 90 days as the `stress-test-results` artifact. The
job is red only on a hard failure (a timeout, a crash, an unfinished run), never on speed. A scheduled workflow runs from
the default branch only, so the Monday run starts once the workflow is on `main`, and GitHub pauses scheduled workflows after
60 days without activity in the repository.

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
