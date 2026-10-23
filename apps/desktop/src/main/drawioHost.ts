/**
 * Where the draw.io editor (a note's diagrams are drawn in it) is served from, and what it may do.
 * Kept apart from protocol.ts, which needs Electron, so this is tested.
 *
 * The editor opens whatever diagram it is given and runs a lot of script, so it gets its own origin:
 * `app://drawio`, not the app's `app://composition`. A page on one origin cannot read or script a page
 * on the other, which is what keeps a hostile diagram away from the notes, and the IPC bridge only
 * answers to `app://composition` (origin.ts), so the editor cannot reach it either.
 */
import { APP_SCHEME } from "./appScheme";

export const DRAWIO_HOST = "drawio";
export const DRAWIO_ORIGIN = `${APP_SCHEME}://${DRAWIO_HOST}`;

/**
 * The editor's Content Security Policy, sent with every file it is served as. It may load its own files
 * and picture data, run its own scripts (none inline, none from `eval`), and nothing else: no network,
 * so even a diagram that tried could not send anything out. Only the app's own pages (`parentOrigins`)
 * may frame it.
 */
export function drawioContentSecurityPolicy(parentOrigins: readonly string[]): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${parentOrigins.join(" ")}`,
  ].join("; ");
}
