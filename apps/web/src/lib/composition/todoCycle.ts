import { getDb } from "./db";
import { makeReport } from "./todoReportMaker";
import { periodHadActivity, weekHadActivity } from "./todoReports";
import { planSweep } from "./todoSweep";
import type { TodoSetup } from "./todosApi";
import { latestClosedMonth, latestClosedQuarter, latestClosedWeek, localDateOf, monthsToClose, quartersToClose, weeksToClose, type Period } from "./todoWeeks";
import * as todosRepo from "./todosRepo";
import { loadWebSettings } from "./webSettings";

/**
 * The weekly cycle: what the desktop app does at launch and every hour. It closes the weeks that have ended (oldest first,
 * so an item keeps the week it first rolled from), makes the reports for the weeks, months and quarters that have ended and
 * had something in them, and purges what the retention window has run out on, once a day.
 * Framework-free, with the clock passed in, like the rest of the service layer. See docs/todo-archival-plan.md (T4, T8, T15, T20).
 */

/** What one run did, so the caller can tell the windows when the list changed. */
export type CycleResult = {
  /** A first run is waiting for the owner to answer the question about completed items; nothing else is done until then. */
  awaitingSetup: boolean;
  closedWeeks: number;
  purged: number;
  /** The notes of the reports made, oldest period first, so the caller can have them searched. */
  reportNotes: number[];
};

const NOTHING: CycleResult = { awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] };

/** Starts the cycle from what has just closed, touching nothing: no report is made for what came before (T15). */
function startFrom(today: string, weekStartsOn: Parameters<typeof latestClosedWeek>[1], fiscalStartMonth: number, now: Date): void {
  todosRepo.markWeekClosed(latestClosedWeek(today, weekStartsOn), now);
  todosRepo.markPeriodClosed("month", latestClosedMonth(today), now);
  todosRepo.markPeriodClosed("quarter", latestClosedQuarter(today, fiscalStartMonth), now);
}

export function loadSetup(now: Date = new Date()): TodoSetup {
  if (todosRepo.lastClosedWeekEnd() !== null) return { pending: false, completed: 0 };
  const completed = todosRepo.finishedTodoIds(now).length;
  return { pending: completed > 0, completed };
}

/**
 * Answers the first-run question and starts the cycle from the week that has just closed. With `archiveCompleted` the
 * completed items are archived now, backdated; without, they are left, and go (with no date) at the first week close.
 * Does nothing once the cycle has started, as when two windows both answer. Returns how many items were archived.
 */
export function finishSetup(archiveCompleted: boolean, now: Date = new Date()): number {
  if (todosRepo.lastClosedWeekEnd() !== null) return 0;
  const { weekStartsOn, fiscalYearStartMonth } = loadWebSettings().todos;
  return getDb().transaction(() => {
    const archived = archiveCompleted ? todosRepo.archiveFinishedTodos(weekStartsOn, now) : 0;
    startFrom(localDateOf(now), weekStartsOn, fiscalYearStartMonth, now);
    return archived;
  })();
}

/**
 * One run of the cycle. While the To-do plugin is off it does nothing at all (T20); turned back on, the next run catches
 * up week by week. On a first run with completed items it waits for `finishSetup`.
 */
export function runCycle(now: Date = new Date()): CycleResult {
  const settings = loadWebSettings();
  if (!settings.plugins.todo) return NOTHING;
  const { weekStartsOn, retentionMonths, fiscalYearStartMonth } = settings.todos;
  const today = localDateOf(now);
  let closedWeeks = 0;
  const reportNotes: number[] = [];

  const lastEnd = todosRepo.lastClosedWeekEnd();
  if (lastEnd === null) {
    if (todosRepo.finishedTodoIds(now).length > 0) return { ...NOTHING, awaitingSetup: true };
    startFrom(today, weekStartsOn, fiscalYearStartMonth, now);
  } else {
    // All of it, the weeks and their reports, or none, so a run that is interrupted does not leave a catch-up half done.
    getDb().transaction(() => {
      const weeks = weeksToClose(lastEnd, today, weekStartsOn);
      const closed: Period[] = [];
      if (weeks.length > 0) {
        const plans = planSweep(todosRepo.listSweepItems(), todosRepo.listTodoEvents(), weeks);
        for (const plan of plans) if (todosRepo.closeWeek(plan, now)) closed.push(plan.week);
        closedWeeks = closed.length;
      }

      // The weekly reports go first, so a month's report can carry up what was written in them, and the month's the quarter's.
      const items = todosRepo.listReportItems();
      const events = todosRepo.listTodoEvents();
      for (const week of closed) {
        if (weekHadActivity({ week, items, events })) reportNotes.push(makeReport({ kind: "weekly", period: week }, now));
      }
      closeMonthsAndQuarters(today, fiscalYearStartMonth, now, reportNotes);
    })();
  }

  const purged = retentionMonths !== null && todosRepo.claimDailyPurge(today, now) ? todosRepo.purgeExpired(retentionMonths, now) : 0;
  return { awaitingSetup: false, closedWeeks, purged, reportNotes };
}

/**
 * Closes the months and then the quarters that have ended, making a report for each that had something in it. A database
 * whose weeks were being closed before months and quarters were starts from the latest closed ones, with no backfill.
 */
function closeMonthsAndQuarters(today: string, fiscalStartMonth: number, now: Date, reportNotes: number[]): void {
  const lastMonthEnd = todosRepo.lastClosedPeriodEnd("month");
  if (lastMonthEnd === null) {
    todosRepo.markPeriodClosed("month", latestClosedMonth(today), now);
  } else {
    for (const month of monthsToClose(lastMonthEnd, today)) {
      const items = todosRepo.listReportItems();
      if (periodHadActivity(month, items, todosRepo.listTodoEvents())) reportNotes.push(makeReport({ kind: "monthly", period: month }, now));
      todosRepo.markPeriodClosed("month", month, now);
    }
  }

  const lastQuarterEnd = todosRepo.lastClosedPeriodEnd("quarter");
  if (lastQuarterEnd === null) {
    todosRepo.markPeriodClosed("quarter", latestClosedQuarter(today, fiscalStartMonth), now);
  } else {
    for (const quarter of quartersToClose(lastQuarterEnd, today, fiscalStartMonth)) {
      const items = todosRepo.listReportItems();
      if (periodHadActivity(quarter, items, todosRepo.listTodoEvents())) reportNotes.push(makeReport({ kind: "quarterly", period: quarter }, now));
      todosRepo.markPeriodClosed("quarter", quarter, now);
    }
  }
}
