/** IPC channel names, shared by the preload script and the main process. */
export const channelFor = (method: string): string => `composition:${method}`;

/** Synchronous snapshot (theme, layout) the preload fetches before the page paints. */
export const INITIAL_CHANNEL = "composition:initial";

/** Pushed from the main process to every window whenever the update state changes. */
export const UPDATE_STATE_CHANNEL = "composition:update-state";

/** Pushed from the main process to the window that asked, once per event of an AI helper chat turn. */
export const ASSISTANT_EVENT_CHANNEL = "composition:assistant-event";

/** Pushed from the main process to every window whenever the color scheme, a font or the sun's city is saved. */
export const APPEARANCE_CHANNEL = "composition:appearance";

/**
 * Pushed from the main process to the main window's page when the user closes a pop-out, with its window id. Only then: a
 * pop-out the app tears down (the main window closing or reloading, or quitting) is not reported, since its page's own
 * unload events cannot tell the two apart and the workspace must keep that window for the next launch.
 */
export const POPOUT_CLOSED_CHANNEL = "composition:popout-closed";

