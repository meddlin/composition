import { describe, expect, it } from "vitest";
import type { TodoEvent } from "./todoEvents";
import {
  extractMyNotes,
  gatherWeekNotes,
  periodHadActivity,
  renderMonthlyReport,
  renderQuarterlyReport,
  renderWeeklyReport,
  reportTitle,
  weekHadActivity,
  type ReportItem,
} from "./todoReports";
import type { TodoStatus } from "./todosApi";

const item = (id: number, title: string, parentId: number | null = null): ReportItem => ({ id, parentId, title });

const moved = (todoId: number, on: string, fromStatus: TodoStatus, toStatus: TodoStatus): TodoEvent => ({
  todoId,
  kind: "status_changed",
  at: `${on}T09:00:00.000Z`,
  on,
  fromStatus,
  toStatus,
});
const ticked = (todoId: number, on: string) => moved(todoId, on, "todo", "done");
const unticked = (todoId: number, on: string) => moved(todoId, on, "done", "todo");

/** The lines of the Completed section of a weekly report. */
function completedSection(items: ReportItem[], events: TodoEvent[]): string[] {
  const text = renderWeeklyReport({ week: { start: "2026-10-25", end: "2026-10-31" }, items, events });
  return text.split("## Completed\n\n")[1].split("\n\n## ")[0].split("\n");
}

describe("renderMonthlyReport", () => {
  const october = { start: "2026-10-01", end: "2026-10-31" };
  const lastWeek = { start: "2026-10-25", end: "2026-10-31" };

  it("writes every section, with a note where there is nothing, and an empty My notes to write in", () => {
    expect(renderMonthlyReport({ month: october, weeks: [lastWeek], items: [], events: [], notes: [] })).toBe(
      [
        "# October 2026",
        "",
        "## Summary",
        "",
        "Completed 0 · Added 0 · Dropped 0",
        "",
        "## By week",
        "",
        "- Sun Oct 25 – Sat Oct 31, 2026: completed 0",
        "",
        "## Completed",
        "",
        "None.",
        "",
        "## Dropped",
        "",
        "None.",
        "",
        "## My notes",
        "",
        "",
      ].join("\n"),
    );
  });

  describe("the Completed section", () => {
    const items = [
      item(10, "Ship auth refactor"),
      item(11, "Migrate session store", 10),
      item(12, "Remove legacy cookie path", 10),
      item(14, "Write tests", 11),
      item(13, "Reply to vendor"),
    ];
    const completedLines = (events: TodoEvent[]) =>
      renderMonthlyReport({ month: october, weeks: [lastWeek], items, events, notes: [] })
        .split("## Completed\n\n")[1]
        .split("\n\n## ")[0]
        .split("\n");

    it("lists the top-level items, each with how many sub-items under it were completed", () => {
      const events = [ticked(11, "2026-10-05"), ticked(12, "2026-10-06"), ticked(14, "2026-10-07"), ticked(13, "2026-10-08")];

      expect(completedLines(events)).toEqual(["- **Ship auth refactor** (3 sub-items)", "- Reply to vendor"]);
    });

    it("says when the top-level item was done too, and counts one sub-item in the singular", () => {
      expect(completedLines([ticked(11, "2026-10-05"), ticked(10, "2026-10-09")])).toEqual([
        "- **Ship auth refactor** (done, 1 sub-item)",
      ]);
    });

    it("lists an item that was done with nothing under it by its title alone", () => {
      expect(completedLines([ticked(13, "2026-10-08")])).toEqual(["- Reply to vendor"]);
    });
  });

  it("carries the notes of each week that ends in the month into My notes, headed by the week", () => {
    const notes = [
      { week: { start: "2026-09-20", end: "2026-09-26" }, notes: "Ended in September." },
      { week: { start: "2026-09-27", end: "2026-10-03" }, notes: "Ended in October, started in September." },
      { week: lastWeek, notes: "Late October." },
      { week: { start: "2026-11-01", end: "2026-11-07" }, notes: "Ends in November." },
    ];

    const text = renderMonthlyReport({ month: october, weeks: [lastWeek], items: [], events: [], notes });

    expect(extractMyNotes(text)).toBe(
      [
        "### Sun Sep 27 – Sat Oct 3, 2026",
        "",
        "Ended in October, started in September.",
        "",
        "### Sun Oct 25 – Sat Oct 31, 2026",
        "",
        "Late October.",
      ].join("\n"),
    );
  });

  it("counts by completion date, so a week across the month's edge is split and marked partial", () => {
    const weeks = [
      { start: "2026-09-27", end: "2026-10-03" },
      { start: "2026-10-04", end: "2026-10-10" },
    ];
    const items = [item(1, "In September"), item(2, "On the 2nd"), item(3, "On the 5th")];
    const events = [ticked(1, "2026-09-30"), ticked(2, "2026-10-02"), ticked(3, "2026-10-05")];

    const text = renderMonthlyReport({ month: october, weeks, items, events, notes: [] });

    expect(text).toContain("Completed 2 · Added 0 · Dropped 0");
    expect(text).toContain("- Sun Sep 27 – Sat Oct 3, 2026 (partial week): completed 1");
    expect(text).toContain("- Sun Oct 4 – Sat Oct 10, 2026: completed 1");
  });
});

