import { describe, expect, it } from "vitest";
import { DEFAULT_TODO_SETTINGS, parseTodoSettings, validateTodoSettings } from "./todoSettings";

describe("reading the to-do settings", () => {
  it("starts the week on Sunday, keeps archived items for 5 years, and starts the fiscal year in January", () => {
    expect(DEFAULT_TODO_SETTINGS).toEqual({ weekStartsOn: 0, retentionMonths: 60, fiscalYearStartMonth: 1 });
    expect(parseTodoSettings(undefined)).toEqual(DEFAULT_TODO_SETTINGS);
    expect(parseTodoSettings({})).toEqual(DEFAULT_TODO_SETTINGS);
    expect(parseTodoSettings("nonsense")).toEqual(DEFAULT_TODO_SETTINGS);
  });

  it("keeps what was saved", () => {
    expect(parseTodoSettings({ weekStartsOn: 1, retentionMonths: 18, fiscalYearStartMonth: 10 })).toEqual({
      weekStartsOn: 1,
      retentionMonths: 18,
      fiscalYearStartMonth: 10,
    });
  });

  it("keeps Keep forever (null), which is not the same as nothing saved", () => {
    expect(parseTodoSettings({ retentionMonths: null }).retentionMonths).toBeNull();
    expect(parseTodoSettings({}).retentionMonths).toBe(60);
  });

  it("repairs each bad value on its own, leaving the good ones", () => {
    const good = { weekStartsOn: 3, retentionMonths: 24, fiscalYearStartMonth: 7 };

    for (const weekStartsOn of [-1, 7, 1.5, "monday", NaN, undefined]) {
      expect(parseTodoSettings({ ...good, weekStartsOn })).toEqual({ ...good, weekStartsOn: 0 });
    }
    for (const retentionMonths of [0, -3, 2.5, "60", NaN, Infinity, 601, undefined]) {
      expect(parseTodoSettings({ ...good, retentionMonths })).toEqual({ ...good, retentionMonths: 60 });
    }
    for (const fiscalYearStartMonth of [0, 13, 4.5, "10", NaN, undefined]) {
      expect(parseTodoSettings({ ...good, fiscalYearStartMonth })).toEqual({ ...good, fiscalYearStartMonth: 1 });
    }
  });

  it("allows as little as 1 month and as much as 50 years", () => {
    expect(parseTodoSettings({ retentionMonths: 1 }).retentionMonths).toBe(1);
    expect(parseTodoSettings({ retentionMonths: 600 }).retentionMonths).toBe(600);
  });
});

describe("checking the to-do settings that come from the form", () => {
  it("accepts a complete, valid set, including Keep forever", () => {
    expect(validateTodoSettings({ weekStartsOn: 6, retentionMonths: 12, fiscalYearStartMonth: 4 })).toEqual({
      settings: { weekStartsOn: 6, retentionMonths: 12, fiscalYearStartMonth: 4 },
    });
    expect(validateTodoSettings({ weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 })).toEqual({
      settings: { weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 },
    });
  });

  it("refuses rather than repairs, saying which setting is wrong", () => {
    const good = { weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10 };

    expect(validateTodoSettings({ ...good, weekStartsOn: 7 })).toEqual({ error: "Pick the day the week starts on." });
    expect(validateTodoSettings({ ...good, retentionMonths: 0 })).toEqual({
      error: "Keep archived items for a whole number of months from 1 to 600, or choose Keep forever.",
    });
    expect(validateTodoSettings({ ...good, retentionMonths: 1.5 })).toHaveProperty("error");
    expect(validateTodoSettings({ ...good, fiscalYearStartMonth: 13 })).toEqual({ error: "Pick the month the fiscal year starts in." });
  });

  it("refuses a missing setting and anything that is not an object", () => {
    expect(validateTodoSettings({ weekStartsOn: 1, retentionMonths: 24 })).toHaveProperty("error");
    expect(validateTodoSettings({})).toHaveProperty("error");
    for (const value of [null, undefined, "x", 4, [1, 2, 3]]) expect(validateTodoSettings(value)).toHaveProperty("error");
  });

  it("returns only the three settings, dropping anything else sent along", () => {
    expect(validateTodoSettings({ weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10, extra: "x" })).toEqual({
      settings: { weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10 },
    });
  });
});
