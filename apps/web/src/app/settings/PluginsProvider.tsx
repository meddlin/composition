"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePluginEnabled } from "@/components/plugins/usePlugins";
import { savePluginSettings } from "@/lib/composition/client";
import { DEFAULT_PLUGIN_SETTINGS, type PluginId, type PluginSettings } from "@/lib/composition/plugins";
import { createPluginsStore, unsavedPlugins, type PluginsStore } from "@/lib/composition/pluginsStore";

// Without a provider (a settings section shown on its own) every plugin is on, as it is before anything is chosen.
const PluginsContext = createContext<PluginsStore>(createPluginsStore(unsavedPlugins, DEFAULT_PLUGIN_SETTINGS));

/**
 * Gives the Settings screen one answer to "which plugins are on", so the Plugins tab and the sections a plugin adds
 * to other tabs (the to-do background under Styling) change together. When the desktop app's workspace exists the answer
 * is the workspace's, so the open panels, in every window, follow a change at once; otherwise it is the saved
 * settings, kept here.
 */
export function PluginsProvider({ initial, children }: { initial: PluginSettings; children: ReactNode }) {
  const [store] = useState(() => {
    const workspace = typeof window === "undefined" ? undefined : window.__workspace?.store.plugins;
    return workspace ?? createPluginsStore({ savePluginSettings }, initial);
  });
  return <PluginsContext.Provider value={store}>{children}</PluginsContext.Provider>;
}

export function usePluginsStore(): PluginsStore {
  return useContext(PluginsContext);
}

/** Whether one plugin is on, for a section of Settings that belongs to it. */
export function useSettingsPluginEnabled(id: PluginId): boolean {
  return usePluginEnabled(useContext(PluginsContext), id);
}
