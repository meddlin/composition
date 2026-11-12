import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUN_HOURS,
  formatClock,
  goRoundTheClock,
  parseClock,
  parseSunHours,
  SUN_HOURS_FORMAT_ERROR,
  SUN_HOURS_ORDER_ERROR,
  validateSunHours,
} from "./sunHours";

const hours = (lightenFrom: string, lightFrom: string, darkenFrom: string, darkFrom: string) => ({ lightenFrom, lightFrom, darkenFrom, darkFrom });

describe("the clock text", () => {
  it("reads HH:MM on a 24-hour clock and nothing else", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("07:15")).toBe(435);
    expect(parseClock("23:59")).toBe(1439);
    for (const bad of ["24:00", "7:15", "07:60", "07:15:30", " 07:15", "0715", "", "noon", null, 7, undefined]) expect(parseClock(bad), String(bad)).toBeUndefined();
  });

  it("writes minutes back as zero-padded HH:MM", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(435)).toBe("07:15");
    expect(formatClock(1439)).toBe("23:59");
    expect(formatClock(1440 + 5)).toBe("00:05");
  });
});

describe("whether the hours go once round the clock in order", () => {
  it("accepts the defaults and any starting point", () => {
    expect(goRoundTheClock([345, 435, 1065, 1155])).toBe(true);
    expect(goRoundTheClock([1140, 1200, 300, 360])).toBe(true); // 19:00, 20:00, 05:00, 06:00
    expect(goRoundTheClock([0, 1, 2, 3])).toBe(true);
    expect(goRoundTheClock([1437, 1438, 1439, 0])).toBe(true);
  });

  it("refuses two of the same time, or a step less than a minute after the one before", () => {
    expect(goRoundTheClock([345, 345, 1065, 1155])).toBe(false);
    expect(goRoundTheClock([345, 435, 1065, 345])).toBe(false);
  });

  it("refuses hours that go round the clock twice, or backwards", () => {
    expect(goRoundTheClock([600, 300, 1000, 1100])).toBe(false);
    expect(goRoundTheClock([345, 435, 1155, 1065])).toBe(false);
    expect(goRoundTheClock([1155, 1065, 435, 345])).toBe(false);
  });
});

describe("validateSunHours", () => {
  it("returns the hours as normal HH:MM text", () => {
    expect(validateSunHours(DEFAULT_SUN_HOURS)).toEqual({ hours: DEFAULT_SUN_HOURS });
    expect(validateSunHours({ ...hours("06:00", "07:00", "18:30", "20:00"), extra: 1 })).toEqual({ hours: hours("06:00", "07:00", "18:30", "20:00") });
  });

  it("says why it refuses", () => {
    expect(validateSunHours(hours("6:00", "07:00", "18:30", "20:00"))).toEqual({ error: SUN_HOURS_FORMAT_ERROR });
    expect(validateSunHours({ lightenFrom: "06:00" })).toEqual({ error: SUN_HOURS_FORMAT_ERROR });
    expect(validateSunHours(null)).toEqual({ error: SUN_HOURS_FORMAT_ERROR });
    expect(validateSunHours([])).toEqual({ error: SUN_HOURS_FORMAT_ERROR });
    expect(validateSunHours(hours("08:00", "07:00", "18:30", "20:00"))).toEqual({ error: SUN_HOURS_ORDER_ERROR });
  });
});

describe("parseSunHours (what a settings file comes to)", () => {
  it("keeps a good set and reads anything else as the defaults, all or nothing", () => {
    expect(parseSunHours(hours("06:00", "07:00", "18:30", "20:00"))).toEqual(hours("06:00", "07:00", "18:30", "20:00"));
    expect(parseSunHours(undefined)).toEqual(DEFAULT_SUN_HOURS);
    expect(parseSunHours("05:45")).toEqual(DEFAULT_SUN_HOURS);
    expect(parseSunHours({ ...hours("06:00", "07:00", "18:30", "20:00"), darkFrom: "late" })).toEqual(DEFAULT_SUN_HOURS);
    expect(parseSunHours(hours("08:00", "07:00", "18:30", "20:00"))).toEqual(DEFAULT_SUN_HOURS);
  });
});
