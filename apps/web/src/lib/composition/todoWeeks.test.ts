import { describe, expect, it } from "vitest";
import {
  fiscalQuarterOf,
  latestClosedMonth,
  latestClosedQuarter,
  latestClosedWeek,
  localDateOf,
  monthOf,
  monthsToClose,
  quartersToClose,
  weeksToClose,
  weekOf,
} from "./todoWeeks";

describe("monthsToClose", () => {
  it("closes a month on the first date after its last day", () => {
    expect(monthsToClose("2026-09-30", "2026-10-31")).toEqual([]);
    expect(monthsToClose("2026-09-30", "2026-11-01")).toEqual([{ start: "2026-10-01", end: "2026-10-31" }]);
  });

  it("closes every month that was missed, oldest first, across a year end", () => {
    expect(monthsToClose("2026-10-31", "2027-02-02")).toEqual([
      { start: "2026-11-01", end: "2026-11-30" },
      { start: "2026-12-01", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-01-31" },
    ]);
  });
});

describe("quartersToClose", () => {
  it("closes a quarter on the first date after its last day", () => {
    expect(quartersToClose("2026-09-30", "2026-12-31", 1)).toEqual([]);
    expect(quartersToClose("2026-09-30", "2027-01-02", 1)).toEqual([
      { start: "2026-10-01", end: "2026-12-31", fiscalYear: 2026, quarter: 4 },
    ]);
  });

  it("follows the fiscal year start", () => {
    expect(quartersToClose("2026-06-30", "2027-01-05", 10)).toEqual([
      { start: "2026-07-01", end: "2026-09-30", fiscalYear: 2026, quarter: 4 },
      { start: "2026-10-01", end: "2026-12-31", fiscalYear: 2027, quarter: 1 },
    ]);
  });
});

describe("monthOf", () => {
  it.each([
    ["2026-10-15", "2026-10-01", "2026-10-31"],
    ["2026-02-28", "2026-02-01", "2026-02-28"],
    ["2028-02-10", "2028-02-01", "2028-02-29"],
    ["2026-12-31", "2026-12-01", "2026-12-31"],
  ] as const)("finds the month of %s", (date, start, end) => {
    expect(monthOf(date)).toEqual({ start, end });
  });
});

describe("fiscalQuarterOf", () => {
  // [fiscal year starts in month, date, fiscal year (named by the year it ends in), quarter, first day, last day]
  it.each([
    [1, "2026-10-15", 2026, 4, "2026-10-01", "2026-12-31"],
    [1, "2026-01-01", 2026, 1, "2026-01-01", "2026-03-31"],
    [1, "2026-03-31", 2026, 1, "2026-01-01", "2026-03-31"],
    [1, "2026-04-01", 2026, 2, "2026-04-01", "2026-06-30"],
    [10, "2026-10-15", 2027, 1, "2026-10-01", "2026-12-31"],
    [10, "2026-09-30", 2026, 4, "2026-07-01", "2026-09-30"],
    [10, "2027-01-31", 2027, 2, "2027-01-01", "2027-03-31"],
    [4, "2026-02-10", 2026, 4, "2026-01-01", "2026-03-31"],
    [4, "2026-04-01", 2027, 1, "2026-04-01", "2026-06-30"],
    [12, "2027-01-20", 2027, 1, "2026-12-01", "2027-02-28"],
    [12, "2028-01-10", 2028, 1, "2027-12-01", "2028-02-29"],
  ] as const)("with a year starting in month %i, %s is in %i Q%i", (startMonth, date, fiscalYear, quarter, start, end) => {
    expect(fiscalQuarterOf(date, startMonth)).toEqual({ start, end, fiscalYear, quarter });
  });
});

describe("weeksToClose", () => {
  it("has nothing to close while the week is still on, its last day included", () => {
    expect(weeksToClose("2026-10-31", "2026-11-01", 0)).toEqual([]);
    expect(weeksToClose("2026-10-31", "2026-11-07", 0)).toEqual([]);
  });

  it("closes a week on the first date after its last day", () => {
    expect(weeksToClose("2026-10-24", "2026-11-01", 0)).toEqual([{ start: "2026-10-25", end: "2026-10-31" }]);
  });

  it("closes every week that was missed, oldest first", () => {
    expect(weeksToClose("2026-10-10", "2026-11-03", 0)).toEqual([
      { start: "2026-10-11", end: "2026-10-17" },
      { start: "2026-10-18", end: "2026-10-24" },
      { start: "2026-10-25", end: "2026-10-31" },
    ]);
  });

  it("starts the first week the day after the last closed one when the start day was changed", () => {
    // Closed through Saturday 31 Oct on a Sunday start; now weeks start on Monday, so 1 Nov is a one-day week.
    expect(weeksToClose("2026-10-31", "2026-11-12", 1)).toEqual([
      { start: "2026-11-01", end: "2026-11-01" },
      { start: "2026-11-02", end: "2026-11-08" },
    ]);
  });
});

describe("latestClosedWeek", () => {
  it("is the week before the one today is in", () => {
    expect(latestClosedWeek("2026-11-03", 0)).toEqual({ start: "2026-10-25", end: "2026-10-31" });
    expect(latestClosedWeek("2026-11-01", 0)).toEqual({ start: "2026-10-25", end: "2026-10-31" });
    expect(latestClosedWeek("2026-11-03", 1)).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });
});

describe("localDateOf", () => {
  it("is the date on the wall clock, not the date in UTC", () => {
    // Built from local parts, so it holds in whatever time zone the tests run in.
    expect(localDateOf(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31");
    expect(localDateOf(new Date(2026, 10, 1, 0, 5))).toBe("2026-11-01");
    expect(localDateOf(new Date(2027, 0, 1, 12, 0))).toBe("2027-01-01");
  });
});

describe("weekOf", () => {
  // [date, the day the week starts on (0 = Sunday), the week's first and last day]
  it.each([
    ["a midweek date, Sunday start", "2026-10-28", 0, "2026-10-25", "2026-10-31"],
    ["the first day of its week", "2026-10-25", 0, "2026-10-25", "2026-10-31"],
    ["the last day of its week", "2026-10-31", 0, "2026-10-25", "2026-10-31"],
    ["the same date, Monday start", "2026-10-28", 1, "2026-10-26", "2026-11-01"],
    ["the same date, Friday start", "2026-10-28", 5, "2026-10-23", "2026-10-29"],
    ["a week that crosses the new year", "2027-01-01", 0, "2026-12-27", "2027-01-02"],
    ["a week that holds a leap day", "2028-02-29", 0, "2028-02-27", "2028-03-04"],
  ] as const)("finds the week of %s", (_name, date, startDay, start, end) => {
    expect(weekOf(date, startDay)).toEqual({ start, end });
  });
});

describe("latestClosedMonth and latestClosedQuarter", () => {
  it("are the month and the quarter before the one the date is in", () => {
    expect(latestClosedMonth("2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(latestClosedMonth("2026-11-01")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(latestClosedMonth("2026-03-31")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(latestClosedQuarter("2026-11-02", 1)).toEqual({ start: "2026-07-01", end: "2026-09-30", fiscalYear: 2026, quarter: 3 });
  });

  it("cross the new year", () => {
    expect(latestClosedMonth("2027-01-05")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(latestClosedQuarter("2027-01-05", 1)).toEqual({ start: "2026-10-01", end: "2026-12-31", fiscalYear: 2026, quarter: 4 });
  });

  it("follow the month the fiscal year starts in", () => {
    // A fiscal year that starts in October is named by the year it ends in: October to December 2026 is 2027 Q1.
    expect(latestClosedQuarter("2026-11-02", 10)).toEqual({ start: "2026-07-01", end: "2026-09-30", fiscalYear: 2026, quarter: 4 });
    expect(latestClosedQuarter("2027-01-05", 10)).toEqual({ start: "2026-10-01", end: "2026-12-31", fiscalYear: 2027, quarter: 1 });
  });
});
