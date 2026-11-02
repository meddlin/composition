"use client";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import type { PanelId } from "./layoutTree";
import { availableLaunchers } from "./launchers";
import { usePlugins } from "../plugins/usePlugins";
import type { KindId } from "./panelsState";
import type { WorkspaceStore } from "../notes/workspaceStore";

/**
 * A panel with nothing in it yet: a place to arrange the window before filling it. Choosing a kind turns the panel
 * into that kind; a note dropped on it, or picked in the sidebar while it is focused, fills it too.
 */
export function EmptyPanel({ store, panelId }: { store: WorkspaceStore; panelId: PanelId }) {
  const { enabled } = usePlugins(store.plugins);
  // Note comes first and is not a launcher; a kind that belongs to a plugin that is off is not offered.
  const choices: { kind: Exclude<KindId, "empty">; label: string }[] = [
    { kind: "note", label: "Note" },
    ...availableLaunchers(enabled).map(({ kind, label }) => ({ kind, label })),
  ];
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>What should this panel show?</EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap justify-center gap-2">
        {choices.map(({ kind, label }) => (
          <Button key={kind} variant="outline" size="sm" onClick={() => store.setPanelKind(panelId, kind)}>
            {label}
          </Button>
        ))}
      </div>
    </Empty>
  );
}
