"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { GroupTree, InlineTextInput } from "./GroupTree";
import { NAV_LINKS } from "./navLinks";
import type { Group, Note } from "./types";

type Props = {
  notes: Note[];
  groups: Group[];
  activeId: number | null;
  viewedGroupId: number | null;
  width: number;
  groupError: string | null;
  onSelect: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onCreate: (groupId: number | null) => void;
  onDelete: (id: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveGroup: (id: number, parentId: number | null) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
};

export function NoteSidebar({
  notes,
  groups,
  activeId,
  viewedGroupId,
  width,
  groupError,
  onSelect,
  onSelectGroup,
  onCreate,
  onDelete,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onMoveNoteToGroup,
}: Props) {
  const [addingGroup, setAddingGroup] = useState(false);

  return (
    <nav
      aria-label="Notes"
      style={{ width }}
      className="flex shrink-0 flex-col bg-surface"
    >
      <div className="flex-1 overflow-y-auto pb-2 pl-2 pr-[7px]">
        <GroupTree
          groups={groups}
          notes={notes}
          activeId={activeId}
          viewedGroupId={viewedGroupId}
          onSelectNote={onSelect}
          onSelectGroup={onSelectGroup}
          onDeleteNote={onDelete}
          onCreateNote={onCreate}
          onCreateGroup={onCreateGroup}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onMoveGroup={onMoveGroup}
          onMoveNoteToGroup={onMoveNoteToGroup}
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
            <Link href={href}>{label}</Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
