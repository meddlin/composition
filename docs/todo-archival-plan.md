# To-do archival, weekly rollover and reports: design and build plan

The to-do list tidies itself weekly: done items move to an archive, unfinished ones roll into the next week for the owner to
place, and each week, month and quarter gets a Markdown report the owner can edit. Status: **agreed with the owner (grill-me,
2026-10-30 to 2026-10-31); built, steps 1 to 9, 2026-10-31 to 2026-11-01, uncommitted; waiting for the owner's manual test (Gate I).** How it works now is in
[architecture/todo-weekly-cycle.md](architecture/todo-weekly-cycle.md); this file is the design record and the log of how it was built. Decisions are tagged by who made them: **Owner** answered in the grill; **No
objection** was my proposal at the read-back and the owner raised none; T20 and T21 were found
while writing this plan and accepted by the owner on 2026-10-31. **Inference** is reasoning from a fact, not a measurement.

## Goal

The owner uses Composition mostly at work, and a little at home. The to-do list has two gaps:

1. **Clutter.** Nothing clears done items. Left alone the list only grows, and the only fix is deleting by hand, which is
   permanent ([`deleteTodoTree`](../apps/web/src/lib/composition/todosRepo.ts), "deleted for good" in
   [`TodoPanel.tsx`](../apps/web/src/components/panels/TodoPanel.tsx)).
2. **No record.** Nothing says when an item was done. The table has `created_at` and `updated_at` but no completion time, and
   `updated_at` moves on any edit, a rename included (`updateTodo` in `todosRepo.ts`). A report of "what I did this week" cannot
   be built from it.

So: keep the live list small, keep a history for a window the owner sets (5 years by default), and turn that history into weekly,
monthly and quarterly reports, as Markdown notes.

The work PC and the home PC are **two separate installs** with two databases. Nothing syncs or merges between them (T19).

## What the code does today

- `todos` is `id, parent_id, title, done, status, created_at, updated_at` in [`db.ts`](../apps/web/src/lib/composition/db.ts).
  Items nest without limit; statuses are `backlog`, `todo`, `in_progress`, `done` ([`todosApi.ts`](../apps/web/src/lib/composition/todosApi.ts)).
  The CLI shares the database file and ignores this table.
- The board puts every item, sub-items included, in the column of **its own** status ([`TodoBoard.tsx`](../apps/web/src/components/panels/TodoBoard.tsx)).
  The list shows the tree.
- The to-do list is a **built-in plugin** ([`plugins.ts`](../apps/web/src/lib/composition/plugins.ts)): when off, it "is not
  offered and does not run, but nothing it stored is touched".
- The Trash Can keeps deleted **notes and groups** for 60 days in their own tables ([`trash.ts`](../apps/web/src/lib/composition/trash.ts)).
  To-dos are not in it.
- A backup is a snapshot of the whole database file, so the `todos` table is already in it; only the manifest's counts leave to-dos out
  ([`backupApi.ts`](../apps/web/src/lib/composition/backupApi.ts), `BackupCounts`). See Gate A, finding 3.
- A `note` panel already has Markdown, preview and split views and is editable ([`kinds.ts`](../apps/web/src/components/panels/kinds.ts), `PaneView`).
- Nothing in the app runs on a schedule except the update checker, so anything "at the end of the week" has to **catch up on launch**.

## What is decided

