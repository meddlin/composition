import { DEFAULT_PLUGIN_SETTINGS, PLUGINS, type PluginId, type PluginSettings } from "./plugins";
import type { CompositionApi } from "./api";

/** What the store reaches outside for: where the choice is saved. */
export type PluginsDeps = Pick<CompositionApi, "savePluginSettings">;

export type PluginsSnapshot = {
  enabled: PluginSettings;
  /** Why the last change could not be saved, until the next one is. */
  error: string | null;
};

export type PluginsStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PluginsSnapshot;
  /** Shows the change at once, in every window that holds this store, and saves it; a refused save is undone and reported. */
  setEnabled(id: PluginId, enabled: boolean): Promise<{ error?: string }>;
  /** Takes the saved version (for a workspace kept while the user was in Settings). Nothing is saved. */
  replace(enabled: PluginSettings): void;
};

const reason = (error: unknown) => (error instanceof Error ? error.message : "The plugin setting could not be saved.");

/**
 * Which plugins are on, with no React in it, so every panel and settings screen in every window sees one answer. The
 * workspace holds one; Settings uses it when a workspace exists and makes its own when it does not.
 */
export function createPluginsStore(deps: PluginsDeps, initial: PluginSettings = DEFAULT_PLUGIN_SETTINGS): PluginsStore {
  let state: PluginsSnapshot = { enabled: initial, error: null };
  const listeners = new Set<() => void>();

  function set(next: Partial<PluginsSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  async function setEnabled(id: PluginId, enabled: boolean): Promise<{ error?: string }> {
    if (state.enabled[id] === enabled) return {};
    const previous = state.enabled;
    const next = { ...previous, [id]: enabled };
    set({ enabled: next, error: null });
    try {
      const result = await deps.savePluginSettings(next);
      if (result.error) throw new Error(result.error);
      return {};
    } catch (error) {
      set({ enabled: previous, error: reason(error) });
      return { error: reason(error) };
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    setEnabled,
    replace(enabled) {
      if (PLUGINS.every(({ id }) => state.enabled[id] === enabled[id])) return;
      set({ enabled });
    },
  };
}

/** For a workspace with nowhere to save the choice (tests, and the web app, which has no plugin that does anything): it is only remembered while the page is open. */
export const unsavedPlugins: PluginsDeps = { savePluginSettings: async () => ({}) };
