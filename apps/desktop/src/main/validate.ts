import { isRequestId, type AssistantMethod } from "../../../web/src/lib/composition/assistantApi";
import { checkChatRequest } from "../../../web/src/lib/composition/assistant/chatRequest";
import type { AttachmentMethod } from "../../../web/src/lib/composition/attachmentsApi";
import type { BackupMethod } from "../../../web/src/lib/composition/backupApi";
import type { UpdateMethod } from "../../../web/src/lib/composition/updatesApi";
import type { ApiMethod } from "./backend";

/**
 * The renderer is untrusted input, and TypeScript's types don't exist at
 * runtime, so each IPC call's arguments are checked before they reach the
 * service. A validator returns exactly the arguments the method takes.
 */
export class InvalidArgumentsError extends Error {}

type Validator = (args: unknown[]) => unknown[];

function fail(method: string, what: string): never {
  throw new InvalidArgumentsError(`${method}: invalid ${what}`);
}

const id = (method: string, value: unknown, name: string): number =>
  Number.isSafeInteger(value) ? (value as number) : fail(method, name);

const nullableId = (method: string, value: unknown, name: string): number | null =>
  value === null ? null : id(method, value, name);

const text = (method: string, value: unknown, name: string): string =>
  typeof value === "string" ? value : fail(method, name);

const finite = (method: string, value: unknown, name: string): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(method, name);

const flag = (method: string, value: unknown, name: string): boolean =>
  typeof value === "boolean" ? value : fail(method, name);

function record(method: string, value: unknown, name: string): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(method, name);
}

function bytes(method: string, value: unknown, name: string): Uint8Array {
  return value instanceof Uint8Array ? value : fail(method, name);
}

const none: Validator = () => [];