describe("renderMonthlyReport, added and dropped", () => {
  it("counts what was added in the month and lists what was dropped, not what was removed", () => {
    const october = { start: "2026-10-01", end: "2026-10-31" };
    const items = [item(1, "New thing"), item(2, "Look into old CI flake"), item(3, "Old idea")];
    const events: TodoEvent[] = [
      { todoId: 1, kind: "created", at: "2026-10-12T09:00:00.000Z", on: "2026-10-12" },
      { todoId: 2, kind: "archived", at: "2026-10-14T09:00:00.000Z", on: "2026-10-14", reason: "dropped" },
      { todoId: 3, kind: "archived", at: "2026-10-15T09:00:00.000Z", on: "2026-10-15", reason: "removed" },
      { todoId: 1, kind: "created", at: "2026-11-02T09:00:00.000Z", on: "2026-11-02" },
    ];

    const text = renderMonthlyReport({ month: october, weeks: [], items, events, notes: [] });

    expect(text).toContain("Completed 0 · Added 1 · Dropped 1");
    expect(text).toContain("## Dropped\n\n- Look into old CI flake\n");
  });
});

describe("renderQuarterlyReport", () => {
  const quarter = { start: "2026-10-01", end: "2026-12-31", fiscalYear: 2027, quarter: 1 } as const;

  it("writes every section, with a line for each month, and an empty My notes to write in", () => {
    expect(renderQuarterlyReport({ quarter, items: [], events: [], notes: [] })).toBe(
      [
        "# 2027 Q1 (Oct 2026 – Dec 2026)",
        "",
        "## Summary",
        "",
        "Completed 0 · Added 0 · Dropped 0",
        "",
        "## By month",
        "",
        "- October 2026: completed 0",
        "- November 2026: completed 0",
        "- December 2026: completed 0",
        "",
        "## Completed",
        "",
        "None.",
        "",
        "## Dropped",
        "",
        "None.",
        "",
        "## My notes",
        "",
        "",
      ].join("\n"),
    );
  });

  it("counts each month by completion date, lists the top-level work, and carries the notes of weeks ending in the quarter", () => {
    const items = [item(10, "Ship auth refactor"), item(11, "Migrate session store", 10), item(13, "Reply to vendor")];
    const events = [ticked(11, "2026-10-05"), ticked(13, "2026-11-20"), ticked(10, "2026-12-15"), ticked(13, "2027-01-02")];
    const notes = [
      { week: { start: "2026-12-27", end: "2027-01-02" }, notes: "Ends next quarter." },
      { week: { start: "2026-12-20", end: "2026-12-26" }, notes: "Christmas week." },
    ];

    const text = renderQuarterlyReport({ quarter, items, events, notes });

    expect(text).toContain("Completed 3 · Added 0 · Dropped 0");
    expect(text).toContain("- October 2026: completed 1\n- November 2026: completed 1\n- December 2026: completed 1");
    expect(text).toContain("## Completed\n\n- **Ship auth refactor** (done, 1 sub-item)\n- Reply to vendor\n");
    expect(extractMyNotes(text)).toBe("### Sun Dec 20 – Sat Dec 26, 2026\n\nChristmas week.");
  });
});

