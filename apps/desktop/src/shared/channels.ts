/** IPC channel names, shared by the preload script and the main process. */
export const channelFor = (method: string): string => `composition:${method}`;

/** Synchronous snapshot (theme, layout) the preload fetches before the page paints. */
export const INITIAL_CHANNEL = "composition:initial";
