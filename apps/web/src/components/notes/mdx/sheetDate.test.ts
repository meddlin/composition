import { describe, expect, it } from "vitest";
import { MAX_SERIAL, addMonths, dayOfWeek, endOfMonth, serialToYmd, ymdToSerial } from "./sheetDate";

describe("Excel's calendar", () => {
  it("counts 1 January 1900 as 1, and has the 29 February 1900 that never was", () => {
    expect(ymdToSerial(1900, 1, 1)).toBe(1);
    expect(ymdToSerial(1900, 2, 28)).toBe(59);
    expect(ymdToSerial(1900, 2, 29)).toBe(60);
    expect(ymdToSerial(1900, 3, 1)).toBe(61);
    expect(serialToYmd(60)).toEqual({ year: 1900, month: 2, day: 29 });
    expect(serialToYmd(61)).toEqual({ year: 1900, month: 3, day: 1 });
    expect(serialToYmd(0)).toEqual({ year: 1900, month: 1, day: 0 });
  });

  it("converts the dates of this century both ways", () => {
    expect(ymdToSerial(2026, 3, 4)).toBe(46085);
    expect(serialToYmd(46085)).toEqual({ year: 2026, month: 3, day: 4 });
    expect(serialToYmd(46085.9)).toEqual({ year: 2026, month: 3, day: 4 });
    expect(ymdToSerial(9999, 12, 31)).toBe(MAX_SERIAL);
    expect(serialToYmd(MAX_SERIAL)).toEqual({ year: 9999, month: 12, day: 31 });
  });

  it("lets the month and the day run over, and counts a year under 1900 from 1900", () => {
    expect(ymdToSerial(2026, 14, 1)).toBe(ymdToSerial(2027, 2, 1));
    expect(ymdToSerial(2026, 0, 1)).toBe(ymdToSerial(2025, 12, 1));
    expect(ymdToSerial(2026, 3, 0)).toBe(ymdToSerial(2026, 2, 28));
    expect(ymdToSerial(2026, 1, 45)).toBe(ymdToSerial(2026, 2, 14));
    expect(ymdToSerial(99, 1, 1)).toBe(ymdToSerial(1999, 1, 1));
    expect(ymdToSerial(1900, 1, 0)).toBe(0);
  });

  it("has no date before serial 0 or after 9999, or beyond a year that can be written", () => {
    expect(ymdToSerial(-1, 1, 1)).toBeNull();
    expect(ymdToSerial(10_000, 1, 1)).toBeNull();
    expect(ymdToSerial(1900, 0, 0)).toBeNull();
    expect(ymdToSerial(1900, 1, -1)).toBeNull();
    expect(serialToYmd(-1)).toBeNull();
    expect(serialToYmd(MAX_SERIAL + 1)).toBeNull();
    expect(endOfMonth(46085, 1e9)).toBeNull();
    expect(addMonths(46085, -1e9)).toBeNull();
  });

  it("finds the end of a month and the same day in another, in a leap year and the leap day of 1900", () => {
    expect(endOfMonth(46085, 0)).toBe(46112);
    expect(endOfMonth(ymdToSerial(2024, 2, 1) as number, 0)).toBe(ymdToSerial(2024, 2, 29));
    expect(endOfMonth(40, 0)).toBe(60);
    expect(addMonths(ymdToSerial(2026, 1, 31) as number, 1)).toBe(ymdToSerial(2026, 2, 28));
    expect(addMonths(46085, 12)).toBe(ymdToSerial(2027, 3, 4));
  });

  it("numbers the days of the week from a Sunday that is serial 1", () => {
    expect(dayOfWeek(1)).toBe(0);
    expect(dayOfWeek(0)).toBe(6);
    expect(dayOfWeek(46085)).toBe(3);
  });
});
