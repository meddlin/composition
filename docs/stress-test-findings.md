# Stress-test findings: the notes browser and the Markdown/MDX editor at 1,000, 10,000 and 50,000 notes

Measured on 2026-11-07 against the web app at `da75aa3`, using the [stress-test databases](manual-tests/stress-databases.md).
Everything below was measured in a production build (`next build` + `next start`) with headless Chromium at 1440×900; method
and limits are at the end.

**In one paragraph.** The editor itself is not the main problem: the Live tab (CodeMirror) opened every note tried, including a
3 MB one in 0.3 s, and with a small sidebar a keystroke costs 19 ms. The problems are around it. The whole workspace, every
note's full text, is sent to the browser in the first page and again after every save; the sidebar draws every note and
group with no windowing and redraws all of them on every keystroke; and the Split and Markdown tabs do work proportional to
the whole note (or worse) when a note is opened and on every keystroke or pause. At 1,000 notes this is a visible lag (about
130 ms a key). At 10,000 notes a keystroke takes 2.5 s. At 50,000 notes the first page takes two minutes to become usable and
the browser tab was killed for lack of memory after fourteen interactions. Separately, **a note of 1,000,000 characters or
more cannot be saved, and the app does not say so**.

## The findings, most serious first

| # | Finding | Severity | Measured at |
|---|---|---|---|
| 1 | A note of 1,000,000+ characters silently fails to save (HTTP 500, logged to the console only) | **Data loss** | exactly 1,000,000 characters |
| 2 | Every note's full text is in the first page; load time and memory grow with the whole database | High | 10,000 notes: 11 s to a first click |
| 3 | Every autosave re-sends the whole workspace (a 198 MB response for one edit at 50,000) | High | 1,000 notes: 19 MB; 10,000: 51 MB |
| 4 | Every keystroke re-renders the whole sidebar | High | 1,000 notes: 130 ms a key; 10,000: 2.5 s |
| 5 | Every other interaction does the same re-render: switching tab, opening a note, sorting, switching notebook | High | 10,000 notes: 1.4–10 s each |
| 6 | The Markdown tab's heading rail lays text out once per heading: a 3 MB note takes ~4 minutes to open | High | a 200 KB note with 136 headings: 1.8 s |
| 7 | Split and Preview re-render the whole note on every keystroke | High | 364 KB: 6–16 s a key; 1 MB of MDX: ~33 s |
| 8 | Hydration fails when the server render and the browser's hydration are on either side of a clock tick | Medium | 3 of 4 loads at 50,000 notes; none below |
| 9 | Memory: 1–1.7 GB in the tab, 3–4 GB in the server at 50,000; the tab was killed | High | 50,000 notes |
| 10 | Smaller things (malformed note links look like live ones; groups reopen when you switch notebooks) | Low | |

### Measured at each size (the three full databases)

| | 1,000 notes | 10,000 notes | 50,000 notes |
|---|---|---|---|
| Database file | 21 MB | 60 MB | 233 MB |
| First page, HTML | 23.5 MB | 84 MB | 354 MB |
| Until a click works | 2.4 s | 11 s | 111 s (136 s when finding 8 hits) |
| Longest single freeze while loading | 0.55 s | 2.8 s | 45 s |
| Browser JS heap / server peak memory | 36 MB / 0.5 GB | 226 MB / 1.1 GB | 1.0–1.7 GB / 3.3–3.8 GB |
| **One keystroke** (median, any of the three tabs) | 0.13–0.15 s | **2.5–2.7 s** | not measured with groups open (tab killed first); 0.44–0.76 s with every group collapsed |
| Switch Markdown / Split / Live / Preview | 0.4–0.7 s | **6–10 s** | tab killed on the first switch; 1.2–2.1 s once everything was collapsed |
| Open a note | 0.2 s | 1.4 s | 7–17 s, growing with each open (0.7–0.9 s collapsed) |
| Collapse all / expand all groups | 0.2 / 0.4 s | 2.0 / 3.9 s | **34 / 30 s** |
| Change the sort | 0.5–0.6 s | 3.3–6.5 s | **17–48 s** |
| Switch notebook (back to the big one) | 0.5 s | 3.8 s | **32 s** |
| Home page | 0.4 s | 4.0 s | 1.4 s (collapsed) |
| Settings page | 0.5 s | 1.0 s | 3.9 s |
| One autosave: response size and time | 19 MB, 0.7 s | **51 MB, 7.6 s** | **198 MB, 64 s** |
| Main thread blocked by that autosave | 0.7 s | 9.5 s | 4.4 s |

