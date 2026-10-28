"use client";

import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteSidebar } from "../notes/NoteSidebar";
import type { WorkspaceSnapshot, WorkspaceStore } from "../notes/workspaceStore";
import type { PanelHost } from "./host";
import type { NotesBrowserState } from "./kinds";
import type { PanelId } from "./layoutTree";
import { focusedPanelId, windowOf } from "./panelsState";
import { noteIdOf } from "./kinds";

type Props = {
  store: WorkspaceStore;
  panelId: PanelId;
  state: NotesBrowserState;
  snapshot: WorkspaceSnapshot;
  host: PanelHost;
};

/**
 * A second list of notebooks and notes, with its own chosen notebook. The notebook list is a menu rather than a column,
 * since a panel is narrower than the window. Picking a note opens it in the note panel of this window that was used
 * last (or beside the browser if there is none); the fixed sidebar does the same.
 */
export function NotesBrowserPanel({ store, panelId, state, snapshot, host }: Props) {
  const { notes, groups, notebooks, favorites, panels } = snapshot;
  const notebook = notebooks.find((n) => n.id === state.notebookId) ?? notebooks[0];
  const windowId = windowOf(panels, panelId) ?? "main";
  const focusedNoteId = noteIdOf(panels.byId[focusedPanelId(panels.windows[windowId])]);
  const { sidebar } = host;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="lg"
              className="w-full justify-start font-semibold"
              aria-label={`Notebook: ${notebook.name}`}
              title="Choose the notebook this browser lists"
            >
              <BookOpenIcon className="text-muted-foreground" />
              <span className="truncate">{notebook.name}</span>
              <ChevronDownIcon className="ml-auto text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={String(notebook.id)}
              onValueChange={(id) => store.setPanelState(panelId, { notebookId: Number(id) } satisfies NotesBrowserState)}
            >
              {notebooks.map((n) => (
                <DropdownMenuRadioItem key={n.id} value={String(n.id)}>
                  {n.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NoteSidebar
        notes={notes.filter((n) => n.notebookId === notebook.id)}
        groups={groups.filter((g) => g.notebookId === notebook.id)}
        notebooks={notebooks}
        notebookId={notebook.id}
        onExpandNotebooks={() => {}}
        activeId={focusedNoteId}
        viewedGroupId={null}
        reveal={null}
        onRevealed={() => {}}
        width="fill"
        groupError={sidebar.groupError}
        favorites={favorites}
        onToggleFavorite={sidebar.onToggleFavorite}
        onSelect={(noteId) => store.openNote(noteId, windowId)}
        onOpenBeside={host.onOpenNoteBeside}
        onSelectGroup={sidebar.onSelectGroup}
        onCreate={(groupId) => sidebar.onCreate(groupId, notebook.id)}
        onDelete={sidebar.onDelete}
        onCreateGroup={(name, parentId) => sidebar.onCreateGroup(name, parentId, notebook.id)}
        onRenameGroup={sidebar.onRenameGroup}
        onDeleteGroup={sidebar.onDeleteGroup}
        onMoveGroup={sidebar.onMoveGroup}
        onPlaceNote={sidebar.onPlaceNote}
        onPlaceGroup={sidebar.onPlaceGroup}
        onMoveNoteToGroup={sidebar.onMoveNoteToGroup}
        onMoveGroupToNotebook={sidebar.onMoveGroupToNotebook}
      />
    </div>
  );
}
