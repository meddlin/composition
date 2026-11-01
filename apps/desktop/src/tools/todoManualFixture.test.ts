import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fixture behind the to-do manual test (docs/manual-tests/todo-archival.md): each scenario builds a scratch database
 * whose dates are relative to a clock, and the tests run the real weekly cycle on it to see that it leaves the app where the
 * manual test says it will. Wednesday 4 November 2026, in New York, with weeks that start on Sunday.
 */

let home: string;
const NOW = new Date(2026, 10, 4, 12, 0);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-todo-fixture-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("TZ", "America/New_York");
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(home, "userData", "settings.json"));
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("../../../web/src/lib/composition/db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

async function load() {
  const fixture = await import("./todoManualFixture");
  const cycle = await import("../../../web/src/lib/composition/todoCycle");
  const repo = await import("../../../web/src/lib/composition/todosRepo");
  const maker = await import("../../../web/src/lib/composition/todoReportMaker");
  return { fixture, cycle, repo, maker };
}

const titleOf = (title: string) => title.split(" · ")[0];

describe("the scenario behind", () => {
  it("leaves three weeks to close at launch, with the work the manual test looks for", async () => {
    const { fixture, cycle, repo } = await load();
    fixture.setupScenario("behind", { now: NOW });
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-10");

    const result = cycle.runCycle(NOW);

    expect(result.closedWeeks).toBe(3);
    const live = repo.listTodos();
    const byTitle = (title: string) => live.find((t) => t.title === title);
    // The open items roll over, three times, from the first of the weeks.
    for (const title of ["Write the Q4 plan", "Plan trip", "Book flights", "Pack boxes"]) {
      expect(byTitle(title)).toMatchObject({ rolledFromWeek: "2026-10-11", rollCount: 3 });
    }
    // A done parent with an open sub-item stays, and the backlog is left alone.
    expect(byTitle("Move house")).toMatchObject({ status: "done" });
    expect(byTitle("Move house")?.rolledFromWeek).toBeUndefined();
    expect(byTitle("Someday: learn Spanish")).toMatchObject({ status: "backlog" });
    // What was done in a closed week is archived, under the week it was done in.
    expect(repo.listArchivedTodos().map((t) => [t.title, t.archiveWeek])).toEqual(
      expect.arrayContaining([
        ["Reply to vendor", "2026-10-11"],
        ["Ship the migration", "2026-10-25"],
      ]),
    );
  });

  it("makes the weekly reports, and the monthly and quarterly ones that came due", async () => {
    const { fixture, cycle, maker } = await load();
    fixture.setupScenario("behind", { now: NOW });

    cycle.runCycle(NOW);

    const titles = maker.loadReports(NOW).reports.map((r) => titleOf(r.title));
    expect(titles).toEqual(
      expect.arrayContaining([
        "Weekly 2026-10-11 → 2026-10-17",
        "Weekly 2026-10-18 → 2026-10-24",
        "Weekly 2026-10-25 → 2026-10-31",
        "Monthly 2026-10",
        "Quarterly 2026 Q3",
      ]),
    );
  });

  it("can be one week behind, or as many as asked", async () => {
    const one = await load();
    one.fixture.setupScenario("behind", { weeks: 1, now: NOW });
    expect(one.repo.lastClosedWeekEnd()).toBe("2026-10-24");
    expect(one.cycle.runCycle(NOW).closedWeeks).toBe(1);
    const { closeDb } = await import("../../../web/src/lib/composition/db");
    closeDb();
    fs.rmSync(path.join(home, ".composition"), { recursive: true, force: true });
    vi.resetModules();

    const five = await load();
    five.fixture.setupScenario("behind", { weeks: 5, now: NOW });
    expect(five.repo.lastClosedWeekEnd()).toBe("2026-09-26");
    expect(five.cycle.runCycle(NOW).closedWeeks).toBe(5);
  });
});

describe("the scenario first-run", () => {
  it("looks like a database from before the weekly cycle: completed items with no history, and nothing closed yet", async () => {
    const { fixture, cycle, repo } = await load();

    fixture.setupScenario("first-run", { now: NOW });

    expect(repo.lastClosedWeekEnd()).toBeNull();
    expect(cycle.loadSetup(NOW)).toEqual({ pending: true, completed: 3 });
    expect(cycle.runCycle(NOW)).toMatchObject({ awaitingSetup: true, closedWeeks: 0 });
    expect(repo.listTodos().filter((t) => !t.done).map((t) => t.title)).toEqual(["Write the Q4 plan", "Call the bank"]);
  });
});

describe("the scenario first-run, answered and then aged", () => {
  it("after a no and a week that passes, archives the completed items at the close with no date, so no report counts them", async () => {
    const { fixture, cycle, repo } = await load();
    fixture.setupScenario("first-run", { now: NOW });
    cycle.finishSetup(false, NOW);
    expect(repo.listTodos()).toHaveLength(5);
    fixture.ageWeeks(1);

    const result = cycle.runCycle(NOW);

    expect(result.closedWeeks).toBe(1);
    const archived = repo.listArchivedTodos();
    expect(archived.map((t) => t.title).sort()).toEqual(["File expenses", "Reply to vendor", "Send invoice"]);
    expect(archived.every((t) => t.doneAt === undefined)).toBe(true);
    expect(repo.listTodoEvents().filter((e) => e.kind === "status_changed")).toEqual([]);
  });

  it("after a yes, files them under the weeks they were last changed in, with their dates", async () => {
    const { fixture, cycle, repo } = await load();
    fixture.setupScenario("first-run", { now: NOW });

    expect(cycle.finishSetup(true, NOW)).toBe(3);

    expect(repo.listArchivedTodos().map((t) => [t.title, t.archiveWeek, t.doneAt !== undefined])).toEqual([
      ["Reply to vendor", "2026-10-25", true],
      ["Send invoice", "2026-10-25", true],
      ["File expenses", "2026-10-11", true],
    ]);
  });
});

describe("the scenario archive", () => {
  it("has archived items of each kind, up to date, and a report that mentions the sensitive one", async () => {
    const { fixture, cycle, repo } = await load();

    fixture.setupScenario("archive", { now: NOW });

    expect(repo.listArchivedTodos().map((t) => [t.title, t.archiveReason])).toEqual(
      expect.arrayContaining([
        ["Prepare the salary talk", "done"],
        ["Plan trip", "removed"],
        ["Book flights", "removed"],
        ["Old idea", "dropped"],
      ]),
    );
    const salary = repo.listArchivedTodos().find((t) => t.title === "Prepare the salary talk")!;
    const preview = repo.previewDelete(salary.id);
    expect(preview.items).toBe(1);
    expect(preview.reports).toHaveLength(1);
    expect(preview.reports[0].title).toMatch(/^Weekly /);
    // Nothing is due, so launching the app changes nothing.
    expect(cycle.runCycle(NOW)).toEqual({ awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] });
  });
});