export const VALIDATORS: Record<ApiMethod, Validator> = {
  loadWorkspace: none,
  loadSettings: none,
  searchNotes: ([query]) => [text("searchNotes", query, "query")],
  createNote: ([title, groupId, notebookId]) => [
    text("createNote", title, "title"),
    groupId === undefined ? null : nullableId("createNote", groupId, "groupId"),
    ...(notebookId === undefined ? [] : [nullableId("createNote", notebookId, "notebookId")]),
  ],
  saveNoteContent: ([noteId, content]) => [
    id("saveNoteContent", noteId, "noteId"),
    text("saveNoteContent", content, "content"),
  ],
  saveImage: ([input]) => {
    const value = record("saveImage", input, "image");
    return [
      {
        noteId: id("saveImage", value.noteId, "noteId"),
        fileName: text("saveImage", value.fileName, "fileName"),
        data: bytes("saveImage", value.data, "data"),
      },
    ];
  },
  listImages: none,
  deleteNote: ([noteId]) => [id("deleteNote", noteId, "id")],
  moveNoteToGroup: ([noteId, groupId]) => [
    id("moveNoteToGroup", noteId, "noteId"),
    nullableId("moveNoteToGroup", groupId, "groupId"),
  ],
  placeNote: ([noteId, groupId, beforeNoteId]) => [
    id("placeNote", noteId, "noteId"),
    nullableId("placeNote", groupId, "groupId"),
    nullableId("placeNote", beforeNoteId, "beforeNoteId"),
  ],
  createGroup: ([name, parentId, notebookId]) => [
    text("createGroup", name, "name"),
    nullableId("createGroup", parentId, "parentId"),
    ...(notebookId === undefined ? [] : [nullableId("createGroup", notebookId, "notebookId")]),
  ],
  createNotebook: ([name]) => [text("createNotebook", name, "name")],
  renameNotebook: ([notebookId, name]) => [
    id("renameNotebook", notebookId, "id"),
    text("renameNotebook", name, "name"),
  ],
  placeNotebook: ([notebookId, beforeNotebookId]) => [
    id("placeNotebook", notebookId, "id"),
    nullableId("placeNotebook", beforeNotebookId, "beforeNotebookId"),
  ],
  deleteNotebook: ([notebookId]) => [id("deleteNotebook", notebookId, "id")],
  moveGroupToNotebook: ([groupId, notebookId]) => [
    id("moveGroupToNotebook", groupId, "id"),
    id("moveGroupToNotebook", notebookId, "notebookId"),
  ],
  renameGroup: ([groupId, name]) => [
    id("renameGroup", groupId, "id"),
    text("renameGroup", name, "name"),
  ],
  deleteGroup: ([groupId]) => [id("deleteGroup", groupId, "id")],
  moveGroup: ([groupId, parentId]) => [
    id("moveGroup", groupId, "id"),
    nullableId("moveGroup", parentId, "parentId"),
  ],
  placeGroup: ([groupId, parentId, beforeGroupId]) => [
    id("placeGroup", groupId, "id"),
    nullableId("placeGroup", parentId, "parentId"),
    nullableId("placeGroup", beforeGroupId, "beforeGroupId"),
  ],
  loadTrash: none,
  restoreNote: ([noteId]) => [id("restoreNote", noteId, "id")],
  restoreGroup: ([groupId]) => [id("restoreGroup", groupId, "id")],
  permanentlyDeleteNote: ([noteId]) => [id("permanentlyDeleteNote", noteId, "id")],
  permanentlyDeleteGroup: ([groupId]) => [id("permanentlyDeleteGroup", groupId, "id")],
  saveLayout: ([layout]) => {
    const value = record("saveLayout", layout, "layout");
    return [
      {
        sidebarWidth: finite("saveLayout", value.sidebarWidth, "sidebarWidth"),
        editorRatio: finite("saveLayout", value.editorRatio, "editorRatio"),
      },
    ];
  },
  saveFavorites: ([favorites]) => {
    if (!Array.isArray(favorites)) fail("saveFavorites", "favorites");
    return [
      favorites.map((entry) => {
        const value = record("saveFavorites", entry, "favorite");
        if (value.type !== "group" && value.type !== "note") fail("saveFavorites", "type");
        return { type: value.type, id: id("saveFavorites", value.id, "id") };
      }),
    ];
  },
  saveSettings: ([input]) => {
    const value = record("saveSettings", input, "settings");
    return [
      {
        appDataDir: text("saveSettings", value.appDataDir, "appDataDir"),
        dbPath: text("saveSettings", value.dbPath, "dbPath"),
      },
    ];
  },
  saveTheme: ([theme]) => [text("saveTheme", theme, "theme")],
  savePreviewFont: ([font]) => [text("savePreviewFont", font, "font")],
  saveEditorFont: ([font]) => [text("saveEditorFont", font, "font")],
  saveWritingSettings: ([input]) => {
    const value = record("saveWritingSettings", input, "settings");
    return [
      {
        rulerEnabled: flag("saveWritingSettings", value.rulerEnabled, "rulerEnabled"),
        rulerColumn: finite("saveWritingSettings", value.rulerColumn, "rulerColumn"),
        reflowEnabled: flag("saveWritingSettings", value.reflowEnabled, "reflowEnabled"),
        reflowColumn: finite("saveWritingSettings", value.reflowColumn, "reflowColumn"),
        reflowKeepsTables: flag("saveWritingSettings", value.reflowKeepsTables, "reflowKeepsTables"),
      },
    ];
  },
  saveHomeSettings: ([input]) => {
    const value = record("saveHomeSettings", input, "settings");
    if (!Array.isArray(value.sections)) fail("saveHomeSettings", "sections");
    return [
      {
        layout: text("saveHomeSettings", value.layout, "layout"),
        sections: value.sections.map((entry) => {
          const section = record("saveHomeSettings", entry, "section");
          return {
            id: text("saveHomeSettings", section.id, "id"),
            visible: flag("saveHomeSettings", section.visible, "visible"),
          };
        }),
        recentCount: finite("saveHomeSettings", value.recentCount, "recentCount"),
        density: text("saveHomeSettings", value.density, "density"),
        startup: text("saveHomeSettings", value.startup, "startup"),
        pinnedNotebooks: Array.isArray(value.pinnedNotebooks)
          ? value.pinnedNotebooks.map((notebook) => id("saveHomeSettings", notebook, "pinnedNotebooks"))
          : fail("saveHomeSettings", "pinnedNotebooks"),
        notebookColors: Object.fromEntries(
          Object.entries(record("saveHomeSettings", value.notebookColors, "notebookColors")).map(([notebook, color]) => [
            notebook,
            text("saveHomeSettings", color, "notebookColors"),
          ]),
        ),
        recentSort: text("saveHomeSettings", value.recentSort, "recentSort"),
        recentNotebook: nullableId("saveHomeSettings", value.recentNotebook, "recentNotebook"),
        header: {
          show: flag("saveHomeSettings", record("saveHomeSettings", value.header, "header").show, "header"),
          title: text("saveHomeSettings", (value.header as Record<string, unknown>).title, "header"),
        },
      },
    ];
  },
  saveAssistantSettings: ([input]) => {
    const value = record("saveAssistantSettings", input, "settings");
    return [
      {
        serverUrl: text("saveAssistantSettings", value.serverUrl, "serverUrl"),
        contextTokens: finite("saveAssistantSettings", value.contextTokens, "contextTokens"),
      },
    ];
  },
  // No arguments, on purpose: the address it asks is the saved one, never one the renderer names.
  listAssistantModels: none,
  saveLocation: ([city]) => [text("saveLocation", city, "city")],
  loadSunSchedule: none,
};

