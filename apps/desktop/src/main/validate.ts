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
  saveLayout: ([layout]) => {
    const value = record("saveLayout", layout, "layout");
    return [
      {
        sidebarWidth: finite("saveLayout", value.sidebarWidth, "sidebarWidth"),
        editorRatio: finite("saveLayout", value.editorRatio, "editorRatio"),
      },
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
};