describe("extractMyNotes", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };
  const generated = renderWeeklyReport({ week, items: [], events: [] });

  it("is empty for a report nobody has written in", () => {
    expect(extractMyNotes(generated)).toBe("");
  });

  it("is what was written under My notes, trimmed", () => {
    expect(extractMyNotes(`${generated}\n  Shipped auth. Vendor call went well.  \n\n`)).toBe(
      "Shipped auth. Vendor call went well.",
    );
  });

  it("stops at the next heading of its own level or above", () => {
    const text = "## My notes\n\nOne.\n\n## Something else\n\nNot mine.\n";

    expect(extractMyNotes(text)).toBe("One.");
  });

  it("keeps sub-headings, lists and blank lines inside the section", () => {
    const text = "## My notes\n\n### Wins\n\n- A\n- B\n\n### Worries\n\nC\n";

    expect(extractMyNotes(text)).toBe("### Wins\n\n- A\n- B\n\n### Worries\n\nC");
  });

  it("finds the heading however it was retyped, and handles Windows line ends", () => {
    expect(extractMyNotes("## my notes  \r\n\r\nMine.\r\n")).toBe("Mine.");
  });

  it("is empty when the heading is gone", () => {
    expect(extractMyNotes("# Week\n\n## Completed\n\n- X\n")).toBe("");
  });
});

describe("gatherWeekNotes", () => {
  const oct25 = { start: "2026-10-25", end: "2026-10-31" };
  const nov1 = { start: "2026-11-01", end: "2026-11-07" };
  const report = (week: { start: string; end: string }, generatedAt: string, notes: string) => ({
    week,
    generatedAt,
    markdown: `# Week\n\n## Completed\n\nNone.\n\n## My notes\n\n${notes}\n`,
  });

  it("has nothing for reports nobody wrote in", () => {
    expect(gatherWeekNotes([])).toEqual([]);
    expect(gatherWeekNotes([report(oct25, "2026-11-01T09:00:00.000Z", "")])).toEqual([]);
  });

  it("takes the notes of a week from every report made for it, oldest report first", () => {
    const reports = [
      report(oct25, "2026-11-03T09:00:00.000Z", "Written in the regenerated copy."),
      report(oct25, "2026-11-01T09:00:00.000Z", "Written in the first one."),
      report(oct25, "2026-11-04T09:00:00.000Z", ""),
    ];

    expect(gatherWeekNotes(reports)).toEqual([
      { week: oct25, notes: "Written in the first one.\n\nWritten in the regenerated copy." },
    ]);
  });

  it("skips notes that were copied into a second report word for word", () => {
    const reports = [
      report(oct25, "2026-11-01T09:00:00.000Z", "Same text."),
      report(oct25, "2026-11-03T09:00:00.000Z", "Same text.  "),
    ];

    expect(gatherWeekNotes(reports)).toEqual([{ week: oct25, notes: "Same text." }]);
  });

  it("keeps each week apart and lists them oldest first", () => {
    const reports = [report(nov1, "2026-11-08T09:00:00.000Z", "Later."), report(oct25, "2026-11-01T09:00:00.000Z", "Earlier.")];

    expect(gatherWeekNotes(reports)).toEqual([
      { week: oct25, notes: "Earlier." },
      { week: nov1, notes: "Later." },
    ]);
  });
});

describe("weekHadActivity", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };
  const items = [item(1, "A task")];
  const at = "2026-10-27T09:00:00.000Z";
  const had = (events: TodoEvent[]) => weekHadActivity({ week, items, events });

  it("is false for a week in which nothing happened, or only things a report does not mention", () => {
    expect(had([])).toBe(false);
    expect(had([{ todoId: 1, kind: "renamed", at, on: "2026-10-27" }])).toBe(false);
    expect(had([{ todoId: 1, kind: "archived", at, on: "2026-10-27", reason: "removed" }])).toBe(false);
    expect(had([ticked(1, "2026-11-02")])).toBe(false);
  });

  it("is true if something was completed, added, carried over or dropped", () => {
    expect(had([ticked(1, "2026-10-27")])).toBe(true);
    expect(had([{ todoId: 1, kind: "created", at, on: "2026-10-27" }])).toBe(true);
    expect(had([{ todoId: 1, kind: "rolled", at, on: "2026-11-01", weekStart: week.start, rollCount: 1 }])).toBe(true);
    expect(had([{ todoId: 1, kind: "archived", at, on: "2026-10-27", reason: "dropped" }])).toBe(true);
  });
});

