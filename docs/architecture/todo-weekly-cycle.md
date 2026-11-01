# The to-do weekly cycle

The desktop app's to-do list tidies itself each week. Finished items move to an **archive**, unfinished ones **roll over** for
the owner to place, and every week, month and quarter that had something in it gets a **report**, a Markdown note the owner
can edit. Desktop only: the web app and the terminal app have no to-do panel, and the terminal app ignores the `todos` table.

What the panel looks like and does: [ui/panels.md](../ui/panels.md#the-to-do-panel). To test it by hand:
[manual-tests/todo-archival.md](../manual-tests/todo-archival.md). Why it is this way, decision by decision (T1 to T21), what was
measured and what was left out: [todo-archival-plan.md](../todo-archival-plan.md).

## Where the code is

All of it is framework-free and takes the clock as an argument, like the rest of the data layer, so every rule is tested with a real
temporary database and a fixed date.

| Piece | Files in `apps/web/src/lib/composition/` |
|---|---|
| Dates: weeks, months, fiscal quarters | `todoWeeks.ts` |
| The log, and what an item's status was on a day | `todoEvents.ts` |
| What closing a week does (pure) | `todoSweep.ts` (`planSweep`) |
| The text of the reports, their titles, "My notes" (pure) | `todoReports.ts` |
| The `todos` table and everything done to it | `todosRepo.ts` |
| The cycle: closing weeks, months and quarters, making reports, purging | `todoCycle.ts` |
| Making a report note; the notebook and groups it goes in | `todoReportMaker.ts`, `todoReportsRepo.ts` |
| The to-do settings | `todoSettings.ts` (stored as `todos` in `webSettings.ts`) |
| The contract and its checks | `todosApi.ts`, `todosService.ts`, `TODO_VALIDATORS` in `apps/desktop/src/main/validate.ts` |
| The scheduler, and telling the windows | `apps/desktop/src/main/todoCycleRunner.ts` |
| What the screen holds, and how it sorts the list | `todosStore.ts`, `todos.ts` (`todoSections`, `archiveGroups`), `todoReportList.ts` |
| The panel | `components/panels/TodoPanel.tsx`, `RolledOver.tsx`, `TodoArchive.tsx`, `TodoReports.tsx`, `TodoMenu.tsx`, `TodoBoard.tsx` |
| Settings > To-dos | `app/settings/TodoSettings.desktop.tsx` |

## The model

- **A week** is seven calendar days from a **Week starts on** setting (default Sunday). It closes when the **local date is later than its
  last day**. Everything is local dates written `2026-10-25`, never an instant and never 7 x 24 hours (which is wrong across daylight
  saving). Each event in the log stores the local date and zone offset it happened on, so travelling or changing the machine's time
  zone never moves an item into another week.
- **Four places** for an item: *Rolled over* (waiting to be placed), *This week*, *Backlog* (a status, outside the cycle, never swept) and
  the *Archive*. The list sorts the live items with `todoSections`; sub-items follow their parent, except a rolled sub-item, which is the
  top of its own entry in Rolled over.
- **History is an activity log**, `todo_events`, plus `done_at` on the item, not daily snapshots. Kinds: `created`, `renamed`,
  `status_changed`, `rolled`, `archived`, `restored`. Replaying it gives any item's status on any day (`statusAsOf`), which is how a
  sweep that runs late judges each week **as it stood at the end of its last day**.
- **Columns on `todos`:** `done_at`, `done_on`, `archived_at`, `archive_week`, `archive_reason` (done, removed, dropped),
  `rolled_from_week`, `roll_count`. **Tables:** `todo_events`; `todo_closed` (`kind` is `week`, `month`, `quarter`, and `purge`, which
  holds only the latest day the purge ran); `todo_reports` (the link from a period to its note); `todo_places` (the ids of the reports
  notebook and its three groups).

## What runs, and when

`runCycle(now)` in `todoCycle.ts`, called by the desktop main process **once before the first window opens** (so a week that ended
while the app was closed is already closed when the list is first read) and **every hour** after. It is synchronous, like the database, so
two runs never overlap.

1. **While the To-do plugin is off it does nothing at all.** Turned back on, the next run catches up.
2. **A first run** (no week ever closed) starts all three periods from the latest closed week, month and quarter without touching an item
   and without making a report. If there are completed items, it waits for the owner's answer to *"Archive N items you've already
   completed?"* (`loadTodoSetup`, `finishTodoSetup`): yes archives them, backdated to when they were last changed, and no leaves them
   to go, undated, at the first close.
3. **Otherwise, in one transaction:** close every week that has ended, **oldest first**, so an item keeps the week it first rolled from;
   make a weekly report for each that had something in it; then close the months that ended and the quarters (for the **Fiscal year starts
   in** setting), making a report for each that had something in it. All of it or none.
4. **Purge**, at most once a day: delete archived items whose whole branch is older than the **Keep archived items for** window (default 5
   years; **Keep forever** never purges).

The scheduler tells every window when a run closed a week, made a report or purged something (`composition:todos-changed`); each window
reads the list again and takes the database's notes (`reconcile`), so new reports and their notebook appear without a restart. A run
that throws is logged and the next one goes ahead.

## What closing a week does

`planSweep` (pure) judges every item as it stood at the end of the week, and `closeWeek` applies the plan once (a second call does
nothing):

- An item is **finished** when it is done **and so is everything under it**: it is archived as *done*, filed under that week. A done child
  of an open parent is archived on its own (credited and hidden); a done parent with an open child stays until its subtree is finished.
- An item that is open (`todo` or `in_progress`) **rolls over**: `rolled_from_week` is the first week it rolled from and `roll_count` goes
  up each close it spends waiting. The Backlog is untouched.
- Add to this week, Move to backlog and Drop act on **the item and everything rolled under it**. A restored item comes back as a `todo`
  (what was archived with it comes back as it was); its parent being still archived puts it at the top level.

## Reports

- A report is an **ordinary note** in the notebook **To-do reports**, in the group Weekly, Monthly or Quarterly, tagged `todo-report` and its
  kind. The notebook and groups are found by the ids in `todo_places` (so renaming them is followed), and made again if the owner deleted
  them. A deleted report is **not** made again: reports are made only when a period closes.
- A report is **never rewritten**. **Regenerate** (`generateTodoReport`, or the "Make a report for…" picker, which is the same call for a period
  that has none) makes **another note** for a closed period, as of now; titles carry the minute they were made (seconds on a clash). It is
  refused for a period that has not closed or that is older than the retention window.
- A month's and a quarter's **My notes** are gathered from what the weekly reports say **now**, edited or not, for the weeks whose last day
  falls in it.
- A week, month or quarter in which nothing happened gets no report, so a break leaves no stack of empty ones.
- The cycle is synchronous, so it cannot wait on search: it returns the ids of the notes it made and the main process indexes them,
  best effort, like every note. At launch the cycle runs before search is up; `indexReportNotes` then does nothing, because the app
  indexes every note once Meilisearch is ready, these reports included.

## Delete, and what it does not touch

**Remove** archives a branch (with an Undo that restores it). **Delete permanently** erases the item, everything under it, archived or not,
and their rows in the log. It never changes a report or its link: a report is editable text and cannot be scrubbed reliably, so the
confirmation (`previewTodoDelete`) lists the reports that mention any title in the branch, as links, for the owner to edit first, and warns
that older backup files may still contain the item.

## Backup

Everything above is in the database file, so a backup holds it with no code of its own: items, archive, log, closed periods, report links
and the reports (ordinary notes). The to-do settings travel in `settings.json`. The counts line says `and 8 to-dos (31 archived)` when
there are any. See [backup-restore.md](backup-restore.md).

## Rules not to break

- Week, month and quarter membership comes from **local date strings**, never from instants or 7 x 24 h arithmetic.
- Every migration here stays **idempotent**: restoring a backup made before this feature swaps in a database without the columns and
  tables, and the next open adds them.
- Closing a period is **once only** (`todo_closed` keys it), and the run is **one transaction**.
- A sweep judges an item **as of the end of the week**, from the log; do not judge by the item's status now.
- **A report is never rewritten**, and deleting an item never touches one.
- `runCycle` stays **synchronous**; anything slow or asynchronous (search indexing) happens after it, in the main process.
- The data layer takes the clock as an argument; keep it that way, or the date rules cannot be tested.

## Known limits

- Turning the plugin on does not run the cycle at that moment; it catches up at the next launch or within the hour.
- The week, month and quarter a first run starts from have never been reported on, but are offered by the "Make a report for…" picker.
- The terminal app ignores the `todos` table, so it neither shows nor changes any of this; the reports are ordinary notes and appear in its note
  list like any other (not checked in its own screens).
- `defaultNotebookId` is still the lowest notebook id. The reports notebook is made after the first one, so a stray note could be filed in it
  only if the owner deleted every other notebook.
- The AI narrative for reports (a written summary, as a new note) is not built; it is the planned follow-up.
