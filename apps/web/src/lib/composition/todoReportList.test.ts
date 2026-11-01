import { describe, expect, it } from "vitest";
import { reportSections } from "./todoReportList";
import type { TodoMissingReport, TodoReportEntry, TodoReports } from "./todosApi";

const entry = (noteId: number, kind: TodoReportEntry["kind"], periodStart: string, generatedAt: string): TodoReportEntry => ({
  noteId,
  title: `${kind} ${periodStart} #${noteId}`,
  kind,
  periodStart,
  periodEnd: periodStart,
  label: periodStart,
  generatedAt,
});
const missing = (kind: TodoMissingReport["kind"], periodStart: string): TodoMissingReport => ({ kind, periodStart, periodEnd: periodStart, label: periodStart });

describe("reportSections", () => {
  it("always has Weeks, Months and Quarters, in that order, even when there is nothing yet", () => {
    const sections = reportSections({ reports: [], missing: [] });

    expect(sections.map((s) => [s.kind, s.title, s.reports, s.missing])).toEqual([
      ["weekly", "Weeks", [], []],
      ["monthly", "Months", [], []],
      ["quarterly", "Quarters", [], []],
    ]);
  });

  it("puts each report in the section of its kind, newest period first, and every copy of a period newest first", () => {
    const data: TodoReports = {
      reports: [
        entry(1, "weekly", "2026-10-11", "2026-10-19T09:00:00.000Z"),
        entry(2, "monthly", "2026-09-01", "2026-10-02T09:00:00.000Z"),
        entry(3, "weekly", "2026-10-18", "2026-10-26T09:00:00.000Z"),
        entry(4, "weekly", "2026-10-11", "2026-10-20T09:00:00.000Z"),
        entry(5, "quarterly", "2026-07-01", "2026-10-02T09:00:00.000Z"),
      ],
      missing: [],
    };

    const [weeks, months, quarters] = reportSections(data);

    expect(weeks.reports.map((r) => r.noteId)).toEqual([3, 4, 1]);
    expect(months.reports.map((r) => r.noteId)).toEqual([2]);
    expect(quarters.reports.map((r) => r.noteId)).toEqual([5]);
  });

  it("puts the periods that have no report in the section of their kind, newest first", () => {
    const data: TodoReports = {
      reports: [],
      missing: [missing("weekly", "2026-10-04"), missing("monthly", "2026-08-01"), missing("weekly", "2026-10-18"), missing("monthly", "2026-09-01")],
    };

    const [weeks, months, quarters] = reportSections(data);

    expect(weeks.missing.map((m) => m.periodStart)).toEqual(["2026-10-18", "2026-10-04"]);
    expect(months.missing.map((m) => m.periodStart)).toEqual(["2026-09-01", "2026-08-01"]);
    expect(quarters.missing).toEqual([]);
  });

  it("breaks a tie between copies made at the same moment by the order they were made", () => {
    const same = "2026-10-20T09:00:00.000Z";
    const [weeks] = reportSections({ reports: [entry(8, "weekly", "2026-10-11", same), entry(9, "weekly", "2026-10-11", same)], missing: [] });

    expect(weeks.reports.map((r) => r.noteId)).toEqual([9, 8]);
  });
});