describe("periodHadActivity", () => {
  const october = { start: "2026-10-01", end: "2026-10-31" };
  const items = [item(1, "A task")];
  const at = "2026-10-15T09:00:00.000Z";
  const had = (events: TodoEvent[]) => periodHadActivity(october, items, events);

  it("is false for a month in which nothing happened, or only things a report does not mention", () => {
    expect(had([])).toBe(false);
    expect(had([{ todoId: 1, kind: "renamed", at, on: "2026-10-15" }])).toBe(false);
    expect(had([{ todoId: 1, kind: "archived", at, on: "2026-10-15", reason: "removed" }])).toBe(false);
    expect(had([ticked(1, "2026-11-02"), ticked(1, "2026-09-30")])).toBe(false);
  });

  it("is true if something was completed, added or dropped in it", () => {
    expect(had([ticked(1, "2026-10-15")])).toBe(true);
    expect(had([{ todoId: 1, kind: "created", at, on: "2026-10-31" }])).toBe(true);
    expect(had([{ todoId: 1, kind: "archived", at, on: "2026-10-01", reason: "dropped" }])).toBe(true);
  });

  it("does not count something about an item that is no longer there", () => {
    expect(periodHadActivity(october, [], [ticked(1, "2026-10-15")])).toBe(false);
  });
});

describe("the rest of a weekly report", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };
  const items = [item(1, "Write Q4 plan"), item(2, "Look into old CI flake"), item(3, "Old idea")];
  const created = (todoId: number, on: string): TodoEvent => ({ todoId, kind: "created", at: `${on}T09:00:00.000Z`, on });
  // The sweep that closes the week may run on Sunday or Monday: `on` is when it ran, `weekStart` is the week it closed.
  const rolled = (todoId: number, weekStart: string, rollCount: number): TodoEvent => ({
    todoId,
    kind: "rolled",
    at: "2026-11-01T09:00:00.000Z",
    on: "2026-11-01",
    weekStart,
    rollCount,
  });
  const archived = (todoId: number, on: string, reason: "done" | "removed" | "dropped"): TodoEvent => ({
    todoId,
    kind: "archived",
    at: `${on}T09:00:00.000Z`,
    on,
    reason,
  });
  const summary = (events: TodoEvent[]) => renderWeeklyReport({ week, items, events }).split("\n")[4];
  const section = (name: string, events: TodoEvent[]) =>
    renderWeeklyReport({ week, items, events }).split(`## ${name}\n\n`)[1].split("\n\n## ")[0].split("\n");

  it("counts the items added in the week", () => {
    const events = [created(1, "2026-10-26"), created(2, "2026-10-31"), created(3, "2026-11-01")];

    expect(summary(events)).toBe("Completed 0 · Added 2 · Carried over 0 · Dropped 0");
  });

  it("lists what rolled over when this week closed, with how many weeks it has been through", () => {
    const events = [rolled(1, "2026-10-25", 2), rolled(2, "2026-10-18", 1)];

    expect(section("Carried over", events)).toEqual(["- Write Q4 plan (rolled 2×)"]);
    expect(summary(events)).toBe("Completed 0 · Added 0 · Carried over 1 · Dropped 0");
  });

  it("lists what was dropped in the week", () => {
    const events = [archived(2, "2026-10-29", "dropped"), archived(2, "2026-11-02", "dropped")];

    expect(section("Dropped", events)).toEqual(["- Look into old CI flake"]);
    expect(summary(events)).toContain("Dropped 1");
  });

  it("does not mention an item that was removed, or one the sweep archived as done", () => {
    const events = [archived(3, "2026-10-29", "removed"), archived(1, "2026-10-31", "done")];

    expect(section("Dropped", events)).toEqual(["None."]);
    expect(summary(events)).toBe("Completed 0 · Added 0 · Carried over 0 · Dropped 0");
  });
});

