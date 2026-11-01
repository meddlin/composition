import type { TodoEvent } from "./todoEvents";
import { addDays, dayOfWeek, monthOf, type FiscalQuarter, type LocalDate, type Period } from "./todoWeeks";

/**
 * The to-do reports: Markdown written for a week, a month or a quarter, and the small rules around it (titles, the
 * "My notes" section that rolls up). Pure: items and the log in, text out. The notes that hold the text are made by
 * the sweep. See docs/todo-archival-plan.md (T9 to T13).
 */

export type ReportKind = "weekly" | "monthly" | "quarterly";

/** What a report is for: its kind and the days it covers. */
export type ReportPeriod =
  | { kind: "weekly"; period: Period }
  | { kind: "monthly"; period: Period }
  | { kind: "quarterly"; period: FiscalQuarter };

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock stamp of a moment, "2026-11-01 14:03", or with seconds when `seconds` is set. */
function stamp(at: Date, seconds: boolean): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}${seconds ? `:${pad(at.getSeconds())}` : ""}`;
}

/** The period a report covers as its title and the reports list say it: "2026-10-25 → 2026-10-31", "2026-10", "2027 Q1". */
export function periodLabel(report: ReportPeriod): string {
  switch (report.kind) {
    case "weekly":
      return `${report.period.start} → ${report.period.end}`;
    case "monthly":
      return report.period.start.slice(0, 7);
    case "quarterly":
      return `${report.period.fiscalYear} Q${report.period.quarter}`;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun Oct 25", with the year added ("Sun Dec 27, 2026") when `withYear` is set. */
function dayLabel(date: LocalDate, withYear: boolean): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${WEEKDAYS[dayOfWeek(date)]} ${MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ""}`;
}

/** "Sun Oct 25 – Sat Oct 31, 2026"; both years are named when the days are in different ones. */
function rangeLabel({ start, end }: Period): string {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${dayLabel(start, false)} – ${dayLabel(end, true)}`
    : `${dayLabel(start, true)} – ${dayLabel(end, true)}`;
}

/** What a report reads about an item: only its title and where it sits. */
export type ReportItem = { id: number; parentId: number | null; title: string };

export type WeeklyReportInput = {
  week: Period;
  items: readonly ReportItem[];
  events: readonly TodoEvent[];
};

const inPeriod = (period: Period, date: LocalDate) => date >= period.start && date <= period.end;

/**
 * The items that were completed in the period, by id. An item counts if the last status change it had in the period
 * was to done, so ticking and unticking in one week credits nothing, and a later reopening does not take back a
 * completion that belongs to an earlier week. `events` are oldest first.
 */
function completedIn(events: readonly TodoEvent[], period: Period): number[] {
  const last = new Map<number, TodoEvent["toStatus"]>();
  for (const event of events) {
    if (event.kind === "status_changed" && inPeriod(period, event.on)) last.set(event.todoId, event.toStatus);
  }
  return [...last].filter(([, status]) => status === "done").map(([id]) => id).sort((a, b) => a - b);
}

/**
 * The completed items as a nested Markdown list, each under its parent. A parent with something listed beneath it is
 * in bold, with "(done)" if it was completed too; one that was not is only there for context. A sub-item whose parent
 * no longer exists is listed at the top.
 */
function completedLines(items: readonly ReportItem[], completed: readonly number[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const isCompleted = new Set(completed);
  const shown = new Set<number>();
  for (const id of completed) {
    for (let item = byId.get(id); item && !shown.has(item.id); item = item.parentId === null ? undefined : byId.get(item.parentId)) {
      shown.add(item.id);
    }
  }
  const ordered = [...items].filter((item) => shown.has(item.id)).sort((a, b) => a.id - b.id);
  const lines = (item: ReportItem, depth: number): string[] => {
    const children = ordered.filter((child) => child.parentId === item.id);
    const text = children.length > 0 ? `**${item.title}**${isCompleted.has(item.id) ? " (done)" : ""}` : item.title;
    return [`${"  ".repeat(depth)}- ${text}`, ...children.flatMap((child) => lines(child, depth + 1))];
  };
  return ordered.filter((item) => item.parentId === null || !byId.has(item.parentId)).flatMap((item) => lines(item, 0));
}

/** What happened in a period of any length, as a report reads it. */
function figuresIn(period: Period, items: readonly ReportItem[], events: readonly TodoEvent[]) {
  const titleOf = new Map(items.map((item) => [item.id, item.title]));
  const completed = completedIn(events, period).filter((id) => titleOf.has(id));
  const added = events.filter((event) => event.kind === "created" && inPeriod(period, event.on)).length;
  // Only what the owner dropped: a removed item was never done, and a done one is already under Completed.
  const dropped = [
    ...new Set(
      events
        .filter((event) => event.kind === "archived" && event.reason === "dropped" && inPeriod(period, event.on))
        .map((event) => event.todoId)
        .filter((id) => titleOf.has(id)),
    ),
  ].sort((a, b) => a - b);
  return { titleOf, completed, added, dropped };
}

/** What happened in a week: the figures for any period, and what rolled over when it closed. */
function weekFigures({ week, items, events }: WeeklyReportInput) {
  const figures = figuresIn(week, items, events);
  // The sweep that closes a week may run days later, so a roll belongs to the week it closed, not to the day it ran.
  const carriedOver = events
    .filter((event) => event.kind === "rolled" && event.weekStart === week.start && figures.titleOf.has(event.todoId))
    .sort((a, b) => a.todoId - b.todoId);
  return { ...figures, carriedOver };
}

/**
 * Whether the week is worth a report: something was completed, added, carried over or dropped. A quiet week (a
 * holiday) gets none, rather than a page of "None." (T21).
 */
export function weekHadActivity(input: WeeklyReportInput): boolean {
  const { completed, added, carriedOver, dropped } = weekFigures(input);
  return completed.length + added + carriedOver.length + dropped.length > 0;
}

/**
 * Whether a month or a quarter is worth a report: something was completed, added or dropped in it. One in which
 * nothing happened (the plugin was off, or the owner was away) gets none, like a quiet week (T21).
 */
export function periodHadActivity(period: Period, items: readonly ReportItem[], events: readonly TodoEvent[]): boolean {
  const { completed, added, dropped } = figuresIn(period, items, events);
  return completed.length + added + dropped.length > 0;
}

/** The Markdown of a weekly report. The sections are fixed; "My notes" is left empty for the owner to write in. */
export function renderWeeklyReport(input: WeeklyReportInput): string {
  const { week, items } = input;
  const { titleOf, completed, added, carriedOver, dropped } = weekFigures(input);
  return [
    `# Week of ${rangeLabel(week)}`,
    "",
    "## Summary",
    "",
    `Completed ${completed.length} · Added ${added} · Carried over ${carriedOver.length} · Dropped ${dropped.length}`,
    "",
    "## Completed",
    "",
    ...(completed.length > 0 ? completedLines(items, completed) : ["None."]),
    "",
    "## Carried over",
    "",
    ...(carriedOver.length > 0
      ? carriedOver.map((event) => `- ${titleOf.get(event.todoId)} (rolled ${event.rollCount}×)`)
      : ["None."]),
    "",
    "## Dropped",
    "",
    ...(dropped.length > 0 ? dropped.map((id) => `- ${titleOf.get(id)}`) : ["None."]),
    "",
    "## My notes",
    "",
    "",
  ].join("\n");
}

