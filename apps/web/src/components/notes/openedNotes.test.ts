// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { parseOpened, readOpenedRaw, recordOpened } from "./openedNotes";

afterEach(() => window.localStorage.clear());

describe("parseOpened", () => {
  it("reads note ids and times, and drops anything else", () => {
    expect(parseOpened('{"3": 100, "x": 5, "4": "late", "-1": 2, "5": 7}')).toEqual({ 3: 100, 5: 7 });
  });

  it("copes with nothing, with junk, and with the wrong shape", () => {
    expect(parseOpened(null)).toEqual({});
    expect(parseOpened("")).toEqual({});
    expect(parseOpened("{not json")).toEqual({});
    expect(parseOpened("[1, 2]")).toEqual({});
  });
});

describe("recordOpened", () => {
  it("remembers when each note was opened, newest opening winning", () => {
    recordOpened(1, 100);
    recordOpened(2, 200);
    recordOpened(1, 300);

    expect(parseOpened(readOpenedRaw())).toEqual({ 1: 300, 2: 200 });
  });

  it("forgets the oldest once there are too many", () => {
    for (let id = 1; id <= 105; id++) recordOpened(id, id);

    const opened = parseOpened(readOpenedRaw());
    expect(Object.keys(opened)).toHaveLength(100);
    expect(opened[1]).toBeUndefined();
    expect(opened[105]).toBe(105);
  });
});
