import { describe, expect, it } from "vitest";
import {
  ERR,
  Unsupported,
  compareScalars,
  compareText,
  logicalText,
  numberToText,
  parseLiteral,
  parseNumberText,
  round15,
  roundDigits,
  snapToZero,
  toBool,
  toNumber,
  toText,
} from "./sheetValue";

describe("parseLiteral", () => {
  it("keeps 15 significant digits and drops the rest, as Excel reads a number it is given", () => {
    expect(parseLiteral("1.000000000000001")).toBe(1);
    expect(parseLiteral("0.1234567890123456789")).toBe(0.123456789012345);
    expect(parseLiteral("12345678901234567890")).toBe(12345678901234500000);
    expect(parseLiteral("1234.5")).toBe(1234.5);
    expect(parseLiteral("5.")).toBe(5);
    expect(parseLiteral("1e400")).toBe(Infinity);
    expect(parseLiteral("1.23456789012345678e5")).toBe(123456.789012345);
  });
});

describe("numberToText", () => {
  it("writes up to 15 digits in full, and in E notation past 20 characters", () => {
    expect(numberToText(0)).toBe("0");
    expect(numberToText(-0)).toBe("0");
    expect(numberToText(1 / 3)).toBe("0.333333333333333");
    expect(numberToText(1e19)).toBe("10000000000000000000");
    expect(numberToText(1e20)).toBe("1E+20");
    expect(numberToText(1e-18)).toBe("0.000000000000000001");
    expect(numberToText(1.5e-18)).toBe("1.5E-18");
    expect(numberToText(1e-19)).toBe("1E-19");
    expect(numberToText(1.23456789012345e-5)).toBe("1.23456789012345E-05");
    expect(numberToText(-1e300)).toBe("-1E+300");
    expect(numberToText(0.1 + 0.2)).toBe("0.3");
    expect(numberToText(1234567890123456)).toBe("1234567890123460");
  });
});

describe("parseNumberText", () => {
  it("reads what Excel reads in arithmetic, with the shapes it does and does not allow", () => {
    expect(parseNumberText(" 5 ")).toBe(5);
    expect(parseNumberText("- 5")).toBe(-5);
    expect(parseNumberText("$ -5")).toBe(-5);
    expect(parseNumberText("-$5")).toBe(-5);
    expect(parseNumberText("(1,234)")).toBe(-1234);
    expect(parseNumberText("1,234.5%")).toBe(12.345);
    expect(parseNumberText("%5")).toBe(0.05);
    expect(parseNumberText("1e-2")).toBe(0.01);
    expect(parseNumberText(".5")).toBe(0.5);
    expect(parseNumberText("1234,567")).toBe(1234567);
    for (const text of ["", "  ", "abc", "5-", "+-5", "--5", "1 2", "0x10", "5%%", "1,23", "12,34,567", ",5", "1e", "1e400", "5$", "(-5)", "(5"]) {
      expect(parseNumberText(text), text).toBeNull();
    }
  });

  it("does not guess at a text Excel would read as a date or a currency of another country", () => {
    for (const text of ["1/2/2026", "4-Mar-2026", "Mar 4, 2026", "10:30", "€5", "£5"]) {
      expect(() => parseNumberText(text), text).toThrow(Unsupported);
    }
  });

  it("reads a date written 2026-03-04 as that date, and one that is not a day as no number, as Excel does (both checked in it)", () => {
    expect(parseNumberText("2026-03-04")).toBe(46085);
    expect(parseNumberText(" 2026-3-4 ")).toBe(46085);
    expect(parseNumberText("1900-02-29")).toBe(60);
    for (const text of ["2026-02-30", "1899-12-31", "2026-13-01"]) expect(parseNumberText(text), text).toBeNull();
  });
});

