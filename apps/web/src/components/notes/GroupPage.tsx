"use client";

import { Fragment, useRef, useState } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { FolderIcon } from "./FolderIcon";
import { buildGroupListing, groupPath, type GroupListing } from "./groupListing";
import { noteTitle, type Group, type Note } from "./types";

type Props = {
  groupId: number;
  groups: Group[];
  notes: Note[];
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onRenameGroup: (id: number, name: string) => void;
};

/**
 * Overview of a group: every sub-group and note beneath it, nested. The title
 * is the one editable part — it renames the group.
 */
export function GroupPage({ groupId, groups, notes, onSelectNote, onSelectGroup, onRenameGroup }: Props) {
  const listing = buildGroupListing(groupId, groups, notes);
  if (!listing) return null;

  const ancestors = groupPath(groupId, groups).slice(0, -1);
  const isEmpty = listing.subgroups.length === 0 && listing.notes.length === 0;

  return (
    <main aria-label={`Group ${listing.group.name}`} className="min-w-0 flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        {ancestors.length > 0 && (
          <Breadcrumb aria-label="Group path" className="mb-2">
            <BreadcrumbList className="gap-1 text-xs">
              {ancestors.map((g) => (
                <Fragment key={g.id}>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={() => onSelectGroup(g.id)} className="hover:underline">
                        {g.name}
                      </button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <GroupTitle
          key={listing.group.id}
          name={listing.group.name}
          onRename={(name) => onRenameGroup(listing.group.id, name)}
        />
        <p className="mt-1 text-sm text-muted-foreground">
          {countLabel(listing.totalNotes, "note")}
          {listing.subgroups.length > 0 && `, ${countLabel(listing.subgroups.length, "sub-group")}`}
        </p>

        {isEmpty ? (
          <Empty className="mt-8 border">
            <EmptyDescription>This group is empty.</EmptyDescription>
          </Empty>
        ) : (
          <div className="mt-6">
            <ListingBody listing={listing} depth={0} onSelectNote={onSelectNote} onSelectGroup={onSelectGroup} />
          </div>
        )}
      </div>
    </main>
  );
}

function GroupTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // Enter/Escape unmount the input, which can fire a trailing blur; only the
  // first way of leaving the field counts.
  const settled = useRef(false);

  function startEditing() {
    settled.current = false;
    setDraft(name);
    setEditing(true);
  }

  function finish(commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    const trimmed = draft.trim();
    if (commit && trimmed !== "" && trimmed !== name) onRename(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        type="text"
        autoFocus
        aria-label="Group name"
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
        className="h-auto px-2 py-0.5 text-2xl font-bold md:text-2xl"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="min-w-0 truncate text-2xl font-bold">{name}</h1>
      <Button
        variant="ghost"
        size="xs"
        onClick={startEditing}
        aria-label={`Rename ${name}`}
        title="Rename group"
        className="text-muted-foreground hover:text-foreground"
      >
        Rename
      </Button>
    </div>
  );
}

function ListingBody({
  listing,
  depth,
  onSelectNote,
  onSelectGroup,
}: {
  listing: GroupListing;
  depth: number;
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
}) {
  return (
    <ul className={depth === 0 ? "flex flex-col gap-0.5" : "ml-3 flex flex-col gap-0.5 border-l pl-3"}>
      {listing.subgroups.map((sub) => (
        <li key={`group-${sub.group.id}`}>
          <Button
            variant="ghost"
            onClick={() => onSelectGroup(sub.group.id)}
            className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-semibold"
          >
            <FolderIcon />
            <span className="min-w-0 flex-1 truncate text-left">{sub.group.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{sub.totalNotes}</span>
          </Button>
          <ListingBody listing={sub} depth={depth + 1} onSelectNote={onSelectNote} onSelectGroup={onSelectGroup} />
        </li>
      ))}
      {listing.notes.map((note) => (
        <li key={`note-${note.id}`}>
          <Button
            variant="ghost"
            onClick={() => onSelectNote(note.id)}
            className="h-auto w-full justify-start px-2 py-1.5"
          >
            <span className="truncate">{noteTitle(note)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
