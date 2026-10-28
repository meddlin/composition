import { describe, expect, it } from "vitest";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { TODO_METHODS } from "../../../web/src/lib/composition/todosApi";
import { PANELS_METHODS } from "../../../web/src/lib/composition/panelsApi";
import { ASSISTANT_METHODS } from "../../../web/src/lib/composition/assistantApi";
import { UPDATE_METHODS } from "../../../web/src/lib/composition/updatesApi";
import { WINDOW_METHODS } from "../../../web/src/lib/composition/windowApi";
import { API_METHODS } from "./backend";
import { ASSISTANT_VALIDATORS, ATTACHMENT_VALIDATORS, BACKUP_VALIDATORS, InvalidArgumentsError, PANELS_VALIDATORS, TODO_VALIDATORS, UPDATE_VALIDATORS, VALIDATORS, WINDOW_VALIDATORS } from "./validate";

describe("VALIDATORS", () => {
  it("has a validator for every method of the API, and no extras", () => {
    expect(Object.keys(VALIDATORS).sort()).toEqual([...API_METHODS].sort());
  });

  it("passes well-formed arguments through unchanged", () => {
    expect(VALIDATORS.saveNoteContent([3, "text"])).toEqual([3, "text"]);
    expect(VALIDATORS.moveNoteToGroup([3, null])).toEqual([3, null]);
    expect(VALIDATORS.createGroup(["Work", 2])).toEqual(["Work", 2]);
    const home = {
      layout: "strip",
      sections: [{ id: "pinned", visible: false }],
      recentCount: 6,
      density: "list",
      startup: "home",
      pinnedNotebooks: [2, 5],
      notebookColors: { "2": "success" },
      recentSort: "opened",
      recentNotebook: null,
      header: { show: false, title: "Hi" },
    };
    expect(VALIDATORS.saveHomeSettings([{ ...home, extra: 1 }])).toEqual([home]);
    const writing = {
      rulerEnabled: true,
      rulerColumn: 72,
      reflowEnabled: false,
      reflowColumn: 100,
      reflowKeepsTables: true,
      wordCountEnabled: true,
    };
    expect(VALIDATORS.saveWritingSettings([{ ...writing, extra: 1 }])).toEqual([writing]);
    expect(VALIDATORS.moveGroup([4, null])).toEqual([4, null]);
    expect(VALIDATORS.moveGroup([4, 2])).toEqual([4, 2]);
    expect(VALIDATORS.placeNote([3, null, 5])).toEqual([3, null, 5]);
    expect(VALIDATORS.placeNote([3, 2, null])).toEqual([3, 2, null]);
    expect(VALIDATORS.placeGroup([4, null, 7])).toEqual([4, null, 7]);
    expect(VALIDATORS.createGroup(["Work", null, 2])).toEqual(["Work", null, 2]);
    expect(VALIDATORS.createNote(["Untitled", null, 2])).toEqual(["Untitled", null, 2]);
    expect(VALIDATORS.createNotebook(["Home"])).toEqual(["Home"]);
    expect(VALIDATORS.renameNotebook([2, "Work"])).toEqual([2, "Work"]);
    expect(VALIDATORS.deleteNotebook([2])).toEqual([2]);
    expect(VALIDATORS.moveGroupToNotebook([4, 2])).toEqual([4, 2]);
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

  it("keeps only the address and context size of the AI helper's settings", () => {
    expect(
      VALIDATORS.saveAssistantSettings([{ serverUrl: "http://nas:11434", contextTokens: 8192, extra: true }]),
    ).toEqual([{ serverUrl: "http://nas:11434", contextTokens: 8192 }]);
  });

  it("takes no arguments to list the AI helper's models, so the renderer cannot point it at an address", () => {
    expect(VALIDATORS.listAssistantModels(["http://169.254.169.254/latest/meta-data/"])).toEqual([]);
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
    ["createGroup", ["Work", null, "2"]],
    ["createNotebook", [undefined]],
    ["renameNotebook", ["2", "Work"]],
    ["renameNotebook", [2, 5]],
    ["deleteNotebook", [null]],
    ["moveGroupToNotebook", [4, null]],
    ["moveGroupToNotebook", ["4", 2]],
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
    ["savePreviewFont", [{}]],
    ["saveEditorFont", [{}]],
    ["saveNoteBackground", [{}]],
    ["saveWritingSettings", [null]],
    ["saveWritingSettings", [{}]],
    ["saveWritingSettings", [{ rulerEnabled: true, rulerColumn: 80, reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true }]],
    ["saveWritingSettings", [{ rulerEnabled: "yes", rulerColumn: 80, reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true, wordCountEnabled: false }]],
    ["saveWritingSettings", [{ rulerEnabled: true, rulerColumn: "80", reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true, wordCountEnabled: false }]],
    ["saveHomeSettings", [null]],
    ["saveHomeSettings", [{ layout: 1 }]],
    ["saveHomeSettings", [{ layout: "rail", sections: "all", recentCount: 12, density: "standard", startup: "note" }]],
    ["saveHomeSettings", [{ layout: "rail", sections: [null], recentCount: 12, density: "standard", startup: "note" }]],
    ["saveHomeSettings", [{ layout: "rail", sections: [{ id: "recent", visible: "yes" }], recentCount: 12, density: "standard", startup: "note" }]],
    ["saveHomeSettings", [{ layout: "rail", sections: [], recentCount: "12", density: "standard", startup: "note" }]],
    ["saveHomeSettings", [{ layout: "rail", sections: [], recentCount: 12, density: 1, startup: "note" }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, pinnedNotebooks: "all" }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, pinnedNotebooks: ["1"] }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, notebookColors: ["brand"] }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, notebookColors: { "1": 3 } }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, recentSort: 1 }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, recentNotebook: "1" }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, header: null }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, header: { show: "yes", title: "" } }]],
    ["saveHomeSettings", [{ ...{ layout: "rail", sections: [], recentCount: 12, density: "standard", startup: "note", pinnedNotebooks: [], notebookColors: {}, recentSort: "edited", recentNotebook: null, header: { show: true, title: "" } }, header: { show: true, title: 4 } }]],
    ["saveAssistantSettings", [null]],
    ["saveAssistantSettings", ["http://nas:11434"]],
    ["saveAssistantSettings", [{ serverUrl: 11434, contextTokens: 8192 }]],
    ["saveAssistantSettings", [{ serverUrl: "", contextTokens: "8192" }]],
    ["saveAssistantSettings", [{ serverUrl: "", contextTokens: Number.NaN }]],
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

