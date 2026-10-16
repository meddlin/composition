import { describe, expect, it } from "vitest";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { UPDATE_METHODS } from "../../../web/src/lib/composition/updatesApi";
import { API_METHODS } from "./backend";
import { ATTACHMENT_VALIDATORS, BACKUP_VALIDATORS, InvalidArgumentsError, UPDATE_VALIDATORS, VALIDATORS } from "./validate";

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
    expect(VALIDATORS.placeNote([3, null, 5])).toEqual([3, null, 5]);
    expect(VALIDATORS.placeNote([3, 2, null])).toEqual([3, 2, null]);
    expect(VALIDATORS.placeGroup([4, null, 7])).toEqual([4, null, 7]);
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

  it("passes the Trash Can's ids through and takes no arguments to load it", () => {
    expect(VALIDATORS.restoreNote([3, "extra"])).toEqual([3]);
    expect(VALIDATORS.restoreGroup([4])).toEqual([4]);
    expect(VALIDATORS.permanentlyDeleteNote([5])).toEqual([5]);
    expect(VALIDATORS.permanentlyDeleteGroup([6])).toEqual([6]);
    expect(VALIDATORS.loadTrash(["surprise"])).toEqual([]);
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
    ["restoreNote", ["3"]],
    ["restoreGroup", [undefined]],
    ["permanentlyDeleteNote", [Number.NaN]],
    ["permanentlyDeleteGroup", [1.5]],
    ["moveNoteToGroup", [1, undefined]],
    ["moveNoteToGroup", [1, "7"]],
    ["createGroup", [{}, null]],
    ["moveGroup", ["4", null]],
    ["moveGroup", [4, undefined]],
    ["moveGroup", [4, "2"]],
    ["placeNote", [1, null, undefined]],
    ["placeNote", [1, null, "5"]],
    ["placeNote", ["1", null, null]],
    ["placeGroup", [4, undefined, null]],
    ["placeGroup", [4, null, 1.5]],
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

describe("ATTACHMENT_VALIDATORS", () => {
  it("has a validator for every attachment method, and no extras", () => {
    expect(Object.keys(ATTACHMENT_VALIDATORS).sort()).toEqual([...ATTACHMENT_METHODS].sort());
  });

  it("takes only an id, dropping anything else the renderer sends (such as a path)", () => {
    expect(ATTACHMENT_VALIDATORS.addAttachments([3, "/Users/me/.ssh/id_rsa"])).toEqual([3]);
    expect(ATTACHMENT_VALIDATORS.saveAttachmentCopy([9, "/tmp/out"])).toEqual([9]);
  });

  it.each([
    ["listAttachments", ["1"]],
    ["addAttachments", [undefined]],
    ["revealAttachment", [1.5]],
    ["saveAttachmentCopy", [{ id: 1 }]],
    ["removeAttachment", [Number.NaN]],
  ] as const)("rejects a bad id for %s", (method, args) => {
    expect(() => ATTACHMENT_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});

describe("BACKUP_VALIDATORS", () => {
  it("covers exactly the backup methods", () => {
    expect(Object.keys(BACKUP_VALIDATORS).sort()).toEqual([...BACKUP_METHODS].sort());
  });

  it("takes no arguments at all, so a page can't name a path", () => {
    expect(BACKUP_VALIDATORS.createBackup(["/etc/cron.d/evil"])).toEqual([]);
    expect(BACKUP_VALIDATORS.restoreBackup(["/tmp/x.tar.gz", 1])).toEqual([]);
  });
});

describe("UPDATE_VALIDATORS", () => {
  it("covers exactly the update methods", () => {
    expect(Object.keys(UPDATE_VALIDATORS).sort()).toEqual([...UPDATE_METHODS].sort());
  });

  it("takes no arguments except one boolean, so a page can't name a feed or a path", () => {
    expect(UPDATE_VALIDATORS.checkForUpdates(["https://evil.example/feed"])).toEqual([]);
    expect(UPDATE_VALIDATORS.downloadUpdate(["/tmp/x"])).toEqual([]);
    expect(UPDATE_VALIDATORS.installUpdate([{ file: "/tmp/x" }])).toEqual([]);
    expect(UPDATE_VALIDATORS.setAutoCheckUpdates([true, "extra"])).toEqual([true]);
    expect(UPDATE_VALIDATORS.setAllowPrerelease([false, "extra"])).toEqual([false]);
  });

  it.each([[[]], [["true"]], [[1]], [[null]]])("rejects %j for setAllowPrerelease", (args) => {
    expect(() => UPDATE_VALIDATORS.setAllowPrerelease(args)).toThrow(InvalidArgumentsError);
  });

  it.each([[[]], [["true"]], [[1]], [[null]]])("rejects %j for setAutoCheckUpdates", (args) => {
    expect(() => UPDATE_VALIDATORS.setAutoCheckUpdates(args)).toThrow(InvalidArgumentsError);
  });
});
