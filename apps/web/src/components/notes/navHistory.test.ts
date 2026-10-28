import { describe, expect, it } from "vitest";
import {
  EMPTY_NAV_HISTORY,
  MAX_NAV_ENTRIES,
  back,
  forward,
  record,
  sameLocation,
  type NavHistory,
  type NavLocation,
} from "./navHistory";

const note = (id: number): NavLocation => ({ kind: "note", id });
const group = (id: number): NavLocation => ({ kind: "group", id });
const home: NavLocation = { kind: "home" };
const always = () => true;

/** A history that visited each location in turn, ending on the last. */
function visited(...locations: NavLocation[]): NavHistory {
  return locations.reduce(record, EMPTY_NAV_HISTORY);
}

describe("sameLocation", () => {
  it("compares kind and id", () => {
    expect(sameLocation(note(1), note(1))).toBe(true);
    expect(sameLocation(note(1), note(2))).toBe(false);
    expect(sameLocation(note(1), group(1))).toBe(false);
    expect(sameLocation(home, home)).toBe(true);
    expect(sameLocation(home, note(1))).toBe(false);
  });
});

describe("record", () => {
  it("starts the history at the first location", () => {
    expect(record(EMPTY_NAV_HISTORY, note(1))).toEqual({ entries: [note(1)], cursor: 0 });
  });

  it("adds each new location after the last", () => {
    expect(visited(note(1), note(2), home)).toEqual({ entries: [note(1), note(2), home], cursor: 2 });
  });

  it("ignores the place the history already points at", () => {
    const h = visited(note(1), note(2));
    expect(record(h, note(2))).toBe(h);
  });

  it("does not collapse a return to an earlier place", () => {
    expect(visited(note(1), note(2), note(1)).entries).toEqual([note(1), note(2), note(1)]);
  });

  it("drops what was ahead after going back and somewhere new", () => {
    const stepped = back(visited(note(1), note(2), note(3)), always)!.history;
    expect(record(stepped, note(4))).toEqual({ entries: [note(1), note(2), note(4)], cursor: 2 });
  });

  it("forgets the oldest entries past the cap", () => {
    let h = EMPTY_NAV_HISTORY;
    for (let id = 1; id <= MAX_NAV_ENTRIES + 5; id++) h = record(h, note(id));

    expect(h.entries).toHaveLength(MAX_NAV_ENTRIES);
    expect(h.entries[0]).toEqual(note(6));
    expect(h.entries[h.cursor]).toEqual(note(MAX_NAV_ENTRIES + 5));
  });
});

describe("back and forward", () => {
  it("step to the previous and next entry", () => {
    const toTwo = back(visited(note(1), note(2), note(3)), always)!;
    expect(toTwo.location).toEqual(note(2));
    expect(toTwo.history.cursor).toBe(1);

    const toThree = forward(toTwo.history, always)!;
    expect(toThree.location).toEqual(note(3));
    expect(toThree.history.cursor).toBe(2);
  });

  it("stay put at either end", () => {
    expect(back(EMPTY_NAV_HISTORY, always)).toBeNull();
    expect(back(visited(note(1)), always)).toBeNull();
    expect(forward(visited(note(1), note(2)), always)).toBeNull();
  });

  it("pass over entries that are gone, and keep them", () => {
    const h = visited(note(1), note(2), note(3));
    const gone = (l: NavLocation) => !sameLocation(l, note(2));

    const toOne = back(h, gone)!;
    expect(toOne.location).toEqual(note(1));
    expect(toOne.history.entries).toEqual(h.entries);
    expect(forward(toOne.history, gone)!.location).toEqual(note(3));
  });

  it("stay put when nothing before is left to show", () => {
    const h = visited(note(1), note(2));
    expect(back(h, (l) => sameLocation(l, note(2)))).toBeNull();
  });

  it("make the place stepped to the one recorded next, so it is not added again", () => {
    const { history, location } = back(visited(note(1), note(2)), always)!;
    expect(record(history, location)).toBe(history);
  });
});
