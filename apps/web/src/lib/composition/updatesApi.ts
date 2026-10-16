/**
 * What the Settings screen's Updates section and the desktop main process exchange.
 * Types and small pure helpers only, so it is safe to import anywhere (renderer,
 * preload, main). The design is docs/desktop-updates-plan.md.
 *
 * Desktop only: the web app and CLI have no updater. The renderer never supplies a URL
 * or a path; where updates come from is fixed in the desktop app's build configuration.
 */

/** Where an update is in its life. "idle" means up to date, or not checked yet. */
export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export type UpdateState = {
  phase: UpdatePhase;
  /** The version this app is running. */
  currentVersion: string;
  /** False in a development run, where there is nothing to update; `unsupportedReason` says why. */
  supported: boolean;
  unsupportedReason?: string;
  /** Whether the app checks on its own (at launch, then every few hours). */
  autoCheck: boolean;
  /** Whether pre-release versions are offered too (early builds that may be unstable). Off by default. */
  allowPrerelease: boolean;
  /** When the last check finished, as an ISO timestamp; absent until one has. */
  lastCheckedAt?: string;
  /** The newer version, in "available", "downloading" and "ready". */
  version?: string;
  /** Plain-text release notes for `version`, when the release has them. */
  releaseNotes?: string;
  /** Download progress, 0 to 100, in "downloading". */
  percent?: number;
  /** What went wrong, in "error". The previous phase is not restored; check again. */
  error?: string;
};

/** The desktop app's contract. Failures show up in the returned state (`phase: "error"`), never as a throw. */
export interface UpdatesApi {
  getUpdateState(): Promise<UpdateState>;
  /** Looks for a newer version now, whatever `autoCheck` says. */
  checkForUpdates(): Promise<UpdateState>;
  /** Downloads the version that "available" announced. Does nothing in any other phase. */
  downloadUpdate(): Promise<UpdateState>;
  /** Restarts into the downloaded version. Does nothing unless the phase is "ready". */
  installUpdate(): Promise<UpdateState>;
  setAutoCheckUpdates(enabled: boolean): Promise<UpdateState>;
  setAllowPrerelease(enabled: boolean): Promise<UpdateState>;
}

/** Every method of UpdatesApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const UPDATE_METHODS = [
  "getUpdateState",
  "checkForUpdates",
  "downloadUpdate",
  "installUpdate",
  "setAutoCheckUpdates",
  "setAllowPrerelease",
] as const satisfies readonly (keyof UpdatesApi)[];

export type UpdateMethod = (typeof UPDATE_METHODS)[number];

type MissingFromUpdateMethods = Exclude<keyof UpdatesApi, UpdateMethod>;
const _everyMethodListed: [MissingFromUpdateMethods] extends [never] ? true : never = true;
void _everyMethodListed;

/** Pushed from the main process whenever the state changes; the bridge's `onUpdateState` receives it. */
export type UpdateStateListener = (state: UpdateState) => void;

/** The one-line status the Settings screen and the sidebar show. */
export function describeUpdateState(state: UpdateState): string {
  if (!state.supported) return state.unsupportedReason ?? "Updates are not available in this build.";
  switch (state.phase) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Version ${state.version} is available.`;
    case "downloading":
      return `Downloading version ${state.version}… ${Math.round(state.percent ?? 0)}%`;
    case "ready":
      return `Version ${state.version} is ready. Restart to update.`;
    case "error":
      return state.error ?? "Something went wrong while checking for updates. Please try again later.";
    case "idle":
      return state.lastCheckedAt
        ? `Composition ${state.currentVersion}. Already running the latest supported version.`
        : `Composition ${state.currentVersion}. Not checked yet.`;
  }
}

/** Whether something is waiting on the person: an update to download, or one to restart into. */
export function updateNeedsAttention(state: UpdateState): boolean {
  return state.supported && (state.phase === "available" || state.phase === "ready");
}
