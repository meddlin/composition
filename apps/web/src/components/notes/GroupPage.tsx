"use client";

import { buildGroupListing, groupPath, type GroupListing } from "./groupListing";
import { noteTitle, type Group, type Note } from "./types";

type Props = {
  groupId: number;
  groups: Group[];
  notes: Note[];
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
};

/** Read-only overview of a group: every sub-group and note beneath it, nested. */
export function GroupPage({ groupId, groups, notes, onSelectNote, onSelectGroup }: Props) {
  const listing = buildGroupListing(groupId, groups, notes);
  if (!listing) return null;

  const ancestors = groupPath(groupId, groups).slice(0, -1);
  const isEmpty = listing.subgroups.length === 0 && listing.notes.length === 0;

  return (
    <main aria-label={`Group ${listing.group.name}`} className="min-w-0 flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        {ancestors.length > 0 && (
          <nav aria-label="Group path" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-foreground/50">
            {ancestors.map((g) => (
              <span key={g.id} className="flex items-center gap-1">
                <button type="button" onClick={() => onSelectGroup(g.id)} className="hover:text-foreground hover:underline">
                  {g.name}
                </button>
                <span aria-hidden>/</span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold">{listing.group.name}</h1>
        <p className="mt-1 text-sm text-foreground/60">
          {countLabel(listing.totalNotes, "note")}
          {listing.subgroups.length > 0 && `, ${countLabel(listing.subgroups.length, "sub-group")}`}
        </p>

        {isEmpty ? (
          <p className="mt-8 text-sm text-foreground/60">This group is empty.</p>
        ) : (
          <div className="mt-6">
            <ListingBody listing={listing} depth={0} onSelectNote={onSelectNote} onSelectGroup={onSelectGroup} />
          </div>
        )}
      </div>
    </main>
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
    <ul className={depth === 0 ? "flex flex-col gap-0.5" : "ml-3 flex flex-col gap-0.5 border-l border-foreground/10 pl-3"}>
      {listing.subgroups.map((sub) => (
        <li key={`group-${sub.group.id}`}>
          <button
            type="button"
            onClick={() => onSelectGroup(sub.group.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold hover:bg-foreground/5"
          >
            <FolderIcon />
            <span className="min-w-0 flex-1 truncate">{sub.group.name}</span>
            <span className="text-xs font-normal text-foreground/50">{sub.totalNotes}</span>
          </button>
          <ListingBody listing={sub} depth={depth + 1} onSelectNote={onSelectNote} onSelectGroup={onSelectGroup} />
        </li>
      ))}
      {listing.notes.map((note) => (
        <li key={`note-${note.id}`}>
          <button
            type="button"
            onClick={() => onSelectNote(note.id)}
            className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5"
          >
            {noteTitle(note)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function FolderIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="var(--accent)"
      fillOpacity={0.35}
      stroke="var(--accent)"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
