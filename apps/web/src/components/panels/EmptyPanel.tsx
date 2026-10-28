"use client";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import type { PanelId } from "./layoutTree";
import type { KindId } from "./panelsState";
import type { WorkspaceStore } from "../notes/workspaceStore";

/** The kinds an empty panel offers to become, in the order they are listed. */
const CHOICES: { kind: Exclude<KindId, "empty">; label: string }[] = [
  { kind: "note", label: "Note" },
  { kind: "notes-browser", label: "Notes browser" },
  { kind: "ai", label: "AI helper" },
];

/**
 * A panel with nothing in it yet: a place to arrange the window before filling it. Choosing a kind turns the panel
 * into that kind; a note dropped on it, or picked in the sidebar while it is focused, fills it too.
 */
export function EmptyPanel({ store, panelId }: { store: WorkspaceStore; panelId: PanelId }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>What should this panel show?</EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap justify-center gap-2">
        {CHOICES.map(({ kind, label }) => (
          <Button key={kind} variant="outline" size="sm" onClick={() => store.setPanelKind(panelId, kind)}>
            {label}
          </Button>
        ))}
      </div>
    </Empty>
  );
}