| # | Decision | Who | Notes |
|---|---|---|---|
| T1 | **The week.** Seven days from a **Week starts on** setting (default Sunday). It closes at local midnight after its last day, in the system time zone. Weekends are not special | Owner | Replaces the first draft's Mon-Fri week. Work done on a Saturday belongs to the week it falls in. "Closes at local midnight" is implemented as "the local date is later than the last day" (Gate A, finding 1) |
| T2 | **Four places.** *Rolled over*, *This week*, *Backlog*, *Archive*. Backlog is one global list, never swept, the same every week. A new item lands in This week; Backlog has its own add box | Owner | Backlog is the existing `backlog` status, so the board already has it as a column |
| T3 | **History is an activity log plus `done_at`, not daily snapshots.** The log is never shown | Owner (purpose), No objection (mechanism) | Snapshots cannot say when something was done, miss changes made and undone in one day, and need the app open at the right moment. The log holds the same information plus those, and replaying it rebuilds any past day |
| T4 | **The sweep** runs at launch and then hourly while the app is open, handles each closed week **in order** (a holiday loses nothing), in one transaction, so it is idempotent and two windows cannot double-run it | No objection | Each week is judged by how every item stood **at the end of its last day**, rebuilt from the log, so a sweep that runs late cannot roll an item the owner pulled into the new week on Sunday (built in step 2). The hourly timer is only there so a Saturday-night open window still closes the week |
| T5 | **Sub-items.** Each item is credited and archived on its own. A subtree is archived once **everything in it is done**; otherwise its done children are hidden but keep their `parent_id`, and the live parent stays | Owner | A done parent with open children stays in the list as done until its subtree is finished |
| T6 | **Rolled over.** Open `todo` and `in_progress` items from This week move to a *Rolled over* section, labelled with the week they came from and how many times they rolled. Three actions: **Add to this week**, **Move to backlog**, **Drop**. Untouched items stay and read "waiting N weeks" | Owner (the three actions), No objection (the rest) | After about three rolls a subtle nudge appears; nothing happens by itself. Moving to backlog clears the roll count |
| T7 | **Remove and Delete permanently.** The row's trash icon becomes **Remove** (archives the item as *removed*, with an Undo toast). **Delete permanently...** sits in a small menu beside it and in the Archive view; it erases the item, its sub-items and their log rows. **Restore** returns an archived item to This week as `todo`; history is never rewritten | Owner | Restoring an item whose parent is still archived puts it at the top level, and sub-items archived in the same action come back with it (owner, step 3). Removed items are not "done", so no report lists them. The delete confirmation warns that older backup files may still contain the item |
| T8 | **Retention.** The clock is the latest activity anywhere in an item's subtree; a subtree is purged only when all of it has outlived the window. Default 5 years, a custom value (minimum 1 month), or **Keep forever**. Lowering the window shows the exact number of items that would be deleted at once and needs a confirmation. The purge runs at most once a day | Owner (clock, Keep forever, warning), No objection (1-month minimum) | Covers items and the log **only**. Reports are never purged by it (T10) |
| T9 | **Reports are real notes**, in their own notebook, **To-do reports**, with Weekly, Monthly and Quarterly groups. They open in the existing note panel | Owner | Search, tags, backup and the CLI come with notes. Deleting a report is a normal note delete: 60 days in the notes' Trash Can, then gone. The to-do items never go there |
| T10 | **Reports stay until the owner deletes them and outlive the items they were built from.** A report is **never rewritten**: *Regenerate...* makes a new note. Titles carry the period and a generation time, to the minute (seconds added on a clash): `Weekly 2026-10-25 -> 2026-10-31 . generated 2026-11-01 14:03`, `Monthly 2026-10 . generated ...`, `Quarterly 2026 Q4 . generated ...` | Owner | Regenerate is offered for closed periods whose items have not been purged. A deleted report is not recreated on its own. No mid-week preview |
| T11 | **Weekly template**: `# Week of ...`, Summary (Completed, Added, Carried over, Dropped), Completed (items under their parents), Carried over (with roll count), Dropped, **My notes** (empty) | Owner | No template editor in v1: any report can be edited by hand. As built, an empty section reads "None.", and a parent shown with completed sub-items beneath it is in bold, with "(done)" when it was completed in the week too. Monthly and quarterly reports list the **top-level** completed items with a sub-item count, plus a by-week or by-month line (step 2) |
| T12 | **Monthly and quarterly** reports are built from the data by **completion date**; a week that straddles a boundary shows in both, marked "partial week". Each week's **My notes** are gathered from **every** report of that week (non-empty ones, oldest first, identical duplicates skipped) and attached to the month and quarter containing the week's **last day**. Quarters follow a **Fiscal year starts in** setting; a fiscal year is **named by the year it ends in** (owner, 2026-10-31): one starting October 2026 is 2027, so October to December 2026 is "2027 Q1" | Owner | Every week attached to a month has closed by that month's end, so a monthly report never waits on a future week. Notes written after it was made need a Regenerate |
| T13 | **Permanent delete does not touch reports.** Its confirmation lists the reports whose text mentions the item (matched by title) with links, so the owner can edit them | Owner | Reports are editable text and cannot be scrubbed reliably |
| T14 | **Storage.** Flags on `todos` (`done_at`, `done_on`, `archived_at`, `archive_week`, `archive_reason`, `rolled_from_week`, `roll_count`), added with `ensureColumn`; new tables `todo_events` (the log, with the local date and zone offset of each event), `todo_closed` (which weeks, months and quarters the sweep has dealt with) and `todo_reports` (period, kind, note id, generated at). **Built in step 2** | No objection | The CLI ignores `todos`, so the notes' separate-table trick (a flag would show up there) is not needed |
| T15 | **First run.** A one-time prompt: "Archive N items you've already completed?" On yes, `done_at` is taken from `updated_at` and the items are filed under the weeks that date falls in. **No past reports are generated** | Owner (prompt), No objection (no backfill) | Dozens of notes made from guessed dates would be noise |
| T16 | **Backup and Restore** include to-dos, the archive, the log and the report links; the counts line shows them | Owner | They already travel in the database snapshot (Gate A, finding 3); the work is the counts line and a round-trip test. Report notes travel as ordinary notes |
| T17 | **Panel.** The view switcher becomes **List, Board, Reports, Archive**. The list has collapsible sections (Rolled over only when non-empty, This week, Backlog); sub-items follow their parent. The board keeps its four columns with Rolled over as the same strip above them. Reports lists Weeks, Months, Quarters, newest first (every generated copy), and opens one in a note panel. Archive is searchable, grouped by the week archived, labelled done, removed or dropped, with Restore and Delete permanently | Owner | |
| T18 | **Settings.** A **To-dos** section: Week starts on, Keep archived items for (with the delete-count warning), Fiscal year starts in. The to-do background stays under Styling | Owner | Hidden while the plugin is off, like the other plugin settings. **Built in step 4**, as a card in the General tab after Panels; the window is 1 to 600 months or Keep forever |
| T19 | **One pool, two installs.** No Work/Home contexts. Each install keeps its own history; Backup and Restore moves a whole history but replaces rather than merges | Owner | |
| T20 | **Plugin off pauses everything.** While the To-do plugin is off the sweep, report generation and purge do not run; turning it back on catches up week by week. Reports already made stay, as ordinary notes | Owner (accepted 2026-10-31) | Follows the plugin rule "does not run". Cost: the retention purge overshoots while off |
| T21 | **A week with no activity makes no report** (nothing completed, added, rolled or dropped) | Owner (accepted 2026-10-31) | Avoids a stack of empty reports after a holiday or after turning the plugin back on. The owner can still Regenerate any week by hand |

## How it behaves

- **A week closes** (first run of the sweep after local midnight following its last day). Done items are archived by T5. Open `todo` and
  `in_progress` items move to Rolled over with `rolled_from_week` and `roll_count` set. Backlog is untouched. The weekly report is made.
  If a month or quarter also closed, those reports are made too.
- **Several weeks missed.** They close oldest first, so each item keeps its true origin and each report its true period.
- **Ticking.** Ticking sets `done_at` and logs `completed`; unticking clears `done_at` and logs `reopened`. The earlier completion stays
  in the log, so a week already reported on is not changed behind its back.
- **A backlog item ticked directly** counts for the week it was ticked in.
- **Restoring from the archive** logs `restored` in the current week; the old completion stays with its original week.
- **Reports.** The generator is pure: items plus log in, Markdown out. It writes a note into To-do reports through the notes service
  and records the link in `todo_reports`. If the owner has deleted the notebook or a report, the link is dangling and treated as missing.

## Architecture

New files are proposed names, not decisions.

