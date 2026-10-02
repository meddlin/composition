import type { AttachmentMethod } from "../../../web/src/lib/composition/attachmentsApi";
import type { BackupMethod } from "../../../web/src/lib/composition/backupApi";
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
  createNote: ([title, groupId]) => [
    text("createNote", title, "title"),
    groupId === undefined ? null : nullableId("createNote", groupId, "groupId"),
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
  deleteNote: ([noteId]) => [id("deleteNote", noteId, "id")],
  moveNoteToGroup: ([noteId, groupId]) => [
    id("moveNoteToGroup", noteId, "noteId"),
    nullableId("moveNoteToGroup", groupId, "groupId"),
  ],
  createGroup: ([name, parentId]) => [
    text("createGroup", name, "name"),
    nullableId("createGroup", parentId, "parentId"),
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
