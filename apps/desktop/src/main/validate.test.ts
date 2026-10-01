import { describe, expect, it } from "vitest";
import { API_METHODS } from "./backend";
import { InvalidArgumentsError, VALIDATORS } from "./validate";

describe("VALIDATORS", () => {
  it("has a validator for every method of the API, and no extras", () => {
    expect(Object.keys(VALIDATORS).sort()).toEqual([...API_METHODS].sort());
  });

  it("passes well-formed arguments through unchanged", () => {
    expect(VALIDATORS.saveNoteContent([3, "text"])).toEqual([3, "text"]);
    expect(VALIDATORS.moveNoteToGroup([3, null])).toEqual([3, null]);
    expect(VALIDATORS.createGroup(["Work", 2])).toEqual(["Work", 2]);
    expect(VALIDATORS.moveGroup([4, null])).toEqual([4, null]);
    expect(VALIDATORS.moveGroup([4, 2])).toEqual([4, 2]);
  });

  it("passes a pasted image's bytes through and keeps only the known fields", () => {
    const data = Uint8Array.from([1, 2, 3]);
    expect(VALIDATORS.saveImage([{ noteId: 3, fileName: "a.png", data, extra: true }])).toEqual([
      { noteId: 3, fileName: "a.png", data },
    ]);
  });

  it("defaults createNote's group to null when omitted", () => {
    expect(VALIDATORS.createNote(["Untitled"])).toEqual(["Untitled", null]);
    expect(VALIDATORS.createNote(["Untitled", 4])).toEqual(["Untitled", 4]);
  });

  it("keeps only the known fields of each favorite", () => {
    expect(VALIDATORS.saveFavorites([[{ type: "note", id: 3, extra: 1 }, { type: "group", id: 1 }]])).toEqual([
      [
        { type: "note", id: 3 },
        { type: "group", id: 1 },
      ],
    ]);
  });

  it("drops arguments the method doesn't take", () => {
    expect(VALIDATORS.deleteNote([5, "extra", {}])).toEqual([5]);
    expect(VALIDATORS.loadWorkspace(["surprise"])).toEqual([]);
  });

  it("keeps only the known fields of object arguments", () => {
    expect(
      VALIDATORS.saveLayout([{ sidebarWidth: 300, editorRatio: 0.4, __proto__: { x: 1 }, extra: true }]),
    ).toEqual([{ sidebarWidth: 300, editorRatio: 0.4 }]);
    expect(VALIDATORS.saveSettings([{ appDataDir: "/a", dbPath: "", other: 1 }])).toEqual([
      { appDataDir: "/a", dbPath: "" },
    ]);
  });

  it.each([
    ["saveNoteContent", ["1", "text"]],
    ["saveNoteContent", [1.5, "text"]],
    ["saveNoteContent", [1, 42]],
    ["deleteNote", [Number.NaN]],
    ["deleteNote", [undefined]],
    ["moveNoteToGroup", [1, undefined]],
    ["moveNoteToGroup", [1, "7"]],
    ["createGroup", [{}, null]],
    ["moveGroup", ["4", null]],
    ["moveGroup", [4, undefined]],
    ["moveGroup", [4, "2"]],
    ["searchNotes", [null]],
    ["saveLayout", [null]],
    ["saveLayout", [[1, 2]]],
    ["saveLayout", [{ sidebarWidth: "wide", editorRatio: 0.5 }]],
    ["saveLayout", [{ sidebarWidth: Number.POSITIVE_INFINITY, editorRatio: 0.5 }]],
    ["saveFavorites", [null]],
    ["saveFavorites", [{ type: "note", id: 1 }]],
    ["saveFavorites", [[null]]],
    ["saveFavorites", [[{ type: "folder", id: 1 }]]],
    ["saveFavorites", [[{ type: "note", id: "1" }]]],
    ["saveSettings", [{ appDataDir: 1, dbPath: "" }]],
    ["saveSettings", ["nope"]],
    ["saveTheme", [{}]],
    ["saveImage", [null]],
    ["saveImage", [{ noteId: "3", fileName: "a.png", data: new Uint8Array(1) }]],
    ["saveImage", [{ noteId: 3, fileName: 1, data: new Uint8Array(1) }]],
    ["saveImage", [{ noteId: 3, fileName: "a.png", data: "bytes" }]],
    ["saveImage", [{ noteId: 3, fileName: "a.png", data: [1, 2, 3] }]],
  ] as const)("rejects %s(%j)", (method, args) => {
    expect(() => VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});