| Layer | New or changed | Mirrors |
|---|---|---|
| Pure rules | `todoWeeks.ts` (week start and end from a date and a start day, month and fiscal-quarter periods), `todoSweep.ts` (what a sweep archives and rolls, given items and now), `todoReports.ts` (Markdown, titles, extracting **My notes**) | `todos.ts` |
| Schema | `ensureColumn` calls and `todo_events`, `todo_reports` in [`db.ts`](../apps/web/src/lib/composition/db.ts) | `TODOS_SCHEMA` |
| Repo and service | `todosRepo.ts` writes the log on every change; archive, remove, restore, delete permanently, purge; `todosService.ts` validates | existing |
| Contract | `TodosApi` and `TODO_METHODS` in `todosApi.ts`; the `Todo` type gains `doneAt`, `archived`, `rolledFromWeek`, `rollCount` | existing |
| Bridge | validators, IPC, preload, `todosClient.ts`, the `smoke.mjs` method list | the `TODO_*` entries |
| Store | `todosStore.ts` (sections, archive, rolled-over actions) | existing |
| Runner | the sweep scheduler in the desktop main process (todos already live there), gated on the plugin; it tells open windows to reload | `popoutManager.ts` broadcasts |
| Panel | `TodoView` in [`kinds.ts`](../apps/web/src/components/panels/kinds.ts) gains `reports` and `archive` (old saved states still restore); `TodoPanel.tsx` sections; new rolled-over, archive and reports views | `TodoBoard.tsx` |
| Settings | `TodoSettings.desktop.tsx` plus keys in [`webSettings.ts`](../apps/web/src/lib/composition/webSettings.ts), shown only while `useSettingsPluginEnabled("todo")` | `TodoLookSettings.desktop.tsx` |
| Backup | `BackupCounts` and `countRows` in `backup.ts` gain to-dos; the snapshot already contains every table | existing |

## Gate A: what the spike found (2026-10-31)

Three questions, answered by an experiment (risk 1) and by reading the code (risks 2 and 3). The spike was a scratch script and is deleted.

**1. Time zones and daylight saving: confirmed, and it sets two rules.**

- A week must be computed from **local calendar dates**, never as 7 x 24 hours. Walking week starts in `America/New_York`, 7 x 24 h arithmetic
  put the week after the 2026-11-01 fall-back at `11-07 23:00` instead of `11-08 00:00`, and the week after the 2027-03-14 spring-forward at
  `03-21 01:00`. `new Date(y, m, d + 7)` was right in all four zones tried (New York, Tokyo, Auckland, Havana).
- **"Local midnight" cannot be an instant.** In Havana, DST starts at midnight, so `new Date(2026, 2, 8, 0, 0)` is `01:00`. A week closes when the
  local date is **later than its last day**, which is what T1 means.
- **The same instant lands in different weeks by zone.** `2026-11-01T03:30Z` is Saturday 31 Oct, 23:30 in New York (week of 25 Oct) but Sunday
  1 Nov in Tokyo and Auckland (week of 1 Nov). So every `todo_events` row stores the **local date** (and the zone offset) it happened on, and week,
  month and quarter membership comes from that. Travelling, or changing the machine's zone, then never moves an item into another week.

**2. Making notes from the sweep: workable as is.**

- The main process already calls `service` for every note action. `service.createNote(title, groupId, notebookId)` makes the note with empty
  content and indexes it; `service.saveNoteContent(noteId, content)` writes the text and reindexes. Indexing is Meilisearch and **best effort**
  (a failure is logged, not thrown), so a report is searchable like any note, and, like any note, is missed until the next reindex if Meilisearch is down.
  Two index calls per report is wasteful: give `createNote` an optional `content` argument (`notesRepo.createNote` already takes it).
- `service.createNotebook` and `createGroup(name, parentId, notebookId)` exist, so the notebook and its three groups are plain calls.
- **Deleting the notebook is survivable.** `deleteNotebook` refuses a notebook that still holds notes or groups (they have to go to the Trash Can
  first), deletes an empty one for good, and always keeps the last notebook. The sweep must find the notebook and groups by stored id and recreate
  any that are missing. A report in the Trash Can keeps its id (`trashed_notes`), and a restored note whose notebook is gone lands in the default
  notebook, so `todo_reports` links by note id stay valid either way.
- **One edge.** `defaultNotebookId()` is the lowest notebook id, and anything orphaned (a note an older CLI wrote, a restored item) is filed
  there. "Notebook" is created when the database opens, before any report, so To-do reports is not first, unless the owner deletes every
  lower-numbered notebook. If wanted, `defaultNotebookId` skips the reports notebook; decide at step 8.

**3. Restore and ids: no problem, and a correction to what I said in the grill.**

- A backup is a `VACUUM INTO` snapshot of the **whole database** (`composition.db`), plus images, attachments and every setting except the data
  location (`portableSettings`). Restore swaps that file in unchanged, after a pre-restore safety backup. **Ids are never renumbered**, so
  `todo_reports` links survive a restore.
- **I said Backup and Restore skipped to-dos. That was wrong in substance.** The `todos` table is inside the database file, so to-dos are
  already in every backup; only the manifest's `counts` (`BackupCounts`) leave them out. The new tables, the new columns and the new To-dos
  settings (week start, retention, fiscal year) travel the same way with no backup code. T16 shrinks to: show to-dos in the counts line, and a
  round-trip test.
- Restoring a backup made **before** this feature swaps in a database without the new columns and tables. `openConnection` re-runs its idempotent
  migrations on the next open ([`db.ts`](../apps/web/src/lib/composition/db.ts)), so this works as long as every migration stays idempotent.

## Risks to settle before building

1. **Sub-item edge cases.** Done parent with open children, open parent with done children, a child in a different place from its parent.
   Needs a table-driven test list written before the code (T5).
2. **Catch-up cost.** Months of missed weeks should close in one transaction without freezing launch; measure it with a database of years of items. **Measured in step 6:** 3 years of weeks closed in 0.2-2.2 s for 500-5,000 items; fine.
3. **Existing saved panel layouts** hold `view: "list" | "board"`; the new views must not make them fail to restore.
4. **Nothing yet says what the CLI does with a notebook it did not make.** It lists every note, so the report notes appear there. Expected to be harmless; confirm.
5. **The default-notebook edge** from Gate A, finding 2: whether `defaultNotebookId` should skip the reports notebook.

## Build order

Each step ends with a gate; do not start the next until it has passed. Pure rules get their tests first, as `todos.test.ts` does.