describe("PANELS_VALIDATORS", () => {
  it("has a validator for every method of the panels API, and no extras", () => {
    expect(Object.keys(PANELS_VALIDATORS).sort()).toEqual([...PANELS_METHODS].sort());
  });

  it("loads the arrangement without taking anything from the page", () => {
    expect(PANELS_VALIDATORS.loadPanels(["/etc/passwd"])).toEqual([]);
  });

  it("passes a saved arrangement through whole", () => {
    const saved = { version: 1, windows: { main: { layout: { type: "panel", id: "p1" }, panels: {} } } };
    expect(PANELS_VALIDATORS.savePanels([saved, "extra"])).toEqual([saved]);
  });

  it.each([[undefined], [null], ["panels"], [7], [["a"]]])("refuses %j as an arrangement to save", (value) => {
    expect(() => PANELS_VALIDATORS.savePanels([value])).toThrow(InvalidArgumentsError);
  });

  it("refuses an arrangement too large to be one", () => {
    expect(() => PANELS_VALIDATORS.savePanels([{ junk: "x".repeat(300_000) }])).toThrow(InvalidArgumentsError);
  });

  it("takes whole numbers to look up in the Trash Can, and not many of them", () => {
    expect(PANELS_VALIDATORS.loadTrashedNotes([[1, 2, 3], "extra"])).toEqual([[1, 2, 3]]);
    expect(PANELS_VALIDATORS.loadTrashedNotes([[]])).toEqual([[]]);
    for (const bad of [undefined, "1", [1.5], ["1"], [null], Array.from({ length: 101 }, (_, i) => i)]) {
      expect(() => PANELS_VALIDATORS.loadTrashedNotes([bad]), JSON.stringify(bad)?.slice(0, 20)).toThrow(InvalidArgumentsError);
    }
  });
});