Scrolling the sidebar stayed at 15–21 ms a frame at every size, so the list's *length* costs nothing while it sits there;
what costs is drawing it.

---

## 1. A note of 1,000,000 characters or more is not saved, and nothing says so

Editing such a note looks normal: the text stays on screen, there is no error. The save request is answered with HTTP 500
and the store only logs `[notes] not saved: Error: Minified React error #441` to the console. Reloading brings back the old
text. **Data loss for any note over the limit.**

Controlled test (a note's whole text replaced with exactly *T* characters, then the autosave's HTTP status read):

| T | Answer |
|---|---|
| 500,000 / 900,000 / 990,000 / 999,000 / 999,990 | 200, saved |
| **1,000,000** / 1,000,010 / 1,100,000 | **500** |

It also shows in the large-note run: of the 15 notes typed into, the 12 under 364,000 characters were saved and the three
over 1,000,000 (1,000,150, 1,000,188 and 1,017,140) were not (checked by whether the row's `updated_at` changed).

**Cause.** `saveNoteContent(noteId, content)` is a Server Action. React decodes a Server Action's arguments with a default
`arraySizeLimit` of 1,000,000 and adds the length of every string *inside the argument array* to that count
(`bumpArrayCount` in `react-server-dom-webpack-server`, whose message is "Maximum array nesting exceeded"). The note's
text is such a string. The message itself says what to try ("adding intermediate objects"); I did not try it.

**Where.** `apps/web/src/lib/composition/actions.ts` (`saveNoteContent`), `workspaceStore.ts` `flushSaves` (the `.catch` that only
logs). Any other action that passes a long string as a direct argument would hit the same limit; I did not check which do.

## 2. The whole workspace is in the first page

`src/app/page.tsx` calls `loadWorkspace()`, which reads **every note with its full text**, and hands the lot to the client
component as props. The page is 1.2–2.1× the size of the notes' text: 24 MB for 19 MB of notes, 84 MB for 48 MB, 354 MB
for 177 MB. The browser must parse it, build 130,000 DOM nodes at 10,000 notes and 650,000 at 50,000, and hydrate them.

At 50,000 notes the HTML takes 13 s to arrive, the sidebar is **visible after 90 s but not clickable until 111–136 s**, and
the longest uninterrupted freeze is 45 s. During those 20–45 seconds the page looks ready and ignores clicks (they are
queued, not lost: one landed later and changed what my harness was measuring).

The sidebar's content comes from titles and dates; only the editor needs the text. Everything else in this finding follows
from sending the text up front.

## 3. Every autosave sends the whole workspace back

Saving one note returns a response of 4.8 MB (1,000 notes without the giant ones), 19 MB (1,000), 51 MB (10,000) and **198 MB
(50,000, 64 s)**. The request is 2 KB. At 10,000 notes one save held the main thread for 9.5 s.

**Cause.** `saveNoteContent` ends with `revalidatePath("/")`, so the response carries a freshly rendered `/`, which runs
`loadWorkspace()` again: a scan of every note's text on the server, serialized and parsed by the browser for nothing,
because the workspace store is built once from the first page's props (`NotesApp.tsx`, a lazy `useState`) and ignores later
ones. About 25 calls in `actions.ts` do the same. The comment on `saveImage` already says why the others needn't: "the workspace keeps its own copy".
Autosave fires 500 ms after each pause in typing, so someone who keeps typing and pausing pays this repeatedly.

## 4. Every keystroke re-renders the whole sidebar

| Sidebar state (same 10,000 notes in memory, same keys) | DOM nodes | Keystroke, median |
|---|---|---|
| A: big notebook, every group open (the default) | 115,264 | **2,461 ms** |
| B: the same, every group collapsed | 6,735 | 84 ms |
| C: switched to a small notebook, collapsed | 966 | 19 ms (the floor) |
| D: that small notebook (815 notes), every group open | 13,627 | 124 ms |

Of a 2,279 ms keystroke, 2,209 ms is JavaScript and about 1 ms is layout: it is React re-rendering rows, not the browser
drawing them. The notes data is not the cost (case C has all 10,000 in memory), and neither is the editor (the same
keystroke is 19 ms with a small sidebar). The cost is the number of rendered rows, so the workaround is to collapse the
groups. At 50,000 notes collapsing was not enough: about 2,000 ungrouped notes (always listed) and every group row stay
(about 6,600 buttons), and a key still cost 0.44–0.76 s.

**Cause.** `editNote` in `workspaceStore.ts` replaces the `notes` array on every keystroke (`state.notes.map(...)`), and
`Workspace` in `NotesApp.tsx` subscribes to all of it, so `NoteSidebar` and `GroupTree` re-render with new props. Nothing
below that is memoized: `GroupNode` and `NoteRow` are plain components that get fresh `onSelect`/`onDelete` closures and a
fresh `shared` object each time, and every group starts open (`useState(defaultCollapsed)`, default false) so every row exists.
`notes.filter(n => n.notebookId === ...)` also runs on every keystroke (cheap by comparison).

## 5. The same re-render is paid by everything else

Opening a note, switching tab, sorting and switching notebook all change workspace state and so re-render the same tree.
From 1,000 to 10,000 notes (10× the notes, about 10× the rows): opening a note 0.2 → 1.4 s, switching tab 0.4–0.7 → 6–10 s,
sorting 0.5–0.6 → 3.3–6.5 s, switching back to the big notebook 0.5 → 3.8 s. At 50,000 opening a note took 7.3, 9.6, 14.2 and 17.3 s
on four successive opens, so each open also seems to leave the tab with more to do (memory pressure; see 9).

Expand all and collapse all are the same cost again (30–34 s at 50,000). Opening or closing a *single* group is
cheap by comparison (3–4 s at 50,000), since only that group's rows change.

## 6. The Markdown tab's heading rail is quadratic

Opening a note on the Markdown or Split tab places its **Headings** rail (the strip at the editor's left edge) by calling
`caretCoordinates` for each heading. `caretCoordinates` copies the textarea's styles onto a hidden `<div>`, fills it with
*all the text before that heading*, appends it to the page and forces a layout. One per heading: cost is headings × note
size. A CPU profile of switching to the Markdown tab on a 200 KB note put 39% of the time (1.0 s) in that function.

The four notes I opened on that tab fit a single cost, about 0.08–0.13 µs for every character laid out, summed over the
headings (taking each heading's text-before-it as half the note on average):

| Note | Headings | Characters laid out (headings × half the note) | Opening it on the Markdown tab | Per character |
|---|---|---|---|---|
| 200 KB of prose | 136 | 14 million | 1.8 s | 0.13 µs |
| 1 MB of prose | 620 | 310 million | 26 s | 0.084 µs |
| 5,000 headings (528 KB) | 5,000 | 1,320 million | ~120 s | 0.091 µs |
| 3 MB of prose | 1,985 | 2,980 million | **~226 s (nearly 4 minutes)**, the tab frozen | 0.076 µs |

After typing in the 1 MB prose note on the Markdown tab a 22.5 s freeze followed the keystrokes; the headings are recomputed
200 ms after typing stops, which is the likely cause, but I did not profile that case separately. On the same notes the Live
tab opens in 0.3–0.6 s: its rail asks CodeMirror (`lineBlockAt`) and costs nothing. Placing every heading with one mirror
and one layout should remove the quadratic term (not tried).

The rail does not explain everything on this tab: the 20,000-short-line note has **no headings** yet takes 9.7 s to open on
the Markdown tab, so something else there also grows with the number of lines. I did not find it.

**Where.** `headingRails.ts` (`useTextareaRail`), `caretCoordinates.ts`.

## 7. Split and Preview re-render the whole note on every keystroke

`MarkdownEditor.tsx` renders `<NoteMarkdown body={body} />` from the live text with no debounce or deferral
(`useDebouncedValue` is used only by the search box and the heading rail). Every key re-parses the note (remark, GFM, MDX)
and re-renders it, so a keystroke costs the preview's whole render time:

| Note | Open on Split | Keystroke, Split | Keystroke, Markdown only | Keystroke, Live | Open on Live |
|---|---|---|---|---|---|
| 20,000 short lines (364 KB) | 11 s | **6–16 s** | 0.16 s | 0.24 s | 0.7 s |
| MDX document, 1 MB | 38 s | **~33 s** (one key took 2 s, three took 32–34 s) | | | |
| Code document, 1 MB | 50 s | 1.3 s | | | |
| Prose document, 1 MB | 31 s | 0.9 s | 0.17 s | 0.15 s | 0.6 s |
| Prose document, 200 KB | 3.3 s | 0.26 s | 0.12 s | 0.11 s | 0.5 s |
| 60 charts / 300 code blocks / 3,000 task items | 2.2–2.4 s | 0.24–0.31 s | 0.13–0.15 s | 0.12–0.16 s | 0.4–0.6 s |

(These were measured in the 1,000-note database, where the sidebar alone costs about 0.13 s a key, so 0.11–0.24 s in the
Markdown-only and Live columns is close to that baseline.) The shape: Markdown-only and Live type at the baseline whatever
the size of the note; Split pays for the preview on every key. The Preview tab alone took 2.8–3.3 s to switch to on the 1 MB
notes and 14 s on the 20,000-line one. Several notes that do not open on Split within 90 s open on Live in 0.3 s: the 3 MB
prose document, the 1.6 MB code block and the 5,000-heading note.

## 8. Hydration fails when the clock moves between the server render and hydration

React error #418 (a text mismatch) appeared in three of the four 50,000-note loads and in none of the smaller ones. Cause: each
sidebar row shows `relativeTime(note.updatedAt)` ("16 hr ago"), computed from `new Date()` in render (`GroupTree.tsx`, `NoteRow`),
once on the server and once in the browser at hydration. At 50,000 notes those two moments are 90–136 s apart; a note edited
within the last day ticks over from "16 hr ago" to "17 hr ago" in that gap, and the strings differ.

Confirmed at 1,000 notes by running the browser's clock three hours ahead: same error, none with the clocks together. When it
happens React discards the server HTML and renders the tree again on the client, which is more work at exactly the size where
there is already too much (111 s to a first click in the run without the error, 136 s in the runs with it). A skewed clock
between server and browser would do the same at any size; here they share a machine, so the slowness is the cause.

## 9. Memory

At 50,000 notes the page held 1.0–1.7 GB of JavaScript heap and 650,000–1.3 million DOM nodes right after load (the larger
figures presumably count nodes React threw away after the hydration failure), and the server peaked at 3.3–3.8 GB while serving it, 2.8 GB
for the first page alone. After the load and fourteen interactions the renderer was killed ("Target crashed"), and the
sandbox reported that its kernel had killed a process for lack of memory. That sandbox's memory limit is shared and I cannot
tell it from the browser's own, so treat the crash as "likely on a smaller machine" rather than a fixed threshold. In a
second pass (everything collapsed first, which survived) the whole machine was using 11.4 GB of its 16 GB while the server
(3.8 GB at peak) and the tab were running.

## 10. Smaller things

- `[x](note:-1)` and a link to a 40-digit id are drawn as ordinary blue links, while a link to a note that does not exist is
  struck through as documented. (`noteIdFromRef` only accepts digits that fit a safe integer, so these two fall through to
  an unknown scheme, whose address React drops; I did not click them, but they presumably do nothing.)
- Switching notebooks should reset every group to open (the open state is local to each `GroupNode`, by the code), so coming
  back to the big notebook pays for the whole tree again; the 3.8 s (10,000) and 32 s (50,000) "switch back" times match
  the cost of expanding everything.
- Search was not exercised (no Meilisearch here). The `[[` note picker was: its keystrokes cost the same as plain typing
  (2.7 s a key at 10,000 notes), so its title filter over 10,000 notes is not what hurts.

## What held up well

- **The Live editor.** CodeMirror opened every note tried (3 MB prose, a 1.6 MB single code block, 5,000 headings, a
  200,000-character line) in 0.3–0.7 s, and typed at 110–240 ms a key on every note up to 1 MB that I typed into (in the
  1,000-note database, where the sidebar alone costs about 0.13 s of that).
- **Scrolling the sidebar**: 15–21 ms a frame at every size.
- **Small notebooks in a big database.** With 10,000 notes in memory, a small notebook with its groups closed typed at 19 ms.
- **Hostile and malformed input.** 25 correctness edge cases on Split, Live and Preview: no crash, no error boundary,
  no dialog (nothing in `<script>`, `onerror` or `javascript:` content ran), no `javascript:` href reached the page, and invalid MDX (an
  unknown component, `{expressions}`, `import`, unclosed tags) shows a notice and renders as plain Markdown. Emoji, CJK,
  right-to-left text, combining marks, CRLF, tabs, an empty title, titles with quotes, colons, brackets or emoji, and a
  100-level nested quote opened without errors. A chart of exactly 500 rows drew; 700 rows showed "too many to draw (up to 500)".

## Suggested order of fixes

None of these were tried, so the estimates are reasoning from the profiles above, not results.

1. **Save failures** (1). Stop a long note from hitting the argument limit (an object or a route handler instead of a bare
   string), and show a visible "not saved" state when a save fails.
2. **Stop sending the text up front and on every save** (2, 3). Load titles, tags, dates and group links for the sidebar;
   fetch a note's text when it is opened. Drop `revalidatePath("/")` from `saveNoteContent` (the store already has the
   text); check the Router Cache effect on a back-navigation from `/settings` first. Together these remove most of the 354 MB page, the 198 MB
   save, and the memory growth.
3. **Make the sidebar cost proportional to what is on screen** (4, 5, 9). Virtualize the tree, or at least memoize `NoteRow`
   and `GroupNode` with stable callbacks and keep a note's text out of the array the sidebar reads, so a keystroke
   does not reach it. Start large groups closed.
4. **The preview and the rail** (6, 7). Place all the headings with one mirror layout; render the preview from a deferred value; above a size,
   open on Live or pause the preview with a message.
5. **Hydration** (8). Draw relative dates after mount (or give the server and the browser the same text).

## Method and limits

- **Databases:** `apps/web/scripts/sample-db/generate.mjs`; 1,000, 10,000 and 50,000 notes with seed 1, the realistic layout. To
  separate "many notes" from "a few giant notes" I also ran `--no-huge` variants: the whole suite at 1,000 and 10,000 notes, and
  the load step alone at 50,000. Apart from the payload sizes, which follow the amount of note text, they gave the same results
  as the full databases within about 20%, so the count, not the giant notes, drives findings 2–5. A 50,000-note `--layout flat`
  database was generated and checked but not run through the browser.
- **Setup:** `next build` and `next start`, headless Chromium 1440×900 on a 4-core sandbox, a fresh server and a fresh copy of the
  database per run, the default Settings. Meilisearch was not running (so search is untested, and the server logged failed
  indexing attempts, harmlessly). Only the web app was tested; the desktop app serves the same React tree but not through
  Server Actions, so findings 1 and 3 may not apply to it.
- **What a number means:** a step's time runs from the action to the page being responsive again (a `requestAnimationFrame`
  that can only run when the main thread is free); "blocked" is the sum of long tasks (over 50 ms). A keystroke's time is the
  key press to two animation frames, so it has a floor of about 19 ms.
- **Repeats:** each figure is one run, except the ones I reran because they looked wrong or mattered: the 1,000,000-character
  limit (a sweep), the 1 MB notes and the 20,000-line note (rerun in isolation; they matched the first run to within about
  20%), and the 2,000-row table (its first run, 23.7 s, came right after a hung browser was torn down and was an artifact;
  fresh runs took 0.8–0.9 s, and the first figure is not used). The 3 MB and 5,000-heading notes on the Markdown tab were
  measured once. The effects reported are mostly several-fold to a hundred-fold, well above the 10–20% run-to-run noise I saw.
- **Mistakes I made on the way, so they are not repeated:** a leftover server on the same port was measured as if it were the next
  database (fixed: the harness now checks which process owns the port); a click that timed out later landed and left the sidebar
  collapsed for the following steps (fixed: wait for the page to be idle after load); a click at the editor's left edge hit the
  Headings rail, not the editor; `next dev`, run once to profile, rewrote `apps/web/AGENTS.md` (restored, not part of this change).
- **Reproduce:** `pnpm manual:stress` (see [manual-tests/stress-databases.md](manual-tests/stress-databases.md)) builds the
  app, makes the databases and runs the Playwright harness in `apps/web/scripts/sample-db/measure/`; the weekly workflow
  `.github/workflows/stress-test.yml` runs the same script. Absolute times differ from machine to machine: compare sizes within a run.