/**
 * What the owner wrote under "My notes" in a report: the lines after that heading up to the next heading of its own
 * level or above, trimmed. This is the one place the app reads back from a report. The heading is matched loosely, since
 * the owner can retype it; no heading means no notes.
 */
export function extractMyNotes(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+my notes\s*$/i.test(line));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type MonthlyReportInput = {
  month: Period;
  /** The weeks that touch the month, oldest first, whether or not they have closed yet. */
  weeks: readonly Period[];
  items: readonly ReportItem[];
  events: readonly TodoEvent[];
  /** What the owner wrote about each week (see `gatherWeekNotes`). */
  notes: readonly WeekNotes[];
};

/** The part of `inner` that lies within `outer`. */
const within = (inner: Period, outer: Period): Period => ({
  start: inner.start > outer.start ? inner.start : outer.start,
  end: inner.end < outer.end ? inner.end : outer.end,
});

/**
 * The completed work as a list of top-level items, for the longer reports: each with how many sub-items under it were
 * completed, and "done" if it was completed too. The detail is in the weekly reports.
 */
function topLevelLines(items: readonly ReportItem[], completed: readonly number[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rootOf = (item: ReportItem): ReportItem => {
    const parent = item.parentId === null ? undefined : byId.get(item.parentId);
    return parent ? rootOf(parent) : item;
  };
  const completedIds = new Set(completed);
  const subItems = new Map<number, number>();
  for (const id of completed) {
    const root = rootOf(byId.get(id)!);
    if (root.id !== id) subItems.set(root.id, (subItems.get(root.id) ?? 0) + 1);
  }
  const roots = new Set(completed.map((id) => rootOf(byId.get(id)!).id));
  return [...roots]
    .sort((a, b) => a - b)
    .map((id) => {
      const count = subItems.get(id) ?? 0;
      const notes = [
        ...(completedIds.has(id) && count > 0 ? ["done"] : []),
        ...(count > 0 ? [`${count} ${count === 1 ? "sub-item" : "sub-items"}`] : []),
      ];
      const title = byId.get(id)!.title;
      return count > 0 ? `- **${title}** (${notes.join(", ")})` : `- ${title}`;
    });
}

/**
 * The body of a longer report's "My notes": the notes of every week that ends in the period, each under a heading for
 * the week. A week belongs to the period its last day is in, so a week across a boundary is written about once, and a
 * monthly report never waits on a week that has not closed. With none, a blank line is left to write in.
 */
function notesSection(notes: readonly WeekNotes[], period: Period): string[] {
  const blocks = notes
    .filter(({ week }) => inPeriod(period, week.end))
    .sort((a, b) => a.week.start.localeCompare(b.week.start))
    .map(({ week, notes: text }) => `### ${rangeLabel(week)}\n\n${text}`);
  return blocks.length > 0 ? blocks.flatMap((block) => [block, ""]) : [""];
}

/**
 * The Markdown of a monthly report. Counted by completion date, so a week across the month's edge is split between the
 * two months and marked as a partial week.
 */
export function renderMonthlyReport({ month, weeks, items, events, notes }: MonthlyReportInput): string {
  const { titleOf, completed, added, dropped } = figuresIn(month, items, events);
  const [year, monthNumber] = month.start.split("-").map(Number);
  const weekNotes = notesSection(notes, month);
  return [
    `# ${MONTH_NAMES[monthNumber - 1]} ${year}`,
    "",
    "## Summary",
    "",
    `Completed ${completed.length} · Added ${added} · Dropped ${dropped.length}`,
    "",
    "## By week",
    "",
    ...weeks.map((week) => {
      const partial = week.start < month.start || week.end > month.end;
      const count = figuresIn(within(week, month), items, events).completed.length;
      return `- ${rangeLabel(week)}${partial ? " (partial week)" : ""}: completed ${count}`;
    }),
    "",
    "## Completed",
    "",
    ...(completed.length > 0 ? topLevelLines(items, completed) : ["None."]),
    "",
    "## Dropped",
    "",
    ...(dropped.length > 0 ? dropped.map((id) => `- ${titleOf.get(id)}`) : ["None."]),
    "",
    "## My notes",
    "",
    ...weekNotes,
  ].join("\n");
}

export type QuarterlyReportInput = {
  quarter: FiscalQuarter;
  items: readonly ReportItem[];
  events: readonly TodoEvent[];
  /** What the owner wrote about each week (see `gatherWeekNotes`). */
  notes: readonly WeekNotes[];
};

/** "October 2026" for a date in that month, or "Oct 2026" with `short`. */
function monthLabel(date: LocalDate, short = false): string {
  const [year, month] = date.split("-").map(Number);
  return `${(short ? MONTHS : MONTH_NAMES)[month - 1]} ${year}`;
}

/** The Markdown of a quarterly report: the months' totals and the top-level work done, counted by completion date. */
export function renderQuarterlyReport({ quarter, items, events, notes }: QuarterlyReportInput): string {
  const { titleOf, completed, added, dropped } = figuresIn(quarter, items, events);
  const firstMonth = monthOf(quarter.start);
  const secondMonth = monthOf(addDays(firstMonth.end, 1));
  const months = [firstMonth, secondMonth, monthOf(addDays(secondMonth.end, 1))];
  return [
    `# ${quarter.fiscalYear} Q${quarter.quarter} (${monthLabel(quarter.start, true)} – ${monthLabel(quarter.end, true)})`,
    "",
    "## Summary",
    "",
    `Completed ${completed.length} · Added ${added} · Dropped ${dropped.length}`,
    "",
    "## By month",
    "",
    ...months.map((month) => `- ${monthLabel(month.start)}: completed ${figuresIn(month, items, events).completed.length}`),
    "",
    "## Completed",
    "",
    ...(completed.length > 0 ? topLevelLines(items, completed) : ["None."]),
    "",
    "## Dropped",
    "",
    ...(dropped.length > 0 ? dropped.map((id) => `- ${titleOf.get(id)}`) : ["None."]),
    "",
    "## My notes",
    "",
    ...notesSection(notes, quarter),
  ].join("\n");
}

/** A weekly report as it stands now, edited or not. */
export type WeekReport = { week: Period; generatedAt: string; markdown: string };

/** What the owner wrote about one week. */
export type WeekNotes = { week: Period; notes: string };

/**
 * The notes of each week, gathered from every report made for it: regenerating makes a new note, so a week can have an
 * edited original and a fresh copy. Non-empty sections are kept oldest report first, and one that repeats an earlier
 * one word for word is skipped. Weeks with no notes are left out; the result is oldest week first.
 */
export function gatherWeekNotes(reports: readonly WeekReport[]): WeekNotes[] {
  const byWeek = new Map<string, WeekReport[]>();
  for (const report of reports) byWeek.set(report.week.start, [...(byWeek.get(report.week.start) ?? []), report]);
  return [...byWeek.values()]
    .map((sameWeek) => {
      const written = sameWeek
        .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
        .map((report) => extractMyNotes(report.markdown))
        .filter((notes) => notes !== "");
      return { week: sameWeek[0].week, notes: [...new Set(written)].join("\n\n") };
    })
    .filter(({ notes }) => notes !== "")
    .sort((a, b) => a.week.start.localeCompare(b.week.start));
}

const KIND_NAMES: Record<ReportKind, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" };

/**
 * A report's note title: its period and when it was generated, to the minute. Regenerating makes a new note rather than
 * rewriting one, so the stamp keeps them apart; if a report with the same title is already there (`taken`), the seconds
 * are added.
 */
export function reportTitle(report: ReportPeriod, generatedAt: Date, taken: ReadonlySet<string> = new Set()): string {
  const title = (seconds: boolean) => `${KIND_NAMES[report.kind]} ${periodLabel(report)} · generated ${stamp(generatedAt, seconds)}`;
  return taken.has(title(false)) ? title(true) : title(false);
}