describe("conversions", () => {
  it("reads a blank as 0 or nothing, a logical as 1 or 0 or its name, and throws the error an error is", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(true)).toBe(1);
    expect(toNumber("5%")).toBe(0.05);
    expect(() => toNumber("a")).toThrow(ERR.VALUE);
    expect(() => toNumber(ERR.NA)).toThrow(ERR.NA);
    expect(toText(null)).toBe("");
    expect(toText(false)).toBe("FALSE");
    expect(toText(0.5)).toBe("0.5");
    expect(() => toText(ERR.REF)).toThrow(ERR.REF);
  });

  it("reads a condition as Excel does: a number is true unless 0, and the words TRUE and FALSE are logicals in any case", () => {
    expect(toBool(2)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toBool("true")).toBe(true);
    expect(toBool("False")).toBe(false);
    expect(() => toBool("yes")).toThrow(ERR.VALUE);
    expect(logicalText("TrUe")).toBe(true);
    expect(logicalText("1")).toBeUndefined();
  });
});

describe("compareScalars", () => {
  it("puts numbers before text before logicals, and compares a blank as the other side's kind", () => {
    expect(compareScalars(1, "a")).toBe(-1);
    expect(compareScalars("a", true)).toBe(-1);
    expect(compareScalars(true, 5)).toBe(1);
    expect(compareScalars(null, 0)).toBe(0);
    expect(compareScalars(null, "")).toBe(0);
    expect(compareScalars(null, false)).toBe(0);
    expect(compareScalars(null, 1)).toBe(-1);
    expect(compareScalars(null, "a")).toBe(-1);
    expect(compareScalars(null, null)).toBe(0);
  });

  it("calls numbers equal when their first 15 digits are, and texts equal when they differ only in case", () => {
    expect(compareScalars(1 + 1e-15, 1)).toBe(0);
    expect(compareScalars(1 + 1e-14, 1)).toBe(1);
    expect(compareScalars("Apple", "aPPLE")).toBe(0);
    expect(compareText("straße", "STRASSE")).toBe(0);
    expect(compareText("é", "e")).not.toBe(0);
  });

  it("sorts punctuation before digits before letters, as Excel does", () => {
    expect(compareText("_", "1")).toBeLessThan(0);
    expect(compareText("$", "a")).toBeLessThan(0);
    expect(compareText("1", "a")).toBeLessThan(0);
    expect(compareText("a10", "a2")).toBeLessThan(0);
  });

  it("throws an error rather than ordering it", () => {
    expect(() => compareScalars(ERR.NA, 1)).toThrow(ERR.NA);
  });
});

describe("rounding", () => {
  it("rounds half away from zero on the 15 digits, which is how 1.005 becomes 1.01", () => {
    expect(roundDigits(1.005, 2)).toBe(1.01);
    expect(roundDigits(2.675, 2)).toBe(2.68);
    expect(roundDigits(-2.5, 0)).toBe(-3);
    expect(roundDigits(1234.5678, -2)).toBe(1200);
    expect(roundDigits(0.4, 0)).toBe(0);
    expect(Object.is(roundDigits(-0.4, 0), 0)).toBe(true);
    expect(roundDigits(1.5, 400)).toBe(1.5);
    expect(roundDigits(1234, -400)).toBe(0);
  });

  it("rounds away from zero or toward it when asked", () => {
    expect(roundDigits(2.1, 0, "up")).toBe(3);
    expect(roundDigits(-2.1, 0, "up")).toBe(-3);
    expect(roundDigits(2.9, 0, "down")).toBe(2);
    expect(roundDigits(-2.9, 0, "down")).toBe(-2);
    expect(roundDigits(1.001, 2, "up")).toBe(1.01);
    expect(roundDigits(1.239, 2, "down")).toBe(1.23);
  });

  it("cuts a number to 15 digits for comparing", () => {
    expect(round15(0.1 + 0.2)).toBe(0.3);
    expect(round15(Infinity)).toBe(Infinity);
  });
});

describe("snapToZero", () => {
  it("is zero when the result is no more than rounding noise beside the operands, and not otherwise", () => {
    expect(snapToZero(0.1 + 0.2, 0.3, 0.1 + 0.2 - 0.3)).toBe(0);
    expect(snapToZero(1 + 2 ** -50, 1, 2 ** -50)).toBe(0);
    expect(snapToZero(1 + 2 ** -49, 1, 2 ** -49)).toBe(2 ** -49);
    expect(snapToZero(100.1, 100, 100.1 - 100)).toBe(100.1 - 100);
    expect(snapToZero(5.55e-17, 0, 5.55e-17)).toBe(5.55e-17);
  });
});
