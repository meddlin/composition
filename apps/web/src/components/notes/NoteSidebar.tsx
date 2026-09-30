"use client";

import Link from "next/link";
import { useState } from "react";
import { GroupTree, InlineTextInput } from "./GroupTree";
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
  onCreate: () => void;
  onDelete: (id: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
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
  onMoveNoteToGroup,
}: Props) {
  const [addingGroup, setAddingGroup] = useState(false);

  return (
    <nav
      aria-label="Notes"
      style={{ width }}
      className="flex shrink-0 flex-col bg-surface"
    >
      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80"
        >
          + New note
        </button>
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
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            className="w-full rounded-md border border-foreground/15 px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-foreground/5"
          >
            + New group
          </button>
        )}
        {groupError && <p className="text-xs text-error">{groupError}</p>}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <GroupTree
          groups={groups}
          notes={notes}
          activeId={activeId}
          viewedGroupId={viewedGroupId}
          onSelectNote={onSelect}
          onSelectGroup={onSelectGroup}
          onDeleteNote={onDelete}
          onCreateGroup={onCreateGroup}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onMoveNoteToGroup={onMoveNoteToGroup}
        />
      </div>
      <div className="border-t border-foreground/10 p-3">
        <Link
          href="/settings"
          className="block rounded-md px-3 py-2 text-sm text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
        >
          Settings
        </Link>
      </div>
    </nav>
  );
}
