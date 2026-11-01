"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReportSection } from "@/lib/composition/todoReportList";
import type { TodoMissingReport, TodoReportEntry } from "@/lib/composition/todosApi";

const NOUNS = { weekly: "weekly", monthly: "monthly", quarterly: "quarterly" } as const;

/** The closed periods that have no report, and the control to make one for the one picked. */
function Picker({ kind, missing, onGenerate }: { kind: ReportSection["kind"]; missing: TodoMissingReport[]; onGenerate: (period: TodoMissingReport) => void }) {
  const [picked, setPicked] = useState("");
  if (missing.length === 0) return null;
  // The one picked, or the newest when it was just made (and so is no longer here).
  const chosen = missing.find((period) => period.periodStart === picked) ?? missing[0];
  const noun = NOUNS[kind];
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
      <select
        aria-label={`Make a ${noun} report for`}
        value={chosen.periodStart}
        onChange={(event) => setPicked(event.target.value)}
        className="max-w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground"
      >
        {missing.map((period) => (
          <option key={period.periodStart} value={period.periodStart}>
            {period.label}
          </option>
        ))}
      </select>
      <Button size="xs" variant="secondary" aria-label={`Generate a ${noun} report`} onClick={() => onGenerate(chosen)}>
        Generate
      </Button>
    </div>
  );
}

/**
 * The reports: Weeks, Months and Quarters, newest first, every copy of a period listed. A report is a note, so Open shows it
 * in a note panel, where it can be read and edited; Regenerate makes another note for the same period and leaves this one as
 * it is. A period that has none (a quiet week, or one that was deleted) can be made from the picker at the top of its section.
 */
export function TodoReports({
  sections,
  onOpen,
  onRegenerate,
  onGenerate,
}: {
  sections: ReportSection[];
  onOpen: (report: TodoReportEntry) => void;
  onRegenerate: (report: TodoReportEntry) => void;
  onGenerate: (kind: ReportSection["kind"], period: TodoMissingReport) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <section key={section.kind} aria-label={`${section.title === "Weeks" ? "Weekly" : section.title === "Months" ? "Monthly" : "Quarterly"} reports`} className="flex flex-col gap-1.5">
          <h3 className="px-1 text-xs font-medium text-muted-foreground">{section.title}</h3>
          <Picker kind={section.kind} missing={section.missing} onGenerate={(period) => onGenerate(section.kind, period)} />
          {section.reports.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">No {NOUNS[section.kind]} reports yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {section.reports.map((report) => (
                <li
                  key={report.noteId}
                  aria-label={report.title}
                  className="flex items-start gap-2 rounded-md border bg-card p-2 text-sm text-card-foreground shadow-xs"
                >
                  <span className="min-w-0 flex-1 break-words">{report.title}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="secondary" aria-label={`Open ${report.title}`} onClick={() => onOpen(report)}>
                      Open
                    </Button>
                    <Button size="xs" variant="ghost" aria-label={`Regenerate ${report.title}`} onClick={() => onRegenerate(report)}>
                      Regenerate
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
