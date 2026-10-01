import type { CompositionApi } from "./api";

/**
 * What the client components import to reach the backend. In the web build
 * this is the Server Actions; a desktop build resolves `client.desktop.ts`
 * instead (next.config.ts), which talks to Electron's main process.
 *
 * Components must import from here, never from `actions` or `service`.
 * Next drops Server Actions nothing imports, so re-exporting the whole
 * contract (including the two loaders the web pages don't call) adds no
 * public endpoint.
 */
export {
  createGroup,
  createNote,
  deleteGroup,
  deleteNote,
  loadSettings,
  loadSunSchedule,
  loadWorkspace,
  moveGroup,
  moveNoteToGroup,
  renameGroup,
  saveImage,
  saveLayout,
  saveLocation,
  saveNoteContent,
  saveSettings,
  saveTheme,
  searchNotes,
} from "./actions";
export type {
  MoveGroupResult,
  SaveImageInput,
  SaveImageResult,
  SaveLocationResult,
  SaveSettingsInput,
  SaveSettingsResult,
  SearchHit,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "./api";

// Type-level proof that the Server Actions implement the whole contract.
type ActionsImplementApi = typeof import("./actions") extends CompositionApi ? true : never;
export const _actionsImplementApi: ActionsImplementApi = true;
