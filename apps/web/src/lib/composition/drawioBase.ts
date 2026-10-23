/**
 * Where the draw.io editor's files are served from, ending in `/`. In the web build that is the
 * `public/drawio/` folder (`pnpm fetch:drawio`), same origin as the app; a desktop build resolves
 * `drawioBase.desktop.ts` instead (next.config.ts), which is its own origin.
 */
export const DRAWIO_BASE = "/drawio/";
