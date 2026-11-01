import type { ReportKind } from "./todoReports";
import type { TodoMissingReport, TodoReportEntry, TodoReports } from "./todosApi";

/** One part of the Reports view: the reports of a kind, and the closed periods of that kind that have none. */
export type ReportSection = { kind: ReportKind; title: string; reports: TodoReportEntry[]; missing: TodoMissingReport[] };

const SECTIONS: readonly { kind: ReportKind; title: string }[] = [
  { kind: "weekly", title: "Weeks" },
  { kind: "monthly", title: "Months" },
  { kind: "quarterly", title: "Quarters" },
];

/**
 * The reports as the Reports view shows them: Weeks, Months and Quarters, always (an empty one says so), each newest period
 * first, with every copy of a period listed, the newest copy first (and, made at the same moment, the later one).
 */
export function reportSections({ reports, missing }: TodoReports): ReportSection[] {
  return SECTIONS.map(({ kind, title }) => ({
    kind,
    title,
    reports: reports
      .filter((report) => report.kind === kind)
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || b.generatedAt.localeCompare(a.generatedAt) || b.noteId - a.noteId),
    missing: missing.filter((period) => period.kind === kind).sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
  }));
}