/** Arguments of the desktop-only attachment methods (see attachments.ts). Ids only: no path ever comes from the renderer. */
export const ATTACHMENT_VALIDATORS: Record<AttachmentMethod, Validator> = {
  listAttachments: ([noteId]) => [id("listAttachments", noteId, "noteId")],
  addAttachments: ([noteId]) => [id("addAttachments", noteId, "noteId")],
  revealAttachment: ([attachmentId]) => [id("revealAttachment", attachmentId, "id")],
  saveAttachmentCopy: ([attachmentId]) => [id("saveAttachmentCopy", attachmentId, "id")],
  removeAttachment: ([attachmentId]) => [id("removeAttachment", attachmentId, "id")],
};

/** The desktop-only backup methods take nothing: the main process asks with a dialog, so no path ever comes from the renderer. */
export const BACKUP_VALIDATORS: Record<BackupMethod, Validator> = {
  createBackup: none,
  restoreBackup: none,
};

/** The update methods take nothing from the page except a boolean: where updates come from is fixed in the build, so no URL or path ever comes from the renderer. */
export const UPDATE_VALIDATORS: Record<UpdateMethod, Validator> = {
  getUpdateState: none,
  checkForUpdates: none,
  downloadUpdate: none,
  installUpdate: none,
  setAutoCheckUpdates: ([enabled]) =>
    typeof enabled === "boolean" ? [enabled] : fail("setAutoCheckUpdates", "enabled"),
  setAllowPrerelease: ([enabled]) =>
    typeof enabled === "boolean" ? [enabled] : fail("setAllowPrerelease", "enabled"),
};

/** Arguments of the AI helper's chat calls. The request is checked by the same function the web route uses; a cloud model is refused here, by name. */
export const ASSISTANT_VALIDATORS: Record<AssistantMethod, Validator> = {
  assistantChat: ([requestId, request]) => {
    if (!isRequestId(requestId)) fail("assistantChat", "requestId");
    const checked = checkChatRequest(request);
    if (!checked.ok) fail("assistantChat", `request (${checked.error})`);
    return [requestId, checked.request];
  },
  assistantAbort: ([requestId]) => [isRequestId(requestId) ? requestId : fail("assistantAbort", "requestId")],
};