describe("the scenario retention", () => {
  it("has archived items of five ages, so lowering the window shows how many would go", async () => {
    const { fixture, repo } = await load();

    fixture.setupScenario("retention", { now: NOW });

    expect(repo.listArchivedTodos().map((t) => t.title)).toEqual([
      "Removed six months ago",
      "Removed eighteen months ago",
      "Removed three years ago",
      "Removed four and a half years ago",
      "Removed six years ago",
    ]);
    expect(repo.previewPurge(12, NOW)).toBe(4);
    expect(repo.previewPurge(24, NOW)).toBe(3);
    expect(repo.previewPurge(48, NOW)).toBe(2);
    expect(repo.previewPurge(null, NOW)).toBe(0);
  });

  it("is purged at launch of what is older than the five years that is the default", async () => {
    const { fixture, cycle, repo } = await load();
    fixture.setupScenario("retention", { now: NOW });

    expect(cycle.runCycle(NOW).purged).toBe(1);

    expect(repo.listArchivedTodos().map((t) => t.title)).not.toContain("Removed six years ago");
    expect(repo.listArchivedTodos()).toHaveLength(4);
  });
});

describe("starting with the window already set", () => {
  it("lets the first launch purge what a shorter window has run out on, since it purges only once a day", async () => {
    const { fixture, cycle, repo } = await load();

    fixture.setupScenario("retention", { now: NOW, keepMonths: 24 });

    expect(fixture.describeState().join("\n")).toContain("keep archived items for 24 months");
    expect(cycle.runCycle(NOW).purged).toBe(3);
    expect(repo.listArchivedTodos().map((t) => t.title)).toEqual(["Removed six months ago", "Removed eighteen months ago"]);
  });

  it("can keep everything, and refuses a window that is not one", async () => {
    const { fixture, cycle } = await load();

    fixture.setupScenario("retention", { now: NOW, keepMonths: null });

    expect(fixture.describeState().join("\n")).toContain("keep archived items forever");
    expect(cycle.runCycle(NOW).purged).toBe(0);
  });

  it("refuses a window that is not a number of months from 1 to 600", async () => {
    const { fixture } = await load();

    for (const keepMonths of [0, -3, 2.5, 601]) {
      expect(() => fixture.setupScenario("retention", { now: NOW, keepMonths })).toThrow(/months from 1 to 600/);
    }
  });
});

