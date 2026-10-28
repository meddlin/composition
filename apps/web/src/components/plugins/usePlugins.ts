import { useSyncExternalStore } from "react";
import type { PluginId } from "@/lib/composition/plugins";
import type { PluginsSnapshot, PluginsStore } from "@/lib/composition/pluginsStore";

/** The plugins' state, kept current as it changes. */
export function usePlugins(store: PluginsStore): PluginsSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Whether one plugin is on. */
export function usePluginEnabled(store: PluginsStore, id: PluginId): boolean {
  return usePlugins(store).enabled[id];
}