1. **Spike (throwaway), Gate A. Done 2026-10-31**; the answers are in "Gate A: what the spike found" above.
2. **Schema and pure rules. Done 2026-10-31, built test-first; Gate B passed, awaiting the owner's look.** Columns, tables, `todoWeeks`, `todoEvents`,
   `todoSweep`, `todoReports` (all in `apps/web/src/lib/composition/`), with table-driven tests (week boundaries across daylight saving,
   straddling months, T5 cases, report text). **Gate B:** the whole web suite is green (163 files, 2,539 tests), `tsc --noEmit` and ESLint are clean on
   the new files, the pure-rule suite also passes under `TZ` set to New York, Auckland, Havana and Tokyo, and the CLI opens the migrated database
   (it reaches it through the same `db.ts`). The CLI's own suite has 8 failing files here (144 tests), **identical on an untouched copy of the previous
   commit**: this machine runs Node 24 and the CLI needs 26.10 (OpenTUI's native library, and Meilisearch, are not available). Not caused by this change.
   What was built and decided on the way:
   - `todoWeeks`: local-date strings only; `weekOf`, `latestClosedWeek`, `weeksToClose`, `monthOf`, `monthsToClose`, `fiscalQuarterOf`, `quartersToClose`,
     `localDateOf`. A changed start day gives a short first week, so no date is missed or counted twice.
   - `todoEvents`: the event type (kinds `created`, `renamed`, `status_changed`, `rolled`, `archived`, `restored`; "completed", "dropped" and "removed" are not
     kinds of their own, they are `status_changed` to done and `archived` with a reason) and `statusAsOf`.
   - `todoSweep`: `planSweep` judges every item **as it stood at the end of the week**, rebuilt from the log, because the sweep can run late.
   - `todoReports`: `reportTitle`, `renderWeeklyReport`, `renderMonthlyReport`, `renderQuarterlyReport`, `weekHadActivity` (T21), `extractMyNotes`, `gatherWeekNotes`.
   - The schema is in [`db.ts`](../apps/web/src/lib/composition/db.ts); `db.test.ts` covers a new file, an older database upgraded in place, and reopening.
3. **Repo, service and log. Done 2026-10-31, built test-first; Gate C passed, awaiting the owner's look.** `done_at`, an event for every change, archive, remove,
   restore, delete permanently, purge with its count. **Gate C:** `todosRepo.test.ts` (32 tests) runs against a real temporary database with a fixed clock and
   the time zone pinned to New York, so local dates and offsets are asserted as literals; the whole web suite (164 files, 2,571 tests), `tsc --noEmit`, ESLint
   on the changed files, and the desktop app's type-check and 455 tests all pass. What was built, all in
   [`todosRepo.ts`](../apps/web/src/lib/composition/todosRepo.ts) (the clock is passed in, defaulting to now):
   - **The log.** `addTodo` and `updateTodo` write `created`, `renamed` and `status_changed` events in one transaction with the change itself; a change that
     changes nothing writes nothing. Ticking stores `done_at` and `done_on`; unticking clears them (the log keeps the completion). `listTodoEvents` reads it.
   - **Archive.** `archiveTodoTree(id, "removed" | "dropped", startDay)` archives the item and every sub-item not already archived (one that is keeps its reason),
     filed under the week `startDay` makes it, one `archived` event each. `listTodos` is now the **live** list; `listArchivedTodos` reads the archive.
   - **Restore.** `restoreTodo` brings the item back as `todo` with the sub-items archived **in the same action** (sub-items archived earlier stay archived). An item
     whose parent is still archived, or gone, comes back at the **top level** (owner, 2026-10-31). The earlier completion stays in the log.
   - **Delete for good.** `deleteTodoTree` now also erases the log rows of the item and everything under it, archived or not. It is still what the existing
     `deleteTodo` calls, so the UI is unchanged until step 6 switches the trash icon to Remove.
   - **Closing a week.** `closeWeek(plan)` applies a sweep plan once, in one transaction: archives the finished items as done, marks the open ones rolled, logs both
     against the week that closed (whenever the sweep ran) and records the week in `todo_closed`. A second call does nothing; an item deleted since the plan
     was made is skipped. `lastClosedWeekEnd` and `markWeekClosed` (how a first run starts without touching items) support the runner.
   - **Rolled over.** `acceptRolledTodo` ("Add to this week") clears `rolled_from_week` and keeps the count; moving an item to the backlog clears both.
   - **Purge.** `previewPurge` and `purgeExpired(windowMonths | null)`: only archived items; a branch goes only when all of it is archived and all of it is older than the
     window, by the latest of made, changed, done and archived; `null` keeps everything. The log rows go with them.
   - **Contract.** `Todo` gained the optional `doneAt`, `rolledFromWeek` and `rollCount`; `ArchivedTodo` is new; `TodoEvent` gained `utcOffset`.
   - **Not in this step, on purpose.** The service wrappers for the new operations (they read the week start and the retention window from Settings, which is step 4,
     and are typed by the `TodosApi` contract, which is step 5) land with step 5. Nothing calls `closeWeek` or `purgeExpired` yet: that is the runner in step 6.
4. **Settings and Backup. Done 2026-11-01, built test-first; Gate D passed, awaiting the owner's look.** The To-dos settings, the retention warning, to-dos in the
   Backup counts line. **Gate D:** a backup round trip keeps items, archive, log and report links (`backup.test.ts`, through `service.createBackup` and
   `restoreBackup`, comparing the live list, the archive, the whole log, `todo_closed`, `todo_reports` and the to-do settings before and after). The whole web suite
   (167 files, 2,606 tests), the desktop suite (466), `tsc --noEmit` in web, desktop and CLI, and ESLint on the changed files all pass; the CLI's own suite shows the
   same 8 failing files (144 tests) as untouched HEAD (Node 24 here, 26.10 needed). The card was also driven in the **real built desktop app** (a scratch Playwright
   script, not committed): defaults shown, each choice saved to the app's own settings file, the warning counted exactly the 3 old archived items of 4 seeded, Cancel
   saved nothing, hostile bridge calls were refused. What was built, and decided on the way (owner, 2026-11-01: seams, bridge scope, counts wording):
   - **The settings.** [`todoSettings.ts`](../apps/web/src/lib/composition/todoSettings.ts): `TodoSettings { weekStartsOn (0-6), retentionMonths (1-600, or null for Keep
     forever), fiscalYearStartMonth (1-12) }`, defaults Sunday / 60 / January, `parseTodoSettings` (repairs each bad value alone; `null` is kept, missing is 5 years)
     and `validateTodoSettings` (refuses, with a reason; returns only the three fields). Stored under `todos` in [`webSettings.ts`](../apps/web/src/lib/composition/webSettings.ts),
     so a backup carries them (`portableSettings` keeps everything but the data location). The 600-month ceiling (50 years) is new; beyond it, Keep forever.
   - **Three bridge methods, pulled forward from step 5** because the form needs them: `loadTodoSettings`, `saveTodoSettings` (merged into the stored settings, nothing else lost)
     and `previewTodoPurge(months | null)` (the number `previewPurge` gives, deleting nothing). They are in `TodosApi` and `TODO_METHODS`, the service, `TODO_VALIDATORS` (the
     page's settings rebuilt from the three checked fields; the window refused unless 1-600 or null), `todosClient.ts` and `unavailableTodos`. IPC, preload and the smoke
     list derive from `TODO_METHODS`, so they needed nothing by hand.
   - **The form.** [`TodoSettings.desktop.tsx`](../apps/web/src/app/settings/TodoSettings.desktop.tsx) (the web build gets a `TodoSettings.tsx` that renders nothing, like `PanelSettings`):
     a card titled **To-dos** in the **General** tab after Panels, hidden while the To-do plugin is off. Week starts on and Fiscal year starts in are dropdowns; Keep archived items
     for offers 1, 2, 3, 5 and 10 years, **Keep forever** and **Other (months)**, which shows a months box (committed on blur or Enter, refused with a reason outside 1-600). Each change
     saves at once and is put back, with the reason, if the save fails. **A shorter window** (any number shorter than today's, or a number replacing Keep forever) first asks how many archived
     items it would delete; if any, it says "N archived items are older than 1 year and will be deleted for good the next time the to-do clean-up runs" and waits for **Keep for 1 year** or
     **Cancel**; if none, it just saves. Nothing deletes yet: the clean-up that runs the purge is step 6.
   - **Backup counts.** `BackupCounts` gained `todos` (live) and `archivedTodos`; `countRows` reads them as all rows less the archived ones, so a backup from before the weekly cycle (no
     `archived_at` column) counts everything as live. `describeCounts` adds `and 8 to-dos (31 archived)` only when there are any (just `8 to-dos` with an empty archive, `0 to-dos (31 archived)` with
     nothing live), so an install with none reads exactly as before; the CLI shares the same line. Nothing else in backup or restore changed: the snapshot already held every table (Gate A, finding 3),
     so the round-trip test passed without new backup code.
   - **Not in this step, on purpose.** Reading the settings from the sweep (week start), the report generator (fiscal year) and the purge (window) is step 6 and 8; the settings are only stored and edited here.
5. **Bridge (the rest). Done 2026-11-01, built test-first; Gate E passed, awaiting the owner's look.** The archive operations the list, board and Archive view need, from the service to
   the page. **Gate E:** the existing `ipc.test.ts` (it loops over every `TODO_METHODS` entry, so it covers the new ones with no change) and the **desktop smoke: 121 checks pass** (115 before,
   plus 6 new ones that remove, list, restore and delete a to-do over real IPC, check the refusals, and drive the To-dos card). The web suite (167 files, 2,615 tests), the desktop suite (472),
   and `tsc --noEmit` in web, desktop and CLI pass. What was built, and decided on the way (owner, 2026-11-01: seams, edge rules):
   - **Five methods** in `TodosApi` and `TODO_METHODS`: `listArchivedTodos`, `removeTodo(id)` (archives the item and its sub-items as *removed*, filed under the week the Week-starts-on setting makes; the Undo is
     `restoreTodo`), `dropTodo(id)` (as *dropped*), `restoreTodo(id)` (returns `{ toTopLevel }`) and `acceptRolledTodo(id)` ("Add to this week"; returns the item). **Moving a rolled-over item to the backlog needs no new
     method**: `setTodoStatus(id, "backlog")` already clears the rolled-over marker and the count. `deleteTodo` is unchanged in code and is now documented as **Delete permanently**: it erases an archived item too, with its log rows.
   - **Edge rules, strict where it protects meaning.** Remove, Add to this week on a missing item: "That to-do no longer exists." Remove on an item already archived does nothing. Add to this week on an item that is not in Rolled over
     returns it unchanged. Restore of an item not in the archive: "That to-do is not in the archive." **Drop works only on an item waiting in Rolled over** ("That to-do is not waiting in Rolled over."), so *dropped* always means that.
   - **Restore**, as built in step 3: the restored item becomes a `todo`; sub-items archived with it come back **as they were** (an in-progress sub-item stays in progress), which is what makes Remove then Undo a round trip for a branch.
   - **Validators** take only a whole-number id (the page's other arguments are dropped); the archive listing takes nothing. IPC, preload and the smoke's method list derive from `TODO_METHODS`. `todosClient.ts` and `unavailableTodos`
     have the five, and the two in-memory fakes in older tests (`TodoPanel.test.tsx`, `todosStore.test.ts`) have do-nothing stand-ins that step 6's store tests will make real.
   - **Left for the step that needs them, on purpose:** the first-run prompt's two calls (count and archive the already-completed items, T15) with the runner in step 6; the report list for Delete permanently (T13) with the Archive view in step 7;
     everything about reports in step 8. Nothing calls these methods from the UI yet, so the trash icon still deletes for good until step 6.
6. **Sweep runner, store and the weekly cycle. Done 2026-11-01, built test-first; Gate F passed, awaiting the owner's look.** Scheduler gated on the plugin, first-run prompt, Rolled over section and its
   three actions in list and board, Remove with an Undo. **Gate F:** the web suite (168 files, 2,687 tests), the desktop suite (479), `tsc --noEmit` in web, desktop and CLI, and ESLint on the changed files pass; the CLI's
   own suite shows the same 8 failing files (144 tests) as untouched HEAD. **The desktop smoke passes: 121 checks** (it also checks the bridge's member list, which gained `onTodosChanged`). Its first run of this step stopped after 84 checks, waiting 30 s for a second pop-out to close after "Move back to main window"; the immediate rerun passed all 121. No pop-out code, and nothing about to-dos, is touched by this step, but that is one failure and one pass, so watch for it. The plain `web` server cannot show the
   to-do panel (it is desktop-only), so the panel was **driven in the real built desktop app** with a scratch Playwright script (not committed) on two seeded throwaway databases: one three weeks behind (14 checks: the weeks
   closed at launch before the window read the list, rolled branch with its nudge, a rolled sub-item of a done parent labelled "in Move house", the three actions in list and board, Remove and Undo, a change announced by the main process
   showing up without a reload, a relaunch closing nothing twice) and one that looked like a first run (5 checks: the question, a yes, the archive filed under the right week, not asked again). What was built, and decided on the way
   (owner, 2026-11-01: seams, whole-branch actions, what "No" means):
   - **The cycle** ([`todoCycle.ts`](../apps/web/src/lib/composition/todoCycle.ts), framework-free, clock passed in): `runCycle(now)` does nothing while the To-do plugin is off (T20); on a first run it starts from the week that has just closed
     without touching an item (or waits for the question, below); otherwise it plans every closed week oldest first (`planSweep`) and applies them in **one transaction** (`closeWeek` each), so an item keeps the week it first rolled from;
     then purges, **at most once a day** (`claimDailyPurge`, a `purge` row in `todo_closed`, only the latest day kept), unless the window is Keep forever. It returns `{ awaitingSetup, closedWeeks, purged }`.
   - **The scheduler** ([`todoCycleRunner.ts`](../apps/desktop/src/main/todoCycleRunner.ts)): runs once **before the first window opens** (so a week that ended while the app was closed is already closed when the list is first read), then every hour;
     tells every window (`TODOS_CHANGED_CHANNEL`, `onTodosChanged` in the preload and bridge type) only when a week closed or items were purged; logs a failed run and carries on; stops at shutdown. `run` is synchronous, like the database, so two runs cannot overlap.
     Each window's workspace re-reads the list on that event (`reload`).
   - **First run (T15), and what No means.** `loadTodoSetup` / `finishTodoSetup(archiveCompleted)`. The question is asked while no week has ever been closed and there are done items whose whole branch is done (the sweep's own rule). **Yes** archives them as done,
     backdated: an item with no completion date takes the day it was last changed, which is also written to the log as a completion (so a month's report counts it), and each is filed under the week that date falls in; no report is made for those weeks.
     **No** archives nothing now: they go at the first week close with no date, so no report counts them. Either answer starts the cycle; answering again does nothing (two windows).
   - **Rolled over acts on whole branches** (owner's choice). `acceptRolledTodo` (Add to this week) now also clears the marks of everything rolled under the item; the new `moveRolledTodoToBacklog` sends the top item to the backlog and clears the marks of the whole branch (sub-items keep
     their own status); Drop archives the branch. Like Drop, Move to backlog only works on an item waiting in Rolled over. `todoSections` (pure) sorts the live list: a rolled item is the top of its own entry in Rolled over even when its parent is not rolled (it is shown "in Plan trip" and taken out from under the parent);
     every other top-level item is in Backlog or This week by its status, with its sub-items beneath it; the rolled mark wins over the backlog status.
   - **Store.** `reload`, `remove` (now archives; `restore` is the Undo), `acceptRolled`, `moveRolledToBacklog`, `drop`, `finishSetup`, `add(title, parentId, "backlog")`, and `setup` in the snapshot. A refused change puts back what is stored, as before.
   - **Panel.** The list has the three sections, each folding away (saved as `foldedSections` in the panel's state; a panel saved before this restores with none folded): Rolled over (only while something waits there; "From the week of Oct 11 - waiting 3 weeks"; a gentle nudge from the third roll; the three actions), This week, and Backlog with its **own add box**.
     The board puts Rolled over in a **strip above the four columns** and keeps those items out of them. **The trash icon is now Remove**: it archives at once and asks nothing, with a "Removed ... Undo" bar for eight seconds (the app had no toast, so it is in the panel). The first-run question is a banner in both views. An item restored from the archive is a `todo` again, so Undo of an in-progress item returns it to To-do.
   - **Catch-up cost (risk 2), measured.** Three years of missed weeks (156) close in one transaction in 0.23 s for 500 items, 0.9 s for 2,000 and 2.2 s for 5,000, on this machine; a live list stays small because done items leave every week.
   - **Shared test backend.** `todosMemoryBackend.ts` is an in-memory `TodosApi` that follows the service's rules on the points a screen can see; the store and panel tests both use it, replacing two hand-written fakes.
   - **Not in this step, on purpose.** Month and quarter closing and the reports (step 8); Delete permanently from the list and the Archive view with its report list (step 7), **so nothing in the screen deletes for good until then** (the trash icon was the only thing that did); the nudge has no setting.
7. **Archive view. Done 2026-11-01, built test-first; Gate G passed, awaiting the owner's look.** Search, Restore, Delete permanently with its report list. **Gate G:** the web suite (168 files, 2,725 tests), the desktop suite (480),
   `tsc --noEmit` in web, desktop and CLI, and ESLint on the changed files pass (it found one real problem, a state update inside an effect in the delete dialog, which I fixed by deriving the "checking" state); the CLI's own suite
   shows the same 8 failing files (144 tests) as untouched HEAD. The panel was **driven in the real built desktop app** on a seeded database (14 checks, with a scratch Playwright script that is not committed): the groups, the labels, a branch kept together, search,
   Restore (and the item back on the list), the confirmation with the count and the report link that opens the report in a note panel, the delete itself, the report left untouched in the database, and the row menu with Cancel. **The desktop smoke passes: 122 checks** (its to-do block gained
   the delete preview and a refused hostile id). What was built, and decided on the way (owner, 2026-11-01: seams, and which titles a report is matched on):
   - **One new bridge method, `previewTodoDelete(id)`** (contract, service, validator, client, stub): `{ items, reports }`, what Delete permanently would erase and which reports mention it. `items` counts the item and everything under it, **archived or not**, which the list view does not
     hold (a done sub-item archived on its own still goes with its parent), so the confirmation can be exact. It is in the repo as `previewDelete`.
   - **Which reports (T13), owner's choice: the item and everything under it.** A report is a note with a recorded link in `todo_reports` whose note still exists; it is listed if its text contains any title in the branch, **exactly as written** (case counts), newest first, each once even after a Regenerate.
     Deleting does not touch the reports or their links (pinned by a test). A generic sub-item title ("Call") can list a report that is not about the item; the owner sees the list and decides.
   - **The Archive view** (a third button in the view switcher; saved in the panel's state, and a state saved before it restores to the list): a search box takes the place of the add box; entries are grouped by the week archived, newest week first, each marked **Done, Removed or Dropped** with its date (the day it was done, else the day it was removed or dropped);
     a branch archived together is one entry with its sub-items under it, and an entry shown on its own says what it was under. Restore brings an entry back to the list as a to-do (what was archived with it comes too) and says so; when it came back at the top level because what it was under is still archived, it says that.
     Pure grouping and filtering is `archiveGroups` (`todos.ts`). The store loads the archive when the view opens and keeps it current after that (`loadArchive`, `deleteForGood`, `previewDelete`; Remove, Restore, the first-run answer and the weekly cycle's change event all refresh it once loaded).
   - **Delete permanently** is in two places, as T7 says: a trash button on each Archive entry, and a small "..." menu (non-modal, like the notes' menus) beside Remove on every list row and board card. Both open one confirmation: how many items go, "with their history", that it cannot be undone, that **backup files made earlier may still contain it**, and the reports that mention it as links;
     a link opens the report **beside** (in a note panel) and closes the dialog, so the owner can edit it first. The confirm button waits until the reports have been checked. There is no Undo; the bar afterwards just says it was deleted.
   - The bottom bar of the panel is now one thing (a message, with an Undo only after Remove); `ConfirmDialog` gained optional `children` and `confirmDisabled`.
   - **Not in this step, on purpose.** The Reports view and report generation (step 8); nothing creates a report yet, so in the app the reports list is empty until then (the tests and the real-app run seeded one by hand).
8. **Reports. Done 2026-11-01, built test-first; Gate H passed, awaiting the owner's look.** Generation at close, the notebook, the Reports view, Regenerate, "My notes" roll-up. **Gate H:** a generated report opens in a note panel and edits survive a Regenerate.
   **Gate H**, in the **real built desktop app** on a database that was three weeks behind (13 checks, with a scratch Playwright script that is not committed): at launch the app made the two weekly reports and the monthly one (the quiet week got none) in a
   **To-do reports** notebook with Weekly, Monthly and Quarterly groups; the Reports view listed them newest first; **Open** put a report in a note panel; text typed under My notes was saved; **Regenerate** made a second note and left the first, with that
   text, byte for byte as it was; the new one was made afresh with My notes empty; a regenerated **monthly** report carried the weekly text up; a report for the quiet week came from the picker; nothing was logged as an error. The web suite (170 files, 2,770 tests),
   the desktop suite (486), `tsc --noEmit` in web, desktop and CLI and ESLint on the changed files pass; the CLI's own suite shows the same 8 failing files (144 tests) as untouched HEAD. **The desktop smoke passes: 125 checks** (122 before, plus 3 over IPC: the week a first run started from is offered for a report, one made by hand is a note in the To-do reports notebook and is listed, and a bad kind, a bad date and an unclosed period are refused). What was built, and decided on the way (owner, 2026-11-01: seams, a picker in each section):
   - **Reports are made by the cycle, in the same transaction as the weeks they belong to** ([`todoCycle.ts`](../apps/web/src/lib/composition/todoCycle.ts), [`todoReportMaker.ts`](../apps/web/src/lib/composition/todoReportMaker.ts), [`todoReportsRepo.ts`](../apps/web/src/lib/composition/todoReportsRepo.ts)):
     after the closed weeks, a weekly report for each that had something in it (T21); then the months and quarters that ended, oldest first, so a month can carry up what is in the weeks and a quarter what is in its weeks. A week, month or quarter that had nothing in it gets none.
     `CycleResult` gained `reportNotes` (the notes made, so the caller can have them searched). A run that makes nothing does not even create the notebook.
   - **Months and quarters now close** like weeks: `todo_closed` rows of kind `month` and `quarter`. A **first run** starts all three from the latest closed week, month and quarter, with no backfill; a database whose weeks were already being closed (steps 6-7) starts the month and quarter markers the same way on its next run.
     New pure helpers `latestClosedMonth`, `latestClosedQuarter`, `isLocalDate` in `todoWeeks.ts`.
   - **A quiet month or quarter gets no report either** (my extension of T21, which says only weeks: a long break with the plugin off would otherwise leave a stack of empty monthly reports). `periodHadActivity` counts completed, added or dropped.
   - **Where they go.** The notebook **To-do reports** and its three groups are found by the ids kept in a new small table `todo_places` (so renaming them is followed, and a deletion is noticed and they are made again); a report the owner deleted is **not** remade, because reports are only made when a period closes.
     Each report is an ordinary note: frontmatter with its title, a description, and the tags `todo-report` and its kind, then the Markdown; its link is recorded in `todo_reports` (the kind stored as `weekly`, `monthly` or `quarterly`). The note's own created and updated times are the real clock's.
   - **My notes (T12).** A month's and a quarter's notes are gathered from what the weekly reports say **now**, edited or not (`weeklyReportTexts`, then the existing `gatherWeekNotes`), for the weeks whose last day is in the period; notes written after a month's report was made need a Regenerate.
   - **Regenerate.** `generateTodoReport(kind, periodStart)` makes **another note** for a closed period, as of now; the reports already made are never touched; the title carries the minute, with seconds added on a clash. Refused: a period that has not closed, a kind or a date that is not one, and a period **older than the retention window** (what it was made of may be purged; T10).
     A period the cycle has closed is any row of `todo_closed`, which includes the week, month and quarter a first run started from, so those are offered too (they were never reported on). `loadTodoReports()` lists every report whose note still exists (newest period first, every copy) and the closed periods in the window that have **none**.
   - **Two bridge methods:** `loadTodoReports` and `generateTodoReport` (contract, service, validators that take a known kind and a real date, client, stub, in-memory backend). The main process **tells the search** about the notes a cycle run made (`indexReportNotes`, best effort; the run is synchronous so it cannot wait), and **tells every window** after a Regenerate
     (`notifyTodoReports`) as well as after a cycle that changed things; each window then reads the list again **and takes the database's notes** (`reconcile`), so a new report and its notebook appear without a restart.
   - **The Reports view** (a fourth button; the switcher is now List, Board, Reports, Archive; a state saved before it restores to the list): Weeks, Months and Quarters, each newest first with every copy of a period (pure `reportSections`), each row with **Open** (a note panel beside) and **Regenerate**, and in each section a **"Make a report for..."** picker of the closed periods that have none, with Generate; a section with none says so. Saved state `view: "reports"`.
   - **Risks settled.** Risk 5 (the default notebook): **left as it is**. `defaultNotebookId` is still the lowest id, the reports notebook is made after "Notebook", and the app never deletes the last notebook, so only an owner who deletes every other notebook, then restores something whose notebook is gone, would see a stray note filed in the reports notebook. Risk 4 (the CLI): the reports are ordinary notes in a notebook of their own, which the CLI already knows how to list; **not verified in the CLI's own screens**, whose suite cannot run on this machine (Node 24, needs 26.10).
   - **Found in the owner's manual test, and fixed:** at launch the cycle runs before Meilisearch is up, so the main process's attempt to index the reports it had just made logged three connection errors. They were harmless (the app indexes every note once search is ready),
     but noisy, so `indexReportNotes` now skips while the app has search switched off (`searchIsDisabled`, three tests).
   - **Found in the owner's manual test, and fixed:** the box for adding an item had no button and no hint that it takes Enter, so adding a normal item was hard to find (only a sub-item's **+** was visible). A small **Add** button now sits beside the top box and the Backlog's box
     (off while the box is empty; the cursor goes back into the box after it adds). The boxes for a sub-item or a rename are unchanged.
   - **Found in the owner's manual test, and changed:** the list's sections are now **This week, Rolled over, Backlog**, so the list you work from is at the top (T17 listed Rolled over first). On the board, Rolled over is still the strip above the columns.
   - **Found in the owner's manual test, and added:** drag a top-level Backlog item or a Rolled over entry onto **This week** in the list view (seven panel tests). A Backlog drop is `setStatus(id, "todo")`; a Rolled over drop is `acceptRolled(id)`, the same call as its button, so the rolled branch comes with it.
     The id travels under its own drag type, not `text/plain` (which the board uses), so a note's editor never takes it as text; This week takes a drop only while one of these is held. Mouse only: a Rolled over entry has its button, a Backlog item has no keyboard way to This week yet (the board's arrows reach it). The board is unchanged.
   - **Found in the owner's manual test, and added (second part):** and back again: drag a top-level to-do in **This week** onto the **Backlog** (`setStatus(id, "backlog")`; seven more panel tests, the section drop zones generalized to take what each accepts). A **done** to-do is not draggable, because moving it would un-finish it and take it out of what the week credits; a Rolled over entry cannot go to the Backlog by drag (its **Move to backlog** button does that), so the Backlog's outline shows only for a to-do from This week.
   - **Not in this step, on purpose.** The documentation and the manual test (step 9); a template editor (T11 says none in v1); export; the AI narrative (v2).
9. **Docs and the manual test. Done 2026-11-01; Gate I is the owner's, by hand.** Written: [architecture/todo-weekly-cycle.md](architecture/todo-weekly-cycle.md) (how it works, the rules a maintainer must not break, the known limits),
   the to-do section of [ui/panels.md](ui/panels.md#the-to-do-panel) rewritten for what the panel does now, two rows and a settings row in [feature-matrix.md](feature-matrix.md) (it had none for to-dos) and the backup row,
   a line in [index.md](index.md), a paragraph in [architecture/backup-restore.md](architecture/backup-restore.md), and [manual-tests/todo-archival.md](manual-tests/todo-archival.md): eight tests (close a week, miss three, turn the plugin off and on,
   the first-run question, Rolled over with Remove and Undo, reports, delete a sensitive item, lower the window) and things worth trying on top. Owner, 2026-11-01: build a fixture tool for it, and add the how-it-works page to the four.
   - **The fixture tool**, `pnpm manual:todo` ([`todo-manual.mjs`](../apps/desktop/scripts/todo-manual.mjs), [`todoManualFixture.ts`](../apps/desktop/src/tools/todoManualFixture.ts), 17 tests, each scenario run through the real cycle). The cycle runs on the real clock, so the tool builds a **scratch home whose dates are relative to today**:
     `setup --scenario behind|first-run|archive|retention` (`--weeks N` for *behind*, `--keep MONTHS|forever` so the first launch purges at once, since it purges only once a day), `age --weeks N` (moves the closed weeks back, to fake time passing while the plugin was off), `report` (what the database holds, in
     the app's words, to compare with the screen) and `launch` (the command that starts the app on it). `setup` refuses a database that already has to-dos. It is tested at: each scenario leaves the state it says, the cycle on it makes what the manual test expects, `age` closes exactly N weeks, and `report` says what is there.
   - **Walked in the real built desktop app** with scratch Playwright scripts (not committed): three weeks behind (the screen, the Reports view and `report` agreeing), plugin off then `age`, nothing closed while off, on and relaunch, catch-up to six weeks; one week behind, matching test 1's table line for line;
     the retention numbers the manual test quotes (1 year warns about 3 items, 2 years about 2, the six-year-old item purged at the first launch, `--keep 24` leaving the two newest). Gate I itself, the by-hand run, is not done.
   - **Found while writing it, and written down rather than changed:** turning the plugin on does not run the cycle at that moment (it catches up at the next launch or within the hour; the manual test says so); and `age` re-closes the same weeks, so each gets a second weekly report like a Regenerate copy.

## Non-goals and future work

- **AI narrative: v2, the fast-follow, to start right after this ships (owner, 2026-10-30).** A written summary of a period, from the
  AI helper ([ui/ai-helper.md](ui/ai-helper.md), which talks to the owner's own Ollama server). Not designed. To settle then: whether it
  runs at close or on a button; where it goes, which under T10 must be a **new** note and never a rewrite; and what happens with no Ollama.
- **Export** (copy, `.md` file, PDF). Later (owner).
- Work/Home contexts; the owner uses one install per place (T19).
- Planning into future weeks. Use the Backlog.
- A mid-week preview of a report (owner declined).
- Syncing or merging the work and home histories.
- The web and terminal apps. To-dos are desktop-only, and so is this.

## Settled questions

| Question | Settled as | Where |
|---|---|---|
| Daily snapshots, or something else? | **An activity log plus `done_at`.** The need is "track work over time" | T3 |
| Which week? | **Seven days from a start day, default Sunday** | T1 |
| Can the Backlog be on every week and "never roll over"? | **Yes.** It is outside the weekly cycle | T2 |
| Delete: permanent, or kept 5 years? | **Both**: Remove keeps it; Delete permanently erases it | T7 |
| Do the 5-year clock and the 60-day Trash Can overlap? | **No**, different purposes. Only deleting a report note uses the Trash Can | T7, T9 |
| Are reports computed or stored? | **Stored, editable, never overwritten** | T9, T10 |
| Do reports expire with the items? | **No**, until the owner deletes them | T10 |
| Monthly and quarterly from weekly text or from data? | **Data, plus each week's My notes** | T12 |
| Work and home in one list? | **One pool**; one install per place | T19 |
| Backup in scope? | **Yes**, and to-dos were already in the database snapshot; only the counts line and a test are new | T16, Gate A |
| How is a week closed across daylight saving and time zones? | **By local dates, with each event storing its local date** | T1, Gate A |
