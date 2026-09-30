/**
 * The one place apps/desktop reaches into apps/web: the framework-free data
 * layer the web app's Server Actions also sit on top of (plan decision D3).
 * Everything else in the desktop app imports from here, so moving this code
 * into a shared package later means changing these lines only.
 *
 * Nothing under `lib/composition/` may import `next/*`; `service.ts` is the
 * implementation of the CompositionApi contract.
 */
export { API_METHODS } from "../../../web/src/lib/composition/api";
export type { ApiMethod, CompositionApi } from "../../../web/src/lib/composition/api";
export { closeDb } from "../../../web/src/lib/composition/db";
export { listNotes } from "../../../web/src/lib/composition/notesRepo";
export * as searchIndex from "../../../web/src/lib/composition/searchIndex";
export * as service from "../../../web/src/lib/composition/service";
export { loadWebSettings } from "../../../web/src/lib/composition/webSettings";
export type { ThemeName } from "../../../web/src/lib/composition/themes";
