"use client";

import { NotesApp } from "@/components/notes/NotesApp";
import { loadWorkspace } from "@/lib/composition/client";
import { LoadFailed } from "./LoadFailed";
import { useLoaded } from "./useLoaded";

/** Desktop home: load the workspace over IPC, then render the same NotesApp as the web. */
export function WorkspaceLoader() {
  const workspace = useLoaded(loadWorkspace);

  if (workspace.status === "error") {
    return <LoadFailed what="your notes" message={workspace.message} />;
  }
  if (workspace.status === "loading") {
    return <div aria-busy="true" className="h-screen" />;
  }
  const { notes, groups, layout, favorites } = workspace.value;
  return (
    <NotesApp
      initialNotes={notes}
      initialGroups={groups}
      initialLayout={layout}
      initialFavorites={favorites}
    />
  );
}
