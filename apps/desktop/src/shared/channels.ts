/** IPC channel names, shared by the preload script and the main process. */
export const channelFor = (method: string): string => `composition:${method}`;

/** Synchronous snapshot (theme, layout) the preload fetches before the page paints. */
export const INITIAL_CHANNEL = "composition:initial";

/** Pushed from the main process to every window whenever the update state changes. */
export const UPDATE_STATE_CHANNEL = "composition:update-state";

/** Pushed from the main process to the window that asked, once per event of an AI helper chat turn. */
export const ASSISTANT_EVENT_CHANNEL = "composition:assistant-event";
