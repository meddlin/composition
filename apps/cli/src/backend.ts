/**
 * The one place apps/cli reaches into apps/web and apps/desktop: the framework-free
 * data layer the web app's Server Actions and the desktop app's main process both sit
 * on, plus desktop's Electron-free Meilisearch process code. Everything else in the CLI
 * imports from here, so moving this code into a shared package later (see
 * docs/shared-core-plan.md) means changing these lines only.
 *
 * Nothing imported here may use `next/*` or `electron`.
 */

// --- apps/web: data layer ---------------------------------------------------
export { API_METHODS } from "../../web/src/lib/composition/api";
export type {
  ApiMethod,
  CompositionApi,
  SearchHit,
  SearchResult,
  SettingsSnapshot,
  Workspace,
} from "../../web/src/lib/composition/api";
export { closeDb } from "../../web/src/lib/composition/db";
export { expandHome } from "../../web/src/lib/composition/paths";
export {
  loadWebSettings,
  resolvedDbPath,
  saveWebSettings,
  settingsPath,
} from "../../web/src/lib/composition/webSettings";
export type { WebSettings } from "../../web/src/lib/composition/webSettings";
export { listNotes } from "../../web/src/lib/composition/notesRepo";
export type { Note } from "../../web/src/lib/composition/notesRepo";
export type { Group } from "../../web/src/lib/composition/groupsRepo";
export type { Favorites } from "../../web/src/lib/composition/favorites";
export type { ThemeName } from "../../web/src/lib/composition/themes";
export * as favorites from "../../web/src/lib/composition/favorites";
export * as frontmatter from "../../web/src/lib/composition/frontmatter";
export * as searchIndex from "../../web/src/lib/composition/searchIndex";
export * as service from "../../web/src/lib/composition/service";
export * as themes from "../../web/src/lib/composition/themes";

// --- apps/web: pane arrangement (pure state, no React) -----------------------
export * as panes from "../../web/src/components/notes/panes";

// --- apps/desktop: Meilisearch process and search sidecar (no Electron) ------
export {
  MeiliError,
  MeiliProcessManager,
  reapOrphan,
} from "../../desktop/src/main/meili";
export {
  isExecutableFile,
  resolveMeiliBinary,
  SearchSidecar,
} from "../../desktop/src/main/search";
