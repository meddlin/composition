"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { usePlugins } from "../plugins/usePlugins";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { focusPanelElement } from "./focusPanelElement";
import { availableLaunchers } from "./launchers";
import { setRailKindHidden, useHiddenRailKinds, useShowPluginRail } from "./panelPrefs";
import { MAIN_WINDOW } from "./panelsState";

/**
 * A narrow column of icons, one for each kind of panel that can be opened, beside the notebooks. Clicking one opens it in
 * the main window the way the palette's Open command does. An icon is there when its plugin is on and the user has not
 * taken it off the rail; the whole rail is gone when the user turned it off, or no icon is left. Neither choice removes
 * the palette's command or the empty panel's button, so the rail is a convenience, never the only way in.
 *
 * `showPanels` is called after a panel was opened, for the Home and group pages that take the panels' place.
 */
export function PluginRail({ store, showPanels }: { store: WorkspaceStore; showPanels?: () => void }) {
  const { enabled } = usePlugins(store.plugins);
  const show = useShowPluginRail();
  const hidden = useHiddenRailKinds();
  const { panels } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const launchers = availableLaunchers(enabled).filter((launcher) => !hidden.includes(launcher.kind));
  if (!show || launchers.length === 0) return null;

  const mainWindow = panels.windows[MAIN_WINDOW];
  const open = new Set(mainWindow?.focusOrder.map((id) => panels.byId[id].kind));

  function launch(kind: (typeof launchers)[number]["kind"]) {
    const panelId = store.openKind(kind, MAIN_WINDOW);
    if (panelId === null) return;
    showPanels?.();
    // The panel is drawn on the next frame; the cursor goes into it, as after a palette command.
    requestAnimationFrame(() => focusPanelElement(panelId));
  }

  return (
    <nav aria-label="Plugins" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
      {launchers.map(({ kind, label, icon: Icon }) => {
        const isOpen = open.has(kind);
        return (
          <ContextMenu key={kind}>
            <ContextMenuTrigger asChild>
              <Button
                variant={isOpen ? "secondary" : "ghost"}
                size="icon"
                aria-label={label}
                aria-pressed={isOpen}
                title={label}
                className={cn("relative", !isOpen && "text-muted-foreground hover:text-foreground")}
                onClick={() => launch(kind)}
              >
                {isOpen && <span aria-hidden className="absolute -left-2 top-1.5 h-5 w-0.5 rounded-full bg-foreground" />}
                <Icon />
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => setRailKindHidden(kind, true)}>Hide from Rail</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </nav>
  );
}
