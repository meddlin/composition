import {
  gatherWeekNotes,
  periodLabel,
  renderMonthlyReport,
  renderQuarterlyReport,
  renderWeeklyReport,
  reportTitle,
  type ReportPeriod,
} from "./todoReports";
import { listReportRows, reportTitles, weeklyReportTexts, writeReportNote, type ReportRow } from "./todoReportsRepo";
import { addDays, fiscalQuarterOf, localDateOf, weekOf, type DayOfWeek, type Period } from "./todoWeeks";
import type { TodoMissingReport, TodoReportEntry, TodoReports } from "./todosApi";
import * as todosRepo from "./todosRepo";
import { loadWebSettings } from "./webSettings";

/**
 * Makes the note of a report: renders it from the items and the log, and files it in the To-do reports notebook. Reports
 * are never rewritten: asking for one again makes another note (docs/todo-archival-plan.md, T10). A month's or
 * quarter's "My notes" are gathered from what the weekly reports say now, edited or not (T12).
 */

const KIND_NAMES = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" } as const;

/** The weeks that touch a period, oldest first, whether or not they have closed: the one across its edge counts. */
function weeksTouching(period: Period, startDay: DayOfWeek): Period[] {
  const weeks: Period[] = [];
  for (let week = weekOf(period.start, startDay); week.start <= period.end; week = weekOf(addDays(week.end, 1), startDay)) {
    weeks.push(week);
  }
  return weeks;
}

/** What the owner wrote in the weekly reports of the weeks that end within the period. */
function weekNotesWithin(period: Period) {
  return gatherWeekNotes(weeklyReportTexts().filter(({ week }) => week.end >= period.start && week.end <= period.end));
}

/** Writes the report as a note, as of `now`, and returns the note's id. */
export function makeReport(report: ReportPeriod, now: Date): number {
  const items = todosRepo.listReportItems();
  const events = todosRepo.listTodoEvents();
  let markdown: string;
  switch (report.kind) {
    case "weekly":
      markdown = renderWeeklyReport({ week: report.period, items, events });
      break;
    case "monthly":
      markdown = renderMonthlyReport({
        month: report.period,
        weeks: weeksTouching(report.period, loadWebSettings().todos.weekStartsOn),
        items,
        events,
        notes: weekNotesWithin(report.period),
      });
      break;
    case "quarterly":
      markdown = renderQuarterlyReport({ quarter: report.period, items, events, notes: weekNotesWithin(report.period) });
      break;
  }
  return writeReportNote({
    kind: report.kind,
    period: report.period,
    title: reportTitle(report, now, reportTitles()),
    description: `${KIND_NAMES[report.kind]} report for ${periodLabel(report)}`,
    markdown,
    generatedAt: now,
  });
}

/** Whether a report note already exists for the period (a deleted one does not count). */
export function hasReport(kind: ReportPeriod["kind"], start: string): boolean {
  return listReportRows().some((row) => row.kind === kind && row.period.start === start);
}

/** The closed periods, as reports see them: a fiscal quarter that no longer matches the Settings (the year was moved) is left out. */
function closedReportPeriods(): ReportPeriod[] {
  const { fiscalYearStartMonth } = loadWebSettings().todos;
  const quarters = todosRepo.closedPeriods("quarter").flatMap((period): ReportPeriod[] => {
    const quarter = fiscalQuarterOf(period.start, fiscalYearStartMonth);
    return quarter.start === period.start && quarter.end === period.end ? [{ kind: "quarterly", period: quarter }] : [];
  });
  return [
    ...todosRepo.closedPeriods("week").map((period): ReportPeriod => ({ kind: "weekly", period })),
    ...todosRepo.closedPeriods("month").map((period): ReportPeriod => ({ kind: "monthly", period })),
    ...quarters,
  ];
}

/** Whether a period is still inside what the archive is kept for, so the items a report is made from have not been purged. */
function withinRetention(period: Period, now: Date): boolean {
  const { retentionMonths } = loadWebSettings().todos;
  if (retentionMonths === null) return true;
  return period.end >= localDateOf(new Date(now.getFullYear(), now.getMonth() - retentionMonths, now.getDate()));
}

const entryOf = (row: ReportRow): TodoReportEntry => ({
  noteId: row.noteId,
  title: row.title,
  kind: row.kind,
  periodStart: row.period.start,
  periodEnd: row.period.end,
  label: periodLabel({ kind: row.kind, period: row.period } as ReportPeriod),
  generatedAt: row.generatedAt,
});

/** The reports that exist, and the closed periods in the retention window that have none (offered for making by hand). */
export function loadReports(now: Date = new Date()): TodoReports {
  const rows = listReportRows();
  const missing = closedReportPeriods()
    .filter((report) => withinRetention(report.period, now))
    .filter((report) => !rows.some((row) => row.kind === report.kind && row.period.start === report.period.start))
    .map((report): TodoMissingReport => ({ kind: report.kind, periodStart: report.period.start, periodEnd: report.period.end, label: periodLabel(report) }));
  return { reports: rows.map(entryOf), missing };
}

/**
 * Makes another report for a closed period, as of `now`: from the items and the log as they are, with what the weekly
 * reports say now under "My notes". The reports already made for it are not touched. A period that has not closed, or
 * whose items may have been purged (it is older than the archive is kept), is refused.
 */
export function generateReport(kind: ReportPeriod["kind"], periodStart: string, now: Date = new Date()): TodoReportEntry {
  const report = closedReportPeriods().find((r) => r.kind === kind && r.period.start === periodStart);
  if (!report) throw new Error("That period has not closed, so there is nothing to report on yet.");
  if (!withinRetention(report.period, now)) throw new Error("That period is older than archived items are kept for, so what it was made of may be gone.");
  const noteId = makeReport(report, now);
  return entryOf(listReportRows().find((row) => row.noteId === noteId)!);
}
