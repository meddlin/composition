import { describe, expect, it } from "vitest";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { DOCUMENT_METHODS } from "../../../web/src/lib/composition/documentsApi";
import { CONTACTS_METHODS } from "../../../web/src/lib/composition/contactsApi";
import { FEED_METHODS } from "../../../web/src/lib/composition/feedsApi";
import { READING_LIST_METHODS } from "../../../web/src/lib/composition/readingListApi";
import { TODO_METHODS } from "../../../web/src/lib/composition/todosApi";
import { PANELS_METHODS } from "../../../web/src/lib/composition/panelsApi";
import { ASSISTANT_METHODS } from "../../../web/src/lib/composition/assistantApi";
import { UPDATE_METHODS } from "../../../web/src/lib/composition/updatesApi";
import { WINDOW_METHODS } from "../../../web/src/lib/composition/windowApi";
import { API_METHODS } from "./backend";
import { ASSISTANT_VALIDATORS, ATTACHMENT_VALIDATORS, BACKUP_VALIDATORS, CONTACTS_VALIDATORS, DOCUMENT_VALIDATORS, FEED_VALIDATORS, InvalidArgumentsError, PANELS_VALIDATORS, READING_LIST_VALIDATORS, TODO_VALIDATORS, UPDATE_VALIDATORS, VALIDATORS, WINDOW_VALIDATORS } from "./validate";

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
      headingRailEnabled: false,
      headingRailSide: "right",
    };
    expect(VALIDATORS.saveWritingSettings([{ ...writing, extra: 1 }])).toEqual([writing]);
    expect(VALIDATORS.saveWritingSettings([{ headingRailEnabled: true }])).toEqual([{ headingRailEnabled: true }]);
    expect(VALIDATORS.savePluginSettings([{ todo: false, "reading-list": true, rss: false, contacts: true, extra: 1 }])).toEqual([{ todo: false, "reading-list": true, rss: false, contacts: true }]);
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

  it("passes the AI helper's alternate address along when there is one", () => {
    expect(
      VALIDATORS.saveAssistantSettings([{ serverUrl: "http://nas:11434", alternateUrl: "100.64.0.9:11434", contextTokens: 8192 }]),
    ).toEqual([{ serverUrl: "http://nas:11434", alternateUrl: "100.64.0.9:11434", contextTokens: 8192 }]);
  });

  it("takes no arguments to list the AI helper's models, so the renderer cannot point it at an address", () => {
    expect(VALIDATORS.listAssistantModels(["http://169.254.169.254/latest/meta-data/"])).toEqual([]);
  });

  it("takes no arguments for the ChatGPT sign-in, so a page can neither choose where it goes nor hand it a token", () => {
    expect(VALIDATORS.chatGptStatus(["x"])).toEqual([]);
    expect(VALIDATORS.startChatGptSignIn([{ redirect: "http://evil.example" }])).toEqual([]);
    expect(VALIDATORS.signOutChatGpt(["x"])).toEqual([]);
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
    ["saveSunPair", [{}]],
    ["saveWritingSettings", [null]],
    ["saveWritingSettings", [{}]],
    ["saveWritingSettings", [{ headingRailEnabled: "yes" }]],
    ["saveWritingSettings", [{ headingRailSide: 3 }]],
    ["saveWritingSettings", [{ rulerEnabled: "yes", rulerColumn: 80, reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true, wordCountEnabled: false }]],
    ["saveWritingSettings", [{ rulerEnabled: true, rulerColumn: "80", reflowEnabled: true, reflowColumn: 80, reflowKeepsTables: true, wordCountEnabled: false }]],
    ["savePluginSettings", [null]],
    ["savePluginSettings", [{}]],
    ["savePluginSettings", [{ todo: "off" }]],
    ["savePluginSettings", [{ todo: true }]],
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
    ["saveAssistantSettings", [{ serverUrl: "", alternateUrl: 5, contextTokens: 8192 }]],
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

describe("DOCUMENT_VALIDATORS", () => {
  it("has a validator for every PDF method, and no extras", () => {
    expect(Object.keys(DOCUMENT_VALIDATORS).sort()).toEqual([...DOCUMENT_METHODS].sort());
  });

  it("takes a target for an import, keeping only its two ids, so no path can ride along", () => {
    expect(DOCUMENT_VALIDATORS.importPdf([{ groupId: 4, notebookId: 1, path: "/Users/me/.ssh/id_rsa" }, "/etc/passwd"])).toEqual([{ groupId: 4, notebookId: 1 }]);
    expect(DOCUMENT_VALIDATORS.importPdf([{ groupId: null, notebookId: 2 }])).toEqual([{ groupId: null, notebookId: 2 }]);
    expect(DOCUMENT_VALIDATORS.importPdfCopy(["abc123", { groupId: null, notebookId: 2, path: "/x" }])).toEqual(["abc123", { groupId: null, notebookId: 2 }]);
  });

  it("takes marks as lists of records for the service to check, and no more than 500 at once", () => {
    const mark = { page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] };
    expect(DOCUMENT_VALIDATORS.addAnnotations([3, [mark, mark]])).toEqual([3, [mark, mark]]);
    expect(DOCUMENT_VALIDATORS.updateAnnotation([4, { color: "pink" }, "extra"])).toEqual([4, { color: "pink" }]);
    expect(DOCUMENT_VALIDATORS.restoreAnnotations([3, []])).toEqual([3, []]);
    expect(() => DOCUMENT_VALIDATORS.addAnnotations([3, Array.from({ length: 501 }, () => mark)])).toThrow(InvalidArgumentsError);
  });

  it("takes whole numbers for pages: a count from 1, a bookmark's page from 0", () => {
    expect(DOCUMENT_VALIDATORS.setDocumentPageCount([3, 600])).toEqual([3, 600]);
    expect(DOCUMENT_VALIDATORS.addBookmark([3, 0, "Preface"])).toEqual([3, 0, "Preface"]);
    expect(DOCUMENT_VALIDATORS.renameBookmark([8, "x"])).toEqual([8, "x"]);
  });

  it.each([
    ["importPdf", [{ groupId: "4", notebookId: 1 }]],
    ["importPdf", [{ groupId: 4 }]],
    ["importPdf", [null]],
    ["importPdfCopy", [5, { groupId: null, notebookId: 1 }]],
    ["importPdfCopy", ["tok", "target"]],
    ["setDocumentPageCount", [1, 0]],
    ["setDocumentPageCount", ["1", 5]],
    ["setDocumentPageCount", [1, 2.5]],
    ["saveDocumentViewState", [1, "state"]],
    ["saveDocumentViewState", [1, [1, 2]]],
    ["listBookmarks", [undefined]],
    ["addBookmark", [1, -1, "x"]],
    ["addBookmark", [1, 1.5, "x"]],
    ["addBookmark", [1, 1, 5]],
    ["renameBookmark", [1, null]],
    ["removeBookmark", [Number.NaN]],
    ["describeDocument", ["7"]],
    ["exportDocument", ["1", { flatten: false }]],
    ["exportDocument", [1, { flatten: "yes" }]],
    ["exportDocument", [1, {}]],
    ["exportDocument", [1, "flatten"]],
    ["exportDocument", [1]],
    ["listAnnotations", ["1"]],
    ["addAnnotations", [1, "marks"]],
    ["addAnnotations", [1, [1]]],
    ["updateAnnotation", [1, "x"]],
    ["updateAnnotation", ["1", {}]],
    ["deleteAnnotation", [null]],
    ["restoreAnnotations", [1, {}]],
    ["restoreAnnotations", ["1", []]],
  ] as const)("rejects bad arguments for %s", (method, args) => {
    expect(() => DOCUMENT_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
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

  it("passes only the number on for the opacity, and refuses anything else", () => {
    expect(WINDOW_VALIDATORS.setWindowOpacity([0.5, "extra"])).toEqual([0.5]);
    for (const args of [[], ["0.5"], [null], [Number.NaN], [Infinity]]) {
      expect(() => WINDOW_VALIDATORS.setWindowOpacity(args)).toThrow(InvalidArgumentsError);
    }
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

  it("reads the cycle settings without taking anything from the page", () => {
    expect(TODO_VALIDATORS.loadTodoSettings(["/etc/passwd"])).toEqual([]);
  });

  it("passes on cycle settings rebuilt from their three fields, and nothing else the page sent", () => {
    expect(TODO_VALIDATORS.saveTodoSettings([{ weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10, extra: "x" }, "extra"])).toEqual([
      { weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10 },
    ]);
    expect(TODO_VALIDATORS.saveTodoSettings([{ weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 }])).toEqual([
      { weekStartsOn: 0, retentionMonths: null, fiscalYearStartMonth: 1 },
    ]);
  });

  it.each([
    [undefined],
    [null],
    ["settings"],
    [{}],
    [{ weekStartsOn: 7, retentionMonths: 24, fiscalYearStartMonth: 10 }],
    [{ weekStartsOn: 1, retentionMonths: 0, fiscalYearStartMonth: 10 }],
    [{ weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 13 }],
    [{ weekStartsOn: 1, retentionMonths: 24 }],
  ])("refuses %j as cycle settings to save", (value) => {
    expect(() => TODO_VALIDATORS.saveTodoSettings([value])).toThrow(InvalidArgumentsError);
  });

  it("previews a purge for a window of months or for Keep forever, and refuses anything else", () => {
    expect(TODO_VALIDATORS.previewTodoPurge([12, "extra"])).toEqual([12]);
    expect(TODO_VALIDATORS.previewTodoPurge([null])).toEqual([null]);
    for (const months of [undefined, 0, -1, 2.5, 601, "12", {}]) {
      expect(() => TODO_VALIDATORS.previewTodoPurge([months])).toThrow(InvalidArgumentsError);
    }
  });

  it("lists the items without taking anything from the page", () => {
    expect(TODO_VALIDATORS.listTodos(["/etc/passwd"])).toEqual([]);
  });

  it("passes on exactly the arguments each method takes", () => {
    expect(TODO_VALIDATORS.createTodo(["Buy milk", null, "extra"])).toEqual(["Buy milk", null]);
    expect(TODO_VALIDATORS.createTodo(["Oat milk", 3])).toEqual(["Oat milk", 3]);
    expect(TODO_VALIDATORS.renameTodo([4, "Buy oat milk"])).toEqual([4, "Buy oat milk"]);
    expect(TODO_VALIDATORS.setTodoDone([4, true])).toEqual([4, true]);
    expect(TODO_VALIDATORS.setTodoStatus([4, "in_progress", "extra"])).toEqual([4, "in_progress"]);
    expect(TODO_VALIDATORS.deleteTodo([4, "extra"])).toEqual([4]);
  });

  it("lists the archive without taking anything from the page", () => {
    expect(TODO_VALIDATORS.listArchivedTodos(["/etc/passwd"])).toEqual([]);
  });

  it("passes on just the id for each archive method", () => {
    expect(TODO_VALIDATORS.removeTodo([4, "extra"])).toEqual([4]);
    expect(TODO_VALIDATORS.dropTodo([4, "extra"])).toEqual([4]);
    expect(TODO_VALIDATORS.restoreTodo([4, "extra"])).toEqual([4]);
    expect(TODO_VALIDATORS.acceptRolledTodo([4, "extra"])).toEqual([4]);
  });

  it("passes on just the id when asking what a permanent delete would erase, and refuses anything else", () => {
    expect(TODO_VALIDATORS.previewTodoDelete([4, "extra"])).toEqual([4]);
    for (const value of [undefined, null, "4", 1.5, NaN, {}]) {
      expect(() => TODO_VALIDATORS.previewTodoDelete([value])).toThrow(InvalidArgumentsError);
    }
  });

  it("lists the reports without taking anything from the page", () => {
    expect(TODO_VALIDATORS.loadTodoReports(["/etc/passwd"])).toEqual([]);
  });

  it("makes a report only for a known kind and a real date", () => {
    expect(TODO_VALIDATORS.generateTodoReport(["weekly", "2026-10-18", "extra"])).toEqual(["weekly", "2026-10-18"]);
    expect(TODO_VALIDATORS.generateTodoReport(["quarterly", "2026-07-01"])).toEqual(["quarterly", "2026-07-01"]);
    for (const args of [[], ["weekly"], ["yearly", "2026-10-18"], ["weekly", "2026-02-30"], ["weekly", "18/10/2026"], ["weekly", 20261018], [null, "2026-10-18"], ["weekly", "2026-10-18T00:00"]]) {
      expect(() => TODO_VALIDATORS.generateTodoReport(args)).toThrow(InvalidArgumentsError);
    }
  });

  it("passes on just the id for Move to backlog, and refuses anything else", () => {
    expect(TODO_VALIDATORS.moveRolledTodoToBacklog([4, "extra"])).toEqual([4]);
    for (const value of [undefined, null, "4", 1.5, NaN, {}]) {
      expect(() => TODO_VALIDATORS.moveRolledTodoToBacklog([value])).toThrow(InvalidArgumentsError);
    }
  });

  it("passes on an id and what to go before for moveTodo, and refuses anything else", () => {
    expect(TODO_VALIDATORS.moveTodo([4, 2, "extra"])).toEqual([4, 2]);
    expect(TODO_VALIDATORS.moveTodo([4, null])).toEqual([4, null]);
    for (const args of [[], [null, 2], ["4", 2], [4], [4, "2"], [4, 1.5], [4, undefined], [4, {}]]) {
      expect(() => TODO_VALIDATORS.moveTodo(args)).toThrow(InvalidArgumentsError);
    }
  });

  it("passes on an id and a priority (or null) for setTodoPriority, and refuses anything else", () => {
    expect(TODO_VALIDATORS.setTodoPriority([4, 1, "extra"])).toEqual([4, 1]);
    expect(TODO_VALIDATORS.setTodoPriority([4, null])).toEqual([4, null]);
    for (const args of [[], [4], [4, 0], [4, 6], [4, 1.5], [4, "1"], [4, undefined], ["4", 1], [null, 1]]) {
      expect(() => TODO_VALIDATORS.setTodoPriority(args)).toThrow(InvalidArgumentsError);
    }
  });

  it("takes nothing from the page for sortTodosByPriority", () => {
    expect(TODO_VALIDATORS.sortTodosByPriority(["/etc/passwd"])).toEqual([]);
  });

  it("takes nothing from the page for sortDoneTodosLast", () => {
    expect(TODO_VALIDATORS.sortDoneTodosLast(["/etc/passwd"])).toEqual([]);
  });

  it("asks about the first-run question without taking anything from the page, and answers only with a yes or a no", () => {
    expect(TODO_VALIDATORS.loadTodoSetup(["/etc/passwd"])).toEqual([]);
    expect(TODO_VALIDATORS.finishTodoSetup([true, "extra"])).toEqual([true]);
    expect(TODO_VALIDATORS.finishTodoSetup([false])).toEqual([false]);
    for (const value of [undefined, null, "true", 1, 0, {}]) {
      expect(() => TODO_VALIDATORS.finishTodoSetup([value])).toThrow(InvalidArgumentsError);
    }
  });

  it.each(["removeTodo", "dropTodo", "restoreTodo", "acceptRolledTodo"] as const)("refuses %s without a whole-number id", (method) => {
    for (const value of [undefined, null, "4", 1.5, NaN, Infinity, {}, [4], true]) {
      expect(() => TODO_VALIDATORS[method]([value])).toThrow(InvalidArgumentsError);
    }
    expect(() => TODO_VALIDATORS[method]([])).toThrow(InvalidArgumentsError);
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
    ["setTodoStatus", [4, "later"]],
    ["setTodoStatus", ["4", "done"]],
    ["setTodoStatus", [4]],
    ["deleteTodo", [null]],
  ] as const)("refuses %s with %j", (method, args) => {
    expect(() => TODO_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});

describe("READING_LIST_VALIDATORS", () => {
  it("has a validator for every method of the Reading List API, and no extras", () => {
    expect(Object.keys(READING_LIST_VALIDATORS).sort()).toEqual([...READING_LIST_METHODS].sort());
  });

  it("lists and clears without taking anything from the page", () => {
    expect(READING_LIST_VALIDATORS.listReadingItems(["/etc/passwd"])).toEqual([]);
    expect(READING_LIST_VALIDATORS.clearReadingData(["https://evil.example/"])).toEqual([]);
  });

  it("passes on a link as the shared rule writes it, and nothing else the page sent", () => {
    expect(READING_LIST_VALIDATORS.addReadingItem(["  example.com/a#top ", "extra"])).toEqual(["https://example.com/a"]);
    expect(READING_LIST_VALIDATORS.setReadingItemTitle([4, "A post", "extra"])).toEqual([4, "A post"]);
    expect(READING_LIST_VALIDATORS.setReadingItemRead([4, true, "extra"])).toEqual([4, true]);
    expect(READING_LIST_VALIDATORS.deleteReadingItem([4, "extra"])).toEqual([4]);
  });

  it.each([
    ["addReadingItem", []],
    ["addReadingItem", [null]],
    ["addReadingItem", [{ toString: () => "https://example.com" }]],
    ["addReadingItem", [""]],
    ["addReadingItem", ["javascript:alert(1)"]],
    ["addReadingItem", ["file:///etc/passwd"]],
    ["addReadingItem", ["app://composition/"]],
    ["addReadingItem", ["data:text/html,hi"]],
    ["addReadingItem", [`https://example.com/${"a".repeat(3000)}`]],
    ["setReadingItemTitle", ["4", "x"]],
    ["setReadingItemTitle", [4, null]],
    ["setReadingItemTitle", [4, "x".repeat(10000)]],
    ["setReadingItemRead", [4, "true"]],
    ["setReadingItemRead", [1.5, true]],
    ["setReadingItemRead", [4]],
    ["deleteReadingItem", [null]],
    ["deleteReadingItem", ["4"]],
  ] as const)("refuses %s with %j", (method, args) => {
    expect(() => READING_LIST_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});

describe("FEED_VALIDATORS", () => {
  it("has a validator for every method of the feeds API, and no extras", () => {
    expect(Object.keys(FEED_VALIDATORS).sort()).toEqual([...FEED_METHODS].sort());
  });

  it("lists and refreshes everything without taking anything from the page", () => {
    expect(FEED_VALIDATORS.listFeeds(["/etc/passwd"])).toEqual([]);
    expect(FEED_VALIDATORS.refreshAllFeeds(["https://evil.example/"])).toEqual([]);
  });

  it("passes on an address as the shared rule writes it, and nothing else the page sent", () => {
    expect(FEED_VALIDATORS.subscribeFeed(["  example.com/feed#top ", "extra"])).toEqual(["https://example.com/feed"]);
    expect(FEED_VALIDATORS.unsubscribeFeed([4, "extra"])).toEqual([4]);
    expect(FEED_VALIDATORS.listFeedEntries([4, "extra"])).toEqual([4]);
    expect(FEED_VALIDATORS.listFeedEntries([null])).toEqual([null]);
    expect(FEED_VALIDATORS.refreshFeed([4])).toEqual([4]);
    expect(FEED_VALIDATORS.setFeedEntryRead([7, false, "extra"])).toEqual([7, false]);
    expect(FEED_VALIDATORS.markFeedRead([null])).toEqual([null]);
    expect(FEED_VALIDATORS.markFeedRead([3])).toEqual([3]);
  });

  it.each([
    ["subscribeFeed", []],
    ["subscribeFeed", [null]],
    ["subscribeFeed", [{ toString: () => "https://example.com" }]],
    ["subscribeFeed", [""]],
    ["subscribeFeed", ["javascript:alert(1)"]],
    ["subscribeFeed", ["file:///etc/passwd"]],
    ["subscribeFeed", ["app://composition/"]],
    ["subscribeFeed", ["https://user:pw@example.com/feed"]],
    ["subscribeFeed", [`https://example.com/${"a".repeat(3000)}`]],
    ["unsubscribeFeed", [null]],
    ["unsubscribeFeed", ["4"]],
    ["listFeedEntries", []],
    ["listFeedEntries", ["4"]],
    ["listFeedEntries", [1.5]],
    ["refreshFeed", [null]],
    ["refreshFeed", [{ id: 4 }]],
    ["setFeedEntryRead", [7, "false"]],
    ["setFeedEntryRead", [7]],
    ["setFeedEntryRead", [null, true]],
    ["markFeedRead", []],
    ["markFeedRead", ["all"]],
  ] as const)("refuses %s with %j", (method, args) => {
    expect(() => FEED_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});

describe("CONTACTS_VALIDATORS", () => {
  const contact = { kind: "work", firstName: "Grace", lastName: "Hopper", email: "grace@navy.mil", phone: "", notes: "", birthDate: "1906-12-09", title: "Rear Admiral", manager: "Chester Nimitz" };

  it("has a validator for every method of the Contacts API, and no extras", () => {
    expect(Object.keys(CONTACTS_VALIDATORS).sort()).toEqual([...CONTACTS_METHODS].sort());
  });

  it("lists without taking anything from the page", () => {
    expect(CONTACTS_VALIDATORS.listContacts(["/etc/passwd"])).toEqual([]);
  });

  it("passes on a contact as the shared rule writes it, and nothing else the page sent", () => {
    expect(CONTACTS_VALIDATORS.addContact([{ ...contact, firstName: "  Grace ", id: 9, admin: true }, "extra"])).toEqual([contact]);
    expect(CONTACTS_VALIDATORS.updateContact([4, contact, "extra"])).toEqual([4, contact]);
    expect(CONTACTS_VALIDATORS.deleteContact([4, "extra"])).toEqual([4]);
  });

  it("empties a personal contact's work fields on the way through", () => {
    expect(CONTACTS_VALIDATORS.addContact([{ ...contact, kind: "personal" }])).toEqual([{ ...contact, kind: "personal", title: "", manager: "" }]);
  });

  it.each([
    ["addContact", []],
    ["addContact", [null]],
    ["addContact", ["Grace"]],
    ["addContact", [{ ...contact, kind: "boss" }]],
    ["addContact", [{ ...contact, firstName: "", lastName: "" }]],
    ["addContact", [{ ...contact, email: "nope" }]],
    ["addContact", [{ ...contact, birthDate: "2999-01-01" }]],
    ["addContact", [{ ...contact, notes: 5 }]],
    ["addContact", [{ ...contact, notes: "x".repeat(20000) }]],
    ["updateContact", ["4", contact]],
    ["updateContact", [1.5, contact]],
    ["updateContact", [4]],
    ["updateContact", [4, { ...contact, title: ["x"] }]],
    ["deleteContact", [null]],
    ["deleteContact", ["4"]],
  ] as const)("refuses %s with %j", (method, args) => {
    expect(() => CONTACTS_VALIDATORS[method]([...args])).toThrow(InvalidArgumentsError);
  });
});
