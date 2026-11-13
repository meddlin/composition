# Manual test: the to-do weekly cycle

A guided test of the desktop app's to-do list tidying itself each week: closing a week, catching up after missing
several, turning the plugin off and on, the first-run question, Rolled over, reports, deleting a sensitive item and
lowering how long the archive is kept. It runs on a **scratch home**, never your real notes or settings.

How the cycle works: [architecture/todo-weekly-cycle.md](../architecture/todo-weekly-cycle.md). What the panel does:
[ui/panels.md](../ui/panels.md#the-to-do-panel). The design and its decisions: [todo-archival-plan.md](../todo-archival-plan.md).

## Why there is a tool

The cycle runs on the real clock (a week closes after local midnight at its end), so by hand you would wait weeks. The tool builds
a scratch home whose dates are relative to **today**, so the app starts out looking as if it had last run that long ago. It also
prints what the database holds, so you can compare the screen with it. It works only in a scratch home: `setup` refuses a database
that already has to-dos.

## Run it

From the repo root, with the dependencies installed for `apps/web` and `apps/desktop` (the desktop app builds and starts with
`pnpm --dir apps/desktop dev`):

```bash
pnpm manual:todo                                   # the commands, and where the scratch home is
pnpm manual:todo setup --scenario behind           # build a scratch home
pnpm manual:todo launch                            # prints the command that starts the app on it
pnpm manual:todo report                            # what the database holds
```

Every command takes `--home DIR`; the default is a folder in your system's temp directory (`pnpm manual:todo` prints it). To start
over, delete the folder or use another `--home`. Start the app with the command `launch` prints, in a second terminal
(`COMPOSITION_DEV_HOME=<home> pnpm --dir apps/desktop dev`); **quit it before running `setup`, `age` or `report`**
if you want to be sure of what they see.

| Command | What it does |
|---|---|
| `setup --scenario S` | Builds the scenario in an empty home (below). `--weeks N` for *behind* (default 3). `--keep MONTHS` (or `--keep forever`) also sets how long archived items are kept |
| `age --weeks N` | Pretends N more weeks went by: moves the closed weeks back, so the next launch closes that many again |
| `report` | Prints the settings, how far the cycle has closed, Rolled over, This week, Backlog, the Archive and the Reports, in the app's words |
| `launch` | Prints the command that starts the app on the home |

| Scenario | What it is | Used in |
|---|---|---|
| `behind` | N weeks have ended since the app last ran, with work in each: open items, a branch in progress, a done parent with an open sub-item, a backlog item, things done, and work done in the last quarter | 1, 2, 3, 5, 6 |
| `first-run` | A database from before the weekly cycle: three completed items with no history, two open | 4 |
| `archive` | Archived items of every kind, up to date, and a weekly report that names one of them | 7 |
| `retention` | Items removed 6 and 18 months and 3, 4.5 and 6 years ago | 8 |

## The tests

Each test starts from a fresh home unless it says it continues. In the app, choose **To-do** in the empty panel the first time;
the panel is saved with the layout, so it comes back after that, on the view you left it.

### 1. Close a week

`pnpm manual:todo setup --scenario behind --weeks 1`, then start the app.

| Look at | Expect |
|---|---|
| **List** view, at the top: This week | Only *Move house*, ticked: a done parent with an open sub-item stays until everything in it is done |
| **List** view, below **This week** | A **Rolled over** section with three entries: *Write the Q4 plan*, *Plan trip* (with *Book flights* beneath it) and *Pack boxes*, which says *in Move house*. Each says **From the week of** the Sunday that week began on, with no "waiting" (it has rolled once) and no nudge. **Add to this week**, **Move to backlog** and **Drop** under each |
| Backlog | *Someday: learn Spanish*, untouched, with its own add box |
| **Archive** view | *Reply to vendor* and *Ship the migration*, each marked **Done**, under the week they were done in, and *Quarter-end audit* (done last quarter, swept now) |
| **Reports** view | One weekly report for the week that closed, one **Monthly** for last month and one **Quarterly** for last quarter, each with **Open** and **Regenerate** |
| `pnpm manual:todo report` | The same items in the same places; `Closed through: week …` is the last Saturday |

### 2. Miss three weeks

A fresh home: `pnpm manual:todo setup --scenario behind` (three weeks), then start the app.

- Rolled over's entries say **waiting 3 weeks**, **Rolled over 3 times. Maybe move it to the backlog, or drop it?**, and still **From the week of** the **first** of the three weeks: an item keeps where it first rolled from.
- The Reports view has **three weekly reports** (every week had something in it, if only an item rolling over), the monthly and the quarterly one.
- `report` shows `rolled 3 times` on each rolled item.

### 3. Turn the plugin off and on

Continue from test 2 (or repeat it).

1. **Settings > Plugins:** switch **To-do** off. Quit the app.
2. `pnpm manual:todo age --weeks 3`. Start the app: **nothing is closed** while the plugin is off. `report` still says `Closed through` three weeks back; the to-do panel says the plugin is off.
3. **Settings > Plugins:** switch **To-do** on. Quit and start the app again: it **catches up three weeks at once**. Rolled over now says **waiting 6 weeks**.

Two things to know. The cycle runs when the app starts and then every hour, so turning the plugin on does not catch up at that moment; it does at the next launch or within the hour. And `age` makes the app close the *same* weeks again, so each of those weeks gets a second weekly report, which looks like a Regenerate copy.

### 4. The first-run question

Use two homes, one for each answer.

1. `pnpm manual:todo setup --scenario first-run --home /tmp/todo-yes`, start the app (`pnpm manual:todo launch --home /tmp/todo-yes` prints how) and open a to-do panel. It has a banner: **Archive 3 items you've already completed?** It says they are filed under the weeks they were last changed, and that if you leave them they are archived at the end of the week instead, without a date. Choose **Yes, archive them**: they go to the Archive, marked Done, each under the week it was last changed, and the banner does not come back. No report is made for those weeks.
2. `pnpm manual:todo setup --scenario first-run --home /tmp/todo-no`, start the app on it and open a to-do panel, choose **No, leave them**: they stay on the list. Quit, `pnpm manual:todo age --weeks 1 --home /tmp/todo-no`, start again: they are archived at that close **with no date** (the Archive row has no date and no report counts them).

### 5. Rolled over, Remove and Undo

From test 2 (the *behind* scenario), in the **List** view:

- **Add to this week** on *Plan trip*: it and *Book flights* both leave Rolled over and appear under This week, still saying nothing about rolling (the count is kept, for the record).
- **Move to backlog** on *Write the Q4 plan*: it goes to the Backlog.
- **Drop** on *Pack boxes*: it goes to the Archive, marked **Dropped**.
- With Rolled over empty, the section is gone. The same three actions are on the **strip above the board's columns** in the **Board** view; the board's columns do not show rolled-over items.
- The bin is **Remove**: on *Plan trip* (now under This week) it first asks **Remove this to-do?**, saying *Plan trip* and its 1 sub-item go to the archive. **Cancel** (or Escape, or Enter straight away) leaves it be. **Remove** takes it off, with a bar, **Removed “Plan trip” and 1 sub-item. Undo**, for a few seconds. **Undo** brings both back, as to-dos (an item restored from the archive is a to-do again, whatever it was). A removed item goes to the Archive, marked **Removed**.
- **Drag** works too, in the List view: drag *Someday: learn Spanish* (Backlog) onto **This week**, and a Rolled over entry onto it. While you hold one, This week
  shows a dashed outline, firmer when you are over it. A dropped Backlog item becomes a to-do; a dropped entry does what **Add to this week** does (its
  sub-items come with it). Let go over Rolled over or Backlog instead: nothing changes. Dragging a sub-item (*Book flights*) picks up the whole entry.
- **And back:** drag a to-do from **This week** (say *Plan trip*, with *Book flights* under it) onto the **Backlog**: the Backlog lights up instead of This week, and the item lands there with
  what is under it. *Move house*, which is ticked, will not drag: untick it and it will. A Rolled over entry cannot be dropped on the Backlog (use its **Move to backlog**).
- Add an item in the **Backlog's own box** (Enter, or its **Add** button): it lands in the Backlog; the top box, with its own **Add** button, adds to This week.

### 6. Reports

From test 2, **Reports** view:

1. **Open** a weekly report: it opens in a note panel beside the to-do panel; it is an ordinary note in the **To-do reports** notebook (Weekly, Monthly and Quarterly groups). Under **My notes** at the bottom, type a sentence.
2. **Regenerate** that report: a second report for the same week appears, with a newer time in its title, and **the first still has your sentence**; the new one has an empty My notes.
3. **Regenerate** the **Monthly** report: the new one carries your sentence up under *My notes*.
4. The **Make a report for…** picker in a section lists closed periods that have none; pick one and **Generate**.
5. Rename or move the notebook: new reports still go in it. Delete a report: it is not made again.

### 7. Delete a sensitive item

`pnpm manual:todo setup --scenario archive`, start the app, **Archive** view.

1. *Prepare the salary talk* is there, **Done**. It is also named in a weekly report. Click its bin (**Delete permanently**).
2. The confirmation says how much goes, that it **cannot be undone** and that **backup files you made earlier may still contain it**, and under **These reports mention it** it lists the weekly report as a link.
3. Click the link: the report opens in a note panel and the dialog closes. Edit the item's name out of the report if you like, then click the bin again and confirm. (Cancel, or Escape, leaves everything alone.)
4. It is gone from the Archive. `report` no longer lists it. The report note is still there: deleting an item **never changes a report**.
5. From the List view, the **⋯** menu beside Remove on a row has the same **Delete permanently…** (and on a board card).

### 8. Lower how long the archive is kept

`pnpm manual:todo setup --scenario retention`, start the app (the default is **5 years**, so the six-year-old item is already purged at this first launch: `report` shows 4 archived items).

1. **Settings > General > To-dos > Keep archived items for:** choose **1 year**. A box says **3 archived items are older than 1 year and will be deleted for good the next time the to-do clean-up runs**, with **Keep for 1 year** and **Cancel**. Cancel: nothing is saved.
2. Choose **2 years**: **2 archived items…**. A longer window or **Keep forever** asks nothing.
3. **Other (months)** takes a whole number from 1 to 600; **0** is refused with a reason.
4. The purge runs **at most once a day**, at launch and then hourly, so confirming **Keep for 2 years** does not delete anything until the next day. To see it work today, on a fresh home: `pnpm manual:todo setup --scenario retention --keep 24`, then start the app: the three items older than two years are gone at that first launch (`report` shows the two newest).

## Things worth trying on top

- **Week start:** Settings > To-dos > Week starts on **Monday**, in the middle of a week. The first week after the change is short (no day is missed or counted twice).
- **Fiscal year:** set **Fiscal year starts in** October and look at the Quarterly titles (a year that starts in October 2026 is named **2027**, so October to December 2026 is `2027 Q1`).
- **A backup round trip:** make a backup in Settings, quit, delete the scratch home's database, restore. The items, the archive, the history and the reports come back, and the backup line says `… and N to-dos (M archived)`. See [backup-restore.md](backup-restore.md).
- **A clock change:** the cycle uses local dates, so a daylight saving change does not move an item into another week; the automated tests pin this in four time zones.

## The automated checks behind this

| Where | What |
|---|---|
| `apps/web` `todoWeeks.test.ts`, `todoSweep.test.ts`, `todoEvents.test.ts`, `todoReports.test.ts` | The week, month and fiscal-quarter maths across daylight saving, what a sweep archives and rolls (as each item stood at the end of the week), and every report's text |
| `apps/web` `todosRepo.test.ts`, `todoCycle.test.ts`, `todoReportMaker.test.ts`, `todosService.test.ts` | The log, archive, restore, delete, purge and closing, on a real database with an injected clock; the first run; the reports the cycle makes; Regenerate leaving the first report as it was |
| `apps/web` `todosStore.test.ts`, `TodoPanel.test.tsx`, `TodoSettings.desktop.test.tsx`, `backup.test.ts` | The store and every panel view, the To-dos settings, and a backup round trip that keeps items, archive, log and report links |
| `apps/desktop` `todoCycleRunner.test.ts`, `validate.test.ts`, `ipc.test.ts`, `src/tools/todoManualFixture.test.ts`; `pnpm smoke` | The scheduler, the bridge's argument checks, this test's own fixture (each scenario run through the real cycle), and the real app over IPC |
