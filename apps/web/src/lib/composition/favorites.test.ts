import { describe, expect, it } from "vitest";
import { isFavorite, parseFavorites, removeFavorite, toggleFavorite } from "./favorites";

describe("toggleFavorite", () => {
  it("pins at the end, keeping the order things were pinned in", () => {
    const first = toggleFavorite([], "note", 3);
    expect(toggleFavorite(first, "group", 1)).toEqual([
      { type: "note", id: 3 },
      { type: "group", id: 1 },
    ]);
  });

  it("unpins an item that is already pinned", () => {
    const pinned = [
      { type: "group" as const, id: 1 },
      { type: "note" as const, id: 1 },
    ];
    expect(toggleFavorite(pinned, "group", 1)).toEqual([{ type: "note", id: 1 }]);
  });

  it("treats a group and a note with the same id as different items", () => {
    const pinned = toggleFavorite([], "group", 5);
    expect(isFavorite(pinned, "note", 5)).toBe(false);
    expect(isFavorite(pinned, "group", 5)).toBe(true);
  });
});

describe("removeFavorite", () => {
  it("leaves the list alone when the item isn't pinned", () => {
    const pinned = [{ type: "note" as const, id: 1 }];
    expect(removeFavorite(pinned, "note", 2)).toEqual(pinned);
  });
});

describe("parseFavorites", () => {
  it("keeps well-formed entries", () => {
    const value = [
      { type: "group", id: 2 },
      { type: "note", id: 7 },
    ];
    expect(parseFavorites(value)).toEqual(value);
  });

  it.each([undefined, null, "x", 3, {}])("returns an empty list for %s", (value) => {
    expect(parseFavorites(value)).toEqual([]);
  });

  it("drops malformed entries and duplicates, and strips extra fields", () => {
    expect(
      parseFavorites([
        null,
        "note",
        { type: "folder", id: 1 },
        { type: "note", id: "1" },
        { type: "note", id: 1.5 },
        { type: "note", id: 4, extra: true },
        { type: "note", id: 4 },
      ]),
    ).toEqual([{ type: "note", id: 4 }]);
  });
});