describe("age", () => {
  it("pretends weeks went by, so the next launch closes that many", async () => {
    const { fixture, cycle, repo } = await load();
    fixture.setupScenario("archive", { now: NOW });
    expect(repo.lastClosedWeekEnd()).toBe("2026-10-31");

    fixture.ageWeeks(2);

    expect(repo.lastClosedWeekEnd()).toBe("2026-10-17");
    expect(cycle.runCycle(NOW).closedWeeks).toBe(2);
  });

  it("refuses a number of weeks that is not a positive whole number", async () => {
    const { fixture } = await load();
    fixture.setupScenario("archive", { now: NOW });

    for (const weeks of [0, -1, 1.5, Number.NaN]) expect(() => fixture.ageWeeks(weeks)).toThrow(/whole number of weeks/);
  });
});

describe("setup", () => {
  it("refuses a database that already holds something, so a real one is never added to", async () => {
    const { fixture, repo } = await load();
    repo.addTodo("Mine", null, NOW);

    expect(() => fixture.setupScenario("behind", { now: NOW })).toThrow(/already has to-dos/);
    expect(repo.listTodos().map((t) => t.title)).toEqual(["Mine"]);
  });

  it("refuses a scenario it does not know", async () => {
    const { fixture } = await load();

    expect(() => fixture.setupScenario("nope" as never, { now: NOW })).toThrow(/scenario/);
  });
});

describe("describeState", () => {
  it("says what the database holds, in the words the app uses, so it can be compared with the screen", async () => {
    const { fixture, cycle } = await load();
    fixture.setupScenario("behind", { now: NOW });
    cycle.runCycle(NOW);

    const text = fixture.describeState().join("\n");

    expect(text).toContain("Weeks start on Sunday");
    expect(text).toContain("keep archived items for 60 months");
    expect(text).toContain("Closed through: week 2026-10-31 · month 2026-10-31 · quarter 2026-09-30");
    expect(text).toMatch(/Rolled over \(\d+\)/);
    expect(text).toContain("Write the Q4 plan · from the week of 2026-10-11, rolled 3 times");
    expect(text).toMatch(/This week \(\d+\)/);
    expect(text).toContain("Someday: learn Spanish");
    expect(text).toMatch(/Archive \(\d+\)/);
    expect(text).toContain("Reply to vendor · done · week of 2026-10-11");
    expect(text).toMatch(/Reports \(\d+\)/);
    expect(text).toContain("Monthly 2026-10");
  });
});
