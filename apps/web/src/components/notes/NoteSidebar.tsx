"use client";

import { BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Favorites, FavoriteType } from "@/lib/composition/favorites";
import { Separator } from "@/components/ui/separator";
import { GroupTree, InlineTextInput } from "./GroupTree";
import { NAV_LINKS } from "./navLinks";
import { UpdateDot } from "./UpdateDot";
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
      <div className="flex-1 overflow-y-auto pb-2 pl-2 pr-[7px]">
        <GroupTree
          groups={groups}
          notes={notes}
          notebooks={notebooks}
          currentNotebookId={notebookId}
          onMoveGroupToNotebook={onMoveGroupToNotebook}
          activeId={activeId}
          viewedGroupId={viewedGroupId}
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
      </div>
      <Separator />
      <div className="flex flex-col gap-2 p-3">
        <Button size="lg" className="w-full" onClick={() => onCreate(null)}>
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
          <Button variant="outline" size="lg" className="w-full" onClick={() => setAddingGroup(true)}>
            + New group
          </Button>
        )}
        {groupError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs text-destructive">{groupError}</AlertDescription>
          </Alert>
        )}
      </div>
      <Separator />
      <div className="flex flex-col gap-1 p-3">
        {NAV_LINKS.map(({ href, label }) => (
          <Button
            key={href}
            asChild
            variant="ghost"
            size="lg"
            className="justify-start px-3 text-muted-foreground hover:text-foreground"
          >
            <Link href={href}>
              {label}
              {href === "/settings" && <UpdateDot />}
            </Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
