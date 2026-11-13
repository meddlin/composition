/** IPC channel names, shared by the preload script and the main process. */
export const channelFor = (method: string): string => `composition:${method}`;

/** Synchronous snapshot (theme, layout) the preload fetches before the page paints. */
export const INITIAL_CHANNEL = "composition:initial";

/** Pushed from the main process to every window whenever the update state changes. */
export const UPDATE_STATE_CHANNEL = "composition:update-state";

/** Pushed from the main process to the window that asked, once per event of an AI helper chat turn. */
export const ASSISTANT_EVENT_CHANNEL = "composition:assistant-event";

/** Pushed from the main process to every window whenever the color scheme, a font or the Follow the sun hours are saved. */
export const APPEARANCE_CHANNEL = "composition:appearance";

/**
 * Pushed from the main process to the main window's page when the user closes a pop-out, with its window id. Only then: a
 * pop-out the app tears down (the main window closing or reloading, or quitting) is not reported, since its page's own
 * unload events cannot tell the two apart and the workspace must keep that window for the next launch.
 */
export const POPOUT_CLOSED_CHANNEL = "composition:popout-closed";


/** Pushed from the main process to every window when the weekly cycle has changed the to-do list (a week closed, or old items were purged), so each reads it again. */
export const TODOS_CHANGED_CHANNEL = "composition:todos-changed";

/**
 * Pushed from the main process to the main window's page when the user picks File > Import PDF…. The page decides where the
 * PDF goes (the group and notebook the sidebar is on) and asks the main process to open the picker, as its own button does.
 */
export const IMPORT_PDF_CHANNEL = "composition:import-pdf-request";
