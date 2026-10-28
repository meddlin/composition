"use client";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { PLUGINS, type PluginId } from "@/lib/composition/plugins";
import type { WorkspaceStore } from "../notes/workspaceStore";

/**
 * What a panel of a plugin that is turned off shows. The panel stays where it is, with what it saved (the plugin's data is
 * untouched), so turning the plugin back on, here or in Settings > Plugins, brings it back as it was.
 */
export function PluginOffPanel({ store, plugin }: { store: WorkspaceStore; plugin: PluginId }) {
  const name = PLUGINS.find(({ id }) => id === plugin)?.name ?? plugin;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>The {name} plugin is turned off.</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" variant="outline" onClick={() => void store.plugins.setEnabled(plugin, true)}>
        Turn on {name}
      </Button>
    </Empty>
  );
}