describe("the Completed section of a weekly report", () => {
  it("lists what was ticked off in the week, and counts it", () => {
    const items = [item(1, "Reply to vendor"), item(2, "Write Q4 plan")];
    const events = [ticked(2, "2026-10-28"), ticked(1, "2026-10-27")];

    expect(completedSection(items, events)).toEqual(["- Reply to vendor", "- Write Q4 plan"]);
    expect(renderWeeklyReport({ week: { start: "2026-10-25", end: "2026-10-31" }, items, events })).toContain("Completed 2 ·");
  });

  it("leaves out what was ticked in another week", () => {
    const items = [item(1, "Before"), item(2, "After")];
    const events = [ticked(1, "2026-10-24"), ticked(2, "2026-11-01")];

    expect(completedSection(items, events)).toEqual(["None."]);
  });

  it("leaves out an item that was ticked and then unticked in the week", () => {
    expect(completedSection([item(1, "Flip-flop")], [ticked(1, "2026-10-27"), unticked(1, "2026-10-28")])).toEqual(["None."]);
  });

  it("lists an item once if it was ticked, unticked and ticked again", () => {
    const events = [ticked(1, "2026-10-26"), unticked(1, "2026-10-27"), ticked(1, "2026-10-29")];

    expect(completedSection([item(1, "Again")], events)).toEqual(["- Again"]);
  });

  it("still credits the week it was done in when the item was reopened in a later week", () => {
    expect(completedSection([item(1, "Done then")], [ticked(1, "2026-10-27"), unticked(1, "2026-11-03")])).toEqual(["- Done then"]);
  });

  describe("with sub-items", () => {
    const items = [
      item(10, "Ship auth refactor"),
      item(11, "Migrate session store", 10),
      item(12, "Remove legacy cookie path", 10),
      item(13, "Reply to vendor"),
    ];

    it("lists completed sub-items under their parent, which is in bold", () => {
      const events = [ticked(11, "2026-10-26"), ticked(12, "2026-10-27"), ticked(13, "2026-10-28")];

      expect(completedSection(items, events)).toEqual([
        "- **Ship auth refactor**",
        "  - Migrate session store",
        "  - Remove legacy cookie path",
        "- Reply to vendor",
      ]);
    });

    it("marks the parent done when it was completed in the week too", () => {
      const events = [ticked(11, "2026-10-26"), ticked(10, "2026-10-27")];

      expect(completedSection(items, events)).toEqual(["- **Ship auth refactor** (done)", "  - Migrate session store"]);
    });

    it("nests as deep as the items do, and shows an ancestor that was not completed as context", () => {
      const deep = [...items, item(14, "Write tests", 11)];

      expect(completedSection(deep, [ticked(14, "2026-10-26")])).toEqual([
        "- **Ship auth refactor**",
        "  - **Migrate session store**",
        "    - Write tests",
      ]);
    });

    it("shows a sub-item at the top when its parent no longer exists", () => {
      expect(completedSection([item(21, "Orphan", 99)], [ticked(21, "2026-10-26")])).toEqual(["- Orphan"]);
    });
  });
});

describe("renderWeeklyReport", () => {
  const week = { start: "2026-10-25", end: "2026-10-31" };

  it("writes every section, with a note where there is nothing, and an empty My notes to write in", () => {
    expect(renderWeeklyReport({ week, items: [], events: [] })).toBe(
      [
        "# Week of Sun Oct 25 – Sat Oct 31, 2026",
        "",
        "## Summary",
        "",
        "Completed 0 · Added 0 · Carried over 0 · Dropped 0",
        "",
        "## Completed",
        "",
        "None.",
        "",
        "## Carried over",
        "",
        "None.",
        "",
        "## Dropped",
        "",
        "None.",
        "",
        "## My notes",
        "",
        "",
      ].join("\n"),
    );
  });

  it("names both years in the heading of a week that crosses the new year", () => {
    const text = renderWeeklyReport({ week: { start: "2026-12-27", end: "2027-01-02" }, items: [], events: [] });

    expect(text.split("\n")[0]).toBe("# Week of Sun Dec 27, 2026 – Sat Jan 2, 2027");
  });
});

// Built from local parts, so the stamps read the same in whatever time zone the tests run in.
const generatedAt = new Date(2026, 10, 1, 14, 3, 7);

describe("reportTitle", () => {
  it("names a weekly report by its days and when it was generated", () => {
    expect(reportTitle({ kind: "weekly", period: { start: "2026-10-25", end: "2026-10-31" } }, generatedAt)).toBe(
      "Weekly 2026-10-25 → 2026-10-31 · generated 2026-11-01 14:03",
    );
  });

  it("names a monthly report by its month", () => {
    expect(reportTitle({ kind: "monthly", period: { start: "2026-10-01", end: "2026-10-31" } }, generatedAt)).toBe(
      "Monthly 2026-10 · generated 2026-11-01 14:03",
    );
  });

  it("names a quarterly report by its fiscal quarter", () => {
    const quarter = { start: "2026-10-01", end: "2026-12-31", fiscalYear: 2027, quarter: 1 } as const;

    expect(reportTitle({ kind: "quarterly", period: quarter }, generatedAt)).toBe(
      "Quarterly 2027 Q1 · generated 2026-11-01 14:03",
    );
  });

  it("adds the seconds when a report with that title already exists", () => {
    const week = { kind: "weekly", period: { start: "2026-10-25", end: "2026-10-31" } } as const;
    const taken = new Set(["Weekly 2026-10-25 → 2026-10-31 · generated 2026-11-01 14:03"]);

    expect(reportTitle(week, generatedAt, taken)).toBe("Weekly 2026-10-25 → 2026-10-31 · generated 2026-11-01 14:03:07");
  });
});
