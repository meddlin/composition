"use client";

import { BookOpenIcon, CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Favorites, FavoriteType } from "@/lib/composition/favorites";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupTree, InlineTextInput, type RevealRequest } from "./GroupTree";
import { setNoteDatePrefs, useNoteDatePrefs } from "./noteDatePrefs";
import type { Group, Note, Notebook } from "./types";

type Props = {
  notes: Note[];
  groups: Group[];
  notebooks: Notebook[];
  notebookId: number;
  /** Set only while the notebook list is collapsed, when nothing else says which notebook is open. */
  collapsedNotebookName?: string;
  onExpandNotebooks: () => void;
  activeId: number | null;
  viewedGroupId: number | null;
  /** Opens the groups above a note and scrolls it into view, e.g. after picking it from search. */
  reveal: RevealRequest | null;
  onRevealed: () => void;
  width: number;
  groupError: string | null;
  favorites: Favorites;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  onSelect: (id: number) => void;
  onOpenBeside: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onCreate: (groupId: number | null) => void;
  onDelete: (id: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveGroup: (id: number, parentId: number | null) => void;
  onPlaceNote: (noteId: number, groupId: number | null, beforeNoteId: number | null) => void;
  onPlaceGroup: (id: number, parentId: number | null, beforeGroupId: number | null) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
  onMoveGroupToNotebook: (id: number, notebookId: number) => void;
};

export function NoteSidebar({
  notes,
  groups,
  notebooks,
  notebookId,
  collapsedNotebookName,
  onExpandNotebooks,
  activeId,
  viewedGroupId,
  reveal,
  onRevealed,
  width,
  groupError,
  favorites,
  onToggleFavorite,
  onSelect,
  onOpenBeside,
  onSelectGroup,
  onCreate,
  onDelete,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onPlaceNote,
  onPlaceGroup,
  onMoveNoteToGroup,
  onMoveGroupToNotebook,
}: Props) {
  const [addingGroup, setAddingGroup] = useState(false);
  const dates = useNoteDatePrefs();

  return (
    <nav
      aria-label="Notes"
      style={{ width }}
      className="flex shrink-0 flex-col bg-surface"
    >
      {collapsedNotebookName !== undefined && (
        <div className="p-2">
          <Button
            variant="ghost"
            size="lg"
            className="w-full justify-start font-semibold"
            aria-label={`Notebook: ${collapsedNotebookName}`}
            title="Show notebooks"
            onClick={onExpandNotebooks}
          >
            <BookOpenIcon className="text-muted-foreground" />
            <span className="truncate">{collapsedNotebookName}</span>
          </Button>
        </div>
      )}
      <div className="flex justify-end px-2 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Note display options" title="Display">
              <CalendarIcon className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>Show under note name</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={dates.updated}
              onCheckedChange={(checked) => setNoteDatePrefs({ updated: checked === true })}
            >
              Last updated
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={dates.created}
              onCheckedChange={(checked) => setNoteDatePrefs({ created: checked === true })}
            >
              Created
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 overflow-y-auto pb-2 pl-2 pr-[7px]">
        <GroupTree
          groups={groups}
          notes={notes}
          notebooks={notebooks}
          currentNotebookId={notebookId}
          onMoveGroupToNotebook={onMoveGroupToNotebook}
          activeId={activeId}
          viewedGroupId={viewedGroupId}
          reveal={reveal}
          onRevealed={onRevealed}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onSelectNote={onSelect}
          onOpenNoteBeside={onOpenBeside}
          onSelectGroup={onSelectGroup}
          onDeleteNote={onDelete}
          onCreateNote={onCreate}
          onCreateGroup={onCreateGroup}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onMoveGroup={onMoveGroup}
          onMoveNoteToGroup={onMoveNoteToGroup}
          onPlaceNote={onPlaceNote}
          onPlaceGroup={onPlaceGroup}
        />
        <div className="flex flex-col gap-1 py-2">
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground hover:text-foreground" onClick={() => onCreate(null)}>
            + New note
          </Button>
          {addingGroup ? (
            <InlineTextInput
              depth={0}
              placeholder="Group name"
              onSubmit={(name) => {
                onCreateGroup(name, null);
                setAddingGroup(false);
              }}
              onCancel={() => setAddingGroup(false)}
            />
          ) : (
            <Button variant="ghost" size="sm" className="justify-start text-muted-foreground hover:text-foreground" onClick={() => setAddingGroup(true)}>
              + New group
            </Button>
          )}
          {groupError && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs text-destructive">{groupError}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </nav>
  );
}
