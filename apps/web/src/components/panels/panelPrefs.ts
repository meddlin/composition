import { useSyncExternalStore } from "react";
import { LAUNCHERS, type LauncherKind } from "./launchers";

/**
 * Preferences about panels, kept in `localStorage` like the sidebar's other per-viewer conveniences (never required,
 * and the storage can be blocked).
 */

const STORAGE_KEY = "composition.panels";

export type PanelPrefs = {
  /** Ask before a note is shown in a second panel on purpose (Open to the side, or a drop on a panel). */
  warnDuplicateNotePanels: boolean;
  /** Show the rail of icons that open a panel, beside the notebooks. Off for someone who works from the keyboard. */
  showPluginRail: boolean;
  /**
   * The launchers the user took off the rail. It lists the hidden ones, not the shown ones, so a launcher added later
   * appears by default. It is about the rail only: a hidden kind is still in the palette and the empty panel, and its
   * plugin is as on or off as before.
   */
  hiddenRailKinds: readonly LauncherKind[];
};

const DEFAULTS: PanelPrefs = { warnDuplicateNotePanels: true, showPluginRail: true, hiddenRailKinds: [] };

/** The launcher kinds in a stored list, each once, in the order of `LAUNCHERS`; anything else (a kind since removed, junk) is dropped. */
function readHiddenKinds(value: unknown): readonly LauncherKind[] {
  if (!Array.isArray(value)) return DEFAULTS.hiddenRailKinds;
  return LAUNCHERS.filter((launcher) => value.includes(launcher.kind)).map((launcher) => launcher.kind);
}

/** Whatever is stored, reduced to valid preferences; anything unreadable gives the defaults. */
export function parsePanelPrefs(raw: string | null): PanelPrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof PanelPrefs, unknown>> | null;
    return {
      warnDuplicateNotePanels:
        typeof value?.warnDuplicateNotePanels === "boolean" ? value.warnDuplicateNotePanels : DEFAULTS.warnDuplicateNotePanels,
      showPluginRail: typeof value?.showPluginRail === "boolean" ? value.showPluginRail : DEFAULTS.showPluginRail,
      hiddenRailKinds: readHiddenKinds(value?.hiddenRailKinds),
    };
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
// Memory is the source of truth while the page is open, so a blocked or full storage still works.
let current: PanelPrefs | null = null;

function load(): PanelPrefs {
  if (current) return current;
  try {
    current = parsePanelPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(change: Partial<PanelPrefs>): void {
  current = { ...load(), ...change };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Not remembered next time.
  }
  listeners.forEach((listener) => listener());
}

export function setWarnDuplicateNotePanels(warn: boolean): void {
  update({ warnDuplicateNotePanels: warn });
}

/** Whether to ask before showing a note in a second panel. */
export function useWarnDuplicateNotePanels(): boolean {
  return useSyncExternalStore(subscribe, () => load().warnDuplicateNotePanels, () => DEFAULTS.warnDuplicateNotePanels);
}

export function setShowPluginRail(show: boolean): void {
  update({ showPluginRail: show });
}

/** Turns the rail on if it is off and off if it is on (the palette's Toggle Plugin Rail). */
export function toggleShowPluginRail(): void {
  update({ showPluginRail: !load().showPluginRail });
}

/** Whether the rail of panel icons is shown at all. */
export function useShowPluginRail(): boolean {
  return useSyncExternalStore(subscribe, () => load().showPluginRail, () => DEFAULTS.showPluginRail);
}

/** Takes a launcher off the rail, or puts it back. Nothing else about it changes. */
export function setRailKindHidden(kind: LauncherKind, hidden: boolean): void {
  const kept = load().hiddenRailKinds.filter((k) => k !== kind);
  update({ hiddenRailKinds: readHiddenKinds(hidden ? [...kept, kind] : kept) });
}

/** The launchers the user took off the rail (the same array until it changes, as a store snapshot has to be). */
export function useHiddenRailKinds(): readonly LauncherKind[] {
  return useSyncExternalStore(subscribe, () => load().hiddenRailKinds, () => DEFAULTS.hiddenRailKinds);
}

/** Test hook: forget what this page has loaded, so the next read goes back to storage. */
export function resetPanelPrefs(): void {
  current = null;
  listeners.forEach((listener) => listener());
}
