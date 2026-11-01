import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Listing the reports, and making one by hand (Regenerate), on a real temporary database. The clock is passed in and the
 * time zone pinned to New York; weeks run Sunday to Saturday, and 25 October 2026 is a Sunday.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todo-reports-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("TZ", "America/New_York");
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const local = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute);

async function load() {
  const maker = await import("./todoReportMaker");
  const cycle = await import("./todoCycle");
  const repo = await import("./todosRepo");
  const notes = await import("./notesRepo");
  const settings = await import("./webSettings");
  const { getDb } = await import("./db");
  const setSettings = (change: Partial<import("./webSettings").WebSettings>) => settings.saveWebSettings({ ...settings.loadWebSettings(), ...change });
  return { maker, cycle, repo, notes, getDb, setSettings };
}

/** An item made on one day and finished on another (month, day), at the times of day given. */
function work(repo: typeof import("./todosRepo"), title: string, made: [number, number], done: [number, number]) {
  const item = repo.addTodo(title, null, local(made[0], made[1], 9));
  repo.updateTodo(item.id, { done: true }, local(done[0], done[1], 15));
  return item;
}

describe("the reports that exist", () => {
  it("lists them newest period first, every copy of a period, and not one whose note has been deleted", async () => {
    const { maker, cycle, repo, getDb } = await load();
    cycle.runCycle(local(10, 7)); // closed through Saturday 3 October
    work(repo, "Reply to vendor", [10, 5], [10, 6]);
    work(repo, "Send invoice", [10, 12], [10, 13]);
    cycle.runCycle(local(10, 19)); // the weeks of 4 to 10 and 11 to 17 October have ended
    const copy = maker.generateReport("weekly", "2026-10-11", local(10, 20));
    const gone = maker.generateReport("weekly", "2026-10-04", local(10, 20, 13));
    getDb().prepare("DELETE FROM notes WHERE id = ?").run(gone.noteId);

    const { reports } = maker.loadReports(local(10, 21));

    expect(reports.map((r) => [r.kind, r.periodStart, r.periodEnd, r.label])).toEqual([
      ["weekly", "2026-10-11", "2026-10-17", "2026-10-11 → 2026-10-17"],
      ["weekly", "2026-10-11", "2026-10-17", "2026-10-11 → 2026-10-17"],
      ["weekly", "2026-10-04", "2026-10-10", "2026-10-04 → 2026-10-10"],
    ]);
    expect(reports[0].noteId).toBe(copy.noteId);
    expect(reports[0].title).toBe("Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-20 12:00");
    expect(reports.some((r) => r.noteId === gone.noteId)).toBe(false);
  });

  it("lists the closed periods in the retention window that have no report, newest first", async () => {
    const { maker, cycle, repo, getDb } = await load();
    cycle.runCycle(local(10, 7));
    work(repo, "Reply to vendor", [10, 12], [10, 13]); // only the week of the 11th has anything in it
    cycle.runCycle(local(10, 27)); // the weeks of 4 to 10, 11 to 17 and 18 to 24 October have ended

    const { missing } = maker.loadReports(local(10, 27));

    // The week the first run started from (27 September to 3 October) is offered too, like any closed week without a report.
    expect(missing.filter((m) => m.kind === "weekly").map((m) => m.periodStart)).toEqual(["2026-10-18", "2026-10-04", "2026-09-27"]);
    expect(missing[0]).toEqual({ kind: "weekly", periodStart: "2026-10-18", periodEnd: "2026-10-24", label: "2026-10-18 → 2026-10-24" });

    // A report that was deleted is missing again.
    getDb().prepare("DELETE FROM notes WHERE title LIKE 'Weekly 2026-10-11%'").run();
    expect(maker.loadReports(local(10, 27)).missing.map((m) => m.periodStart)).toContain("2026-10-11");
  });

  it("does not offer a period that is older than the archive is kept, or one that has not closed", async () => {
    const { maker, cycle, setSettings } = await load();
    cycle.runCycle(local(10, 7));
    cycle.runCycle(local(10, 27));
    expect(maker.loadReports(local(10, 27)).missing.map((m) => m.periodStart)).toContain("2026-10-04");

    setSettings({ todos: { weekStartsOn: 0, retentionMonths: 1, fiscalYearStartMonth: 1 } });
    const later = maker.loadReports(local(12, 20)).missing.filter((m) => m.kind === "weekly");

    expect(later.map((m) => m.periodStart)).not.toContain("2026-10-04");
    expect(later.map((m) => m.periodStart)).not.toContain("2026-12-20"); // the week in progress is not closed
  });

  it("offers every period while archived items are kept forever", async () => {
    const { maker, cycle, setSettings } = await load();
    setSettings({ todos: { weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 } });
    cycle.runCycle(local(10, 7));
    cycle.runCycle(local(10, 27));

    expect(maker.loadReports(local(2030, 1)).missing.map((m) => m.periodStart)).toContain("2026-10-04");
  });
});

