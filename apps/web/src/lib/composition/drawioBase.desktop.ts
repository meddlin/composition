/**
 * Desktop build's replacement for `drawioBase.ts`: Electron's main process serves the editor at
 * `app://drawio/` (apps/desktop/src/main/protocol.ts), a different origin from the app's own
 * `app://composition`, so the editor, which opens whatever diagram it is given, cannot reach the app's page.
 */
export const DRAWIO_BASE = "app://drawio/";