describe("WINDOW_VALIDATORS", () => {
  it("has exactly one validator per window method", () => {
    expect(Object.keys(WINDOW_VALIDATORS).sort()).toEqual([...WINDOW_METHODS].sort());
  });

  it("passes only the boolean on", () => {
    expect(WINDOW_VALIDATORS.getWindowTranslucency(["extra"])).toEqual([]);
    expect(WINDOW_VALIDATORS.setWindowTranslucency([false, "extra"])).toEqual([false]);
  });

  it.each([[[]], [["yes"]], [[1]], [[null]]])("refuses %j", (args) => {
    expect(() => WINDOW_VALIDATORS.setWindowTranslucency(args)).toThrow(InvalidArgumentsError);
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

describe("ASSISTANT_VALIDATORS", () => {
  const request = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };

  it("has a validator for every AI helper method, and no extras", () => {
    expect(Object.keys(ASSISTANT_VALIDATORS).sort()).toEqual([...ASSISTANT_METHODS].sort());
  });

  it("passes a well-formed turn through, keeping only the known fields, and drops extra arguments", () => {
    expect(
      ASSISTANT_VALIDATORS.assistantChat(["req-1", { ...request, extra: 1, messages: [{ role: "user", content: "hi", x: 1 }] }, "http://evil/"]),
    ).toEqual(["req-1", request]);
    expect(ASSISTANT_VALIDATORS.assistantAbort(["req-1", "extra"])).toEqual(["req-1"]);
  });

  it.each([
    ["assistantChat", [undefined, request]],
    ["assistantChat", ["", request]],
    ["assistantChat", ["has spaces", request]],
    ["assistantChat", ["x".repeat(65), request]],
    ["assistantChat", ["req-1", null]],
    ["assistantChat", ["req-1", { ...request, messages: [] }]],
    ["assistantChat", ["req-1", { ...request, numCtx: 3 }]],
    ["assistantChat", ["req-1", { ...request, model: "gpt-oss:20b:cloud" }]],
    ["assistantAbort", [5]],
    ["assistantAbort", ["../x"]],
  ] as const)("rejects %s(%j)", (method, args) => {
    expect(() => ASSISTANT_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});

describe("TODO_VALIDATORS", () => {
  it("has a validator for every method of the to-do API, and no extras", () => {
    expect(Object.keys(TODO_VALIDATORS).sort()).toEqual([...TODO_METHODS].sort());
  });

  it("reads the look without taking anything from the page", () => {
    expect(TODO_VALIDATORS.loadTodoLook(["/etc/passwd"])).toEqual([]);
  });

  it("passes on a look rebuilt from its two fields, and nothing else the page sent", () => {
    expect(TODO_VALIDATORS.saveTodoLook([{ background: "dots", color: "#14202b", extra: "x" }, "extra"])).toEqual([
      { background: "dots", color: "#14202b" },
    ]);
    expect(TODO_VALIDATORS.saveTodoLook([{ background: "notes", color: null }])).toEqual([{ background: "notes", color: null }]);
  });

  it.each([[undefined], [null], ["dots"], [{ background: "paisley", color: null }], [{ background: "grid", color: "red" }], [{ background: "grid" }]])(
    "refuses %j as a look to save",
    (value) => {
      expect(() => TODO_VALIDATORS.saveTodoLook([value])).toThrow(InvalidArgumentsError);
    },
  );

  it("lists the items without taking anything from the page", () => {
    expect(TODO_VALIDATORS.listTodos(["/etc/passwd"])).toEqual([]);
  });

  it("passes on exactly the arguments each method takes", () => {
    expect(TODO_VALIDATORS.createTodo(["Buy milk", null, "extra"])).toEqual(["Buy milk", null]);
    expect(TODO_VALIDATORS.createTodo(["Oat milk", 3])).toEqual(["Oat milk", 3]);
    expect(TODO_VALIDATORS.renameTodo([4, "Buy oat milk"])).toEqual([4, "Buy oat milk"]);
    expect(TODO_VALIDATORS.setTodoDone([4, true])).toEqual([4, true]);
    expect(TODO_VALIDATORS.deleteTodo([4, "extra"])).toEqual([4]);
  });

  it.each([
    ["createTodo", [7, null]],
    ["createTodo", ["x", undefined]],
    ["createTodo", ["x", "1"]],
    ["createTodo", ["x".repeat(5000), null]],
    ["renameTodo", ["4", "x"]],
    ["renameTodo", [4, null]],
    ["setTodoDone", [4, "true"]],
    ["setTodoDone", [1.5, true]],
    ["deleteTodo", [null]],
  ] as const)("refuses %s with %j", (method, args) => {
    expect(() => TODO_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});