describe("Regenerate", () => {
  it("makes a new report note and leaves the first, with what was written in it, exactly as it was", async () => {
    const { maker, cycle, repo, notes } = await load();
    cycle.runCycle(local(10, 14));
    work(repo, "Reply to vendor", [10, 12], [10, 13]);
    cycle.runCycle(local(10, 19));
    const first = maker.loadReports(local(10, 19)).reports[0];
    const original = notes.getNote(first.noteId)!;
    const edited = original.content.replace(/## My notes\s*$/m, "## My notes\n\nShipped the migration.");
    notes.updateNoteContent(first.noteId, edited);

    const again = maker.generateReport("weekly", "2026-10-11", local(10, 20, 9, 30));

    expect(again.noteId).not.toBe(first.noteId);
    expect(again.title).toBe("Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-20 09:30");
    expect(notes.getNote(first.noteId)!.content).toBe(edited);
    expect(notes.getNote(first.noteId)!.content).toContain("Shipped the migration.");
    expect(notes.getNote(first.noteId)!.title).toBe(first.title);
    expect(notes.getNote(again.noteId)!.content).toContain("Reply to vendor");
    expect(notes.getNote(again.noteId)!.content).not.toContain("Shipped the migration.");
    expect(maker.loadReports(local(10, 21)).reports.map((r) => r.noteId)).toEqual([again.noteId, first.noteId]);
  });

  it("adds the seconds to the title when a report with the same one is already there", async () => {
    const { maker, cycle, repo } = await load();
    cycle.runCycle(local(10, 14));
    work(repo, "Reply to vendor", [10, 12], [10, 13]);
    cycle.runCycle(local(10, 19));

    const at = new Date(2026, 9, 20, 9, 30, 41);
    const one = maker.generateReport("weekly", "2026-10-11", at);
    const two = maker.generateReport("weekly", "2026-10-11", at);

    expect(one.title).toBe("Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-20 09:30");
    expect(two.title).toBe("Weekly 2026-10-11 → 2026-10-17 · generated 2026-10-20 09:30:41");
  });

  it("can make a report for a quiet week by hand", async () => {
    const { maker, cycle } = await load();
    cycle.runCycle(local(10, 14));
    cycle.runCycle(local(10, 27));
    expect(maker.loadReports(local(10, 27)).reports).toEqual([]);

    const made = maker.generateReport("weekly", "2026-10-18", local(10, 27));

    expect(made).toMatchObject({ kind: "weekly", periodStart: "2026-10-18", periodEnd: "2026-10-24" });
    expect(maker.loadReports(local(10, 27)).missing.map((m) => m.periodStart)).not.toContain("2026-10-18");
  });

  it("makes a monthly report by hand that carries up what is written in the weekly reports now", async () => {
    const { maker, cycle, repo, notes } = await load();
    cycle.runCycle(local(10, 14));
    work(repo, "Reply to vendor", [10, 12], [10, 13]);
    cycle.runCycle(local(10, 19));
    cycle.runCycle(local(11, 2)); // October has ended, and has its report
    const weekly = maker.loadReports(local(11, 2)).reports.find((r) => r.kind === "weekly")!;
    notes.updateNoteContent(weekly.noteId, notes.getNote(weekly.noteId)!.content.replace(/## My notes\s*$/m, "## My notes\n\nAdded after the month closed."));

    const monthly = maker.generateReport("monthly", "2026-10-01", local(11, 3));

    expect(notes.getNote(monthly.noteId)!.content).toContain("Added after the month closed.");
    expect(maker.loadReports(local(11, 3)).reports.filter((r) => r.kind === "monthly")).toHaveLength(2);
  });

  it("refuses a period that has not closed, one that is not a period, and one that is older than the archive is kept", async () => {
    const { maker, cycle, setSettings } = await load();
    cycle.runCycle(local(10, 14));
    cycle.runCycle(local(10, 27));

    expect(() => maker.generateReport("weekly", "2026-10-25", local(10, 27))).toThrow(/not closed/);
    expect(() => maker.generateReport("weekly", "2026-10-19", local(10, 27))).toThrow(/not closed/);
    expect(() => maker.generateReport("monthly", "2026-10-01", local(10, 27))).toThrow(/not closed/);
    expect(() => maker.generateReport("quarterly", "2026-10-01", local(10, 27))).toThrow(/not closed/);

    setSettings({ todos: { weekStartsOn: 0, retentionMonths: 1, fiscalYearStartMonth: 1 } });
    expect(() => maker.generateReport("weekly", "2026-10-11", local(12, 20))).toThrow(/older than/);
  });
});
