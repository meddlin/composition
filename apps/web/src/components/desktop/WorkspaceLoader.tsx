"use client";

import { NotesApp } from "@/components/notes/NotesApp";
import { createWorkspace } from "@/components/notes/workspaceInstance";
import { loadWorkspace } from "@/lib/composition/client";
import * as panels from "@/lib/composition/panelsClient";
import { LoadFailed } from "./LoadFailed";
import { keepWorkspace } from "./keptWorkspace";
import { loadPanelsToRestore } from "./panelsRestore";
import { publishWorkspace } from "./popoutLink";
import { useLoaded } from "./useLoaded";

/**
 * Desktop home: load the workspace over IPC, bring the kept workspace up to date with it (or make it, the first
 * time), then render the same NotesApp as the web. The kept workspace is what lets the open panes survive a visit
 * to Settings.
 */
export function WorkspaceLoader() {
  const workspace = useLoaded(async () => {
    const data = await loadWorkspace();
    // Only the first visit makes the workspace and needs them; a later one keeps the panels it has.
    const restore = await loadPanelsToRestore(data.notes, panels);
    const store = keepWorkspace(data, (fresh) => createWorkspace(fresh, restore));
    // Pop-outs read the editor's settings from here; they may have changed in Settings since the workspace was made.
    publishWorkspace({ store, writing: data.writing });
    return { data, store };
  });

  if (workspace.status === "error") {
    return <LoadFailed what="your notes" message={workspace.message} />;
  }
  if (workspace.status === "loading") {
    return <div aria-busy="true" className="h-screen" />;
  }
  const { data, store } = workspace.value;
  return (
    <NotesApp
      store={store}
      initialNotes={data.notes}
      initialGroups={data.groups}
      initialNotebooks={data.notebooks}
      initialLayout={data.layout}
      initialFavorites={data.favorites}
      initialWriting={data.writing}
      initialHome={data.home}
    />
  );
}
