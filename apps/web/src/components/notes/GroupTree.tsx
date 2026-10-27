"use client";

import { ChevronRightIcon, StarIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { isFavorite, type Favorites, type FavoriteType } from "@/lib/composition/favorites";
import { canMoveGroup, canPlaceGroup } from "@/lib/composition/groupMove";
import { cn } from "@/lib/utils";
import { dropEdge, type DropEdge } from "./dropEdge";
import { GROUP_DRAG_TYPE, NOTE_DRAG_TYPE } from "./dragTypes";
import { FolderIcon } from "./FolderIcon";
import { GroupMenu } from "./GroupMenu";
import { NoteMenu } from "./NoteMenu";
import { noteTitle, type Group, type Note, type Notebook } from "./types";

// Overlays a row's buttons instead of reserving space, so names can run right up to the edge.
// Stays visible while a menu is open: its popup is portaled out, so the row is no longer
// hovered or focused.
const ROW_ACTIONS_CLASS =
  "pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-md bg-surface opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100";

/** A request to bring a note's row into view; a new `nonce` is a new request, even for the same note. */
export type RevealRequest = { noteId: number; nonce: number };

type Reveal = {
  noteId: number;
  nonce: number;
  /** The groups the note sits in, which must be open for its row to exist. */
  ancestorIds: ReadonlySet<number>;
  /** Called once the row has been scrolled to, which ends the request. */
  done: () => void;
};

type TreeProps = {
  groups: Group[];
  notes: Note[];
  /** Every notebook, for "Move to notebook"; the tree itself shows only the groups and notes it is given. */
  notebooks: Notebook[];
  currentNotebookId: number;
  activeId: number | null;
  viewedGroupId: number | null;
  /** When set, opens the groups above the note and scrolls its row into view. */
  reveal?: RevealRequest | null;
  /** Called when the revealed note's row has been scrolled to, so the request can be dropped. */
  onRevealed?: () => void;
  favorites: Favorites;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  onSelectNote: (id: number) => void;
  onOpenNoteBeside: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onCreateNote: (groupId: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveGroup: (id: number, parentId: number | null) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
  /** Moves the group, with everything in it, to the top level of another notebook. */
  onMoveGroupToNotebook: (id: number, notebookId: number) => void;
  /** Files the note in the group (null = ungrouped) just before a sibling note, or last when that is null. */
  onPlaceNote: (noteId: number, groupId: number | null, beforeNoteId: number | null) => void;
  /** Same for a group among its parent's sub-groups. */
  onPlaceGroup: (id: number, parentId: number | null, beforeGroupId: number | null) => void;
};

export function GroupTree({
  groups,
  notes,
  notebooks,
  currentNotebookId,
  activeId,
  viewedGroupId,
  reveal: revealRequest = null,
  onRevealed,
  favorites,
  onToggleFavorite,
  onSelectNote,
  onOpenNoteBeside,
  onSelectGroup,
  onDeleteNote,
  onCreateNote,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onMoveNoteToGroup,
  onMoveGroupToNotebook,
  onPlaceNote,
  onPlaceGroup,
}: TreeProps) {
  // Only one group is ever being dragged; tracked here (dragover can't read the
  // payload) so each row can tell whether it is a legal place to drop it.
  const [draggingGroupId, setDraggingGroupId] = useState<number | null>(null);

  function canDropGroupOn(parentId: number | null): boolean {
    return draggingGroupId !== null && canMoveGroup(groups, draggingGroupId, parentId);
  }

  function canPlaceGroupIn(parentId: number | null): boolean {
    return draggingGroupId !== null && canPlaceGroup(groups, draggingGroupId, parentId);
  }

  function dropGroup(id: number, parentId: number | null) {
    // The moved row remounts under its new parent, so its dragend never fires.
    setDraggingGroupId(null);
    onMoveGroup(id, parentId);
  }

  function placeGroup(id: number, parentId: number | null, beforeId: number | null) {
    setDraggingGroupId(null);
    onPlaceGroup(id, parentId, beforeId);
  }

  const childGroupsByParent = new Map<number | null, Group[]>();
  for (const group of groups) {
    const list = childGroupsByParent.get(group.parentId) ?? [];
    list.push(group);
    childGroupsByParent.set(group.parentId, list);
  }

  const notesByGroup = new Map<number | null, Note[]>();
  for (const note of notes) {
    const list = notesByGroup.get(note.groupId) ?? [];
    list.push(note);
    notesByGroup.set(note.groupId, list);
  }

  function isGroupEmpty(id: number): boolean {
    return (
      (childGroupsByParent.get(id)?.length ?? 0) === 0 &&
      (notesByGroup.get(id)?.length ?? 0) === 0
    );
  }

  let reveal: Reveal | null = null;
  if (revealRequest) {
    const ancestorIds = new Set<number>();
    const groupsById = new Map(groups.map((g) => [g.id, g]));
    let parentId = notes.find((n) => n.id === revealRequest.noteId)?.groupId ?? null;
    while (parentId !== null && !ancestorIds.has(parentId)) {
      ancestorIds.add(parentId);
      parentId = groupsById.get(parentId)?.parentId ?? null;
    }
    reveal = {
      ...revealRequest,
      ancestorIds,
      done: () => onRevealed?.(),
    };
  }

  const shared: SharedProps = {
    childGroupsByParent,
    notesByGroup,
    activeId,
    viewedGroupId,
    reveal,
    favorites,
    onToggleFavorite,
    isGroupEmpty,
    draggingGroupId,
    canDropGroupOn,
    canPlaceGroupIn,
    onDragGroupStart: setDraggingGroupId,
    onDragGroupEnd: () => setDraggingGroupId(null),
    onDropGroup: dropGroup,
    onPlaceGroup: placeGroup,
    onSelectNote,
    onOpenNoteBeside,
    onSelectGroup,
    canDeleteNotes: true,
    onDeleteNote,
    onCreateNote,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
    onMoveNoteToGroup,
    notebooks,
    currentNotebookId,
    onMoveGroupToNotebook,
    onPlaceNote,
  };

  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const notesById = new Map(notes.map((n) => [n.id, n]));

  return (
    <div className="flex flex-col gap-0.5">
      <FavoritesSection shared={shared} groupsById={groupsById} notesById={notesById} />
      {canDropGroupOn(null) && (
        <DropZone onDropGroup={(groupId) => dropGroup(groupId, null)}>
          <div className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1.5 text-center text-xs text-muted-foreground">
            Drop here to move to top level
          </div>
        </DropZone>
      )}
      {(childGroupsByParent.get(null) ?? []).map((group, index, siblings) => (
        <GroupNode
          key={group.id}
          group={group}
          depth={0}
          nextSiblingId={siblings[index + 1]?.id ?? null}
          {...shared}
        />
      ))}

      <DropZone onDropNote={(noteId) => onMoveNoteToGroup(noteId, null)}>
        <div
          style={{ paddingLeft: "8px" }}
          className="rounded-md py-1.5 text-sm font-bold text-muted-foreground"
        >
          Ungrouped
        </div>
      </DropZone>
      {(notesByGroup.get(null) ?? []).map((note, index, siblings) => (
        <NoteRow
          key={note.id}
          note={note}
          depth={1}
          active={note.id === activeId}
          reveal={reveal?.noteId === note.id ? reveal : null}
          favorite={isFavorite(favorites, "note", note.id)}
          onDropNote={(noteId, edge) =>
            onPlaceNote(noteId, null, edge === "before" ? note.id : (siblings[index + 1]?.id ?? null))
          }
          onSelect={() => onSelectNote(note.id)}
          onOpenBeside={() => onOpenNoteBeside(note.id)}
          onDelete={() => onDeleteNote(note.id)}
          onToggleFavorite={() => onToggleFavorite("note", note.id)}
        />
      ))}
    </div>
  );
}

type FavoriteRow = { key: string; group: Group } | { key: string; note: Note };

/**
 * The pinned groups and notes, in the order they were pinned, above the tree.
 * A pinned group is the same expandable node the tree uses, so its sub-groups and
 * notes can be browsed from here; it starts collapsed so a big group doesn't push
 * the rest of the sidebar out of view. Absent when nothing is pinned. An entry
 * whose group or note no longer exists is skipped rather than shown.
 */
function FavoritesSection({
  shared,
  groupsById,
  notesById,
}: {
  shared: SharedProps;
  groupsById: Map<number, Group>;
  notesById: Map<number, Note>;
}) {
  const { favorites, activeId, onSelectNote, onOpenNoteBeside, onToggleFavorite } = shared;
  // Notes are never deleted from here, including those inside a pinned group: the Favorites
  // section is for getting to things, and a stray click there shouldn't destroy a note.
  const favoritesShared: SharedProps = { ...shared, canDeleteNotes: false, reveal: null };
  const rows = favorites.flatMap((favorite): FavoriteRow[] => {
    if (favorite.type === "group") {
      const group = groupsById.get(favorite.id);
      return group ? [{ key: `group-${group.id}`, group }] : [];
    }
    const note = notesById.get(favorite.id);
    return note ? [{ key: `note-${note.id}`, note }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <div role="group" aria-label="Favorites" className="mb-1 flex flex-col gap-0.5 border-b pb-2">
      <div
        style={{ paddingLeft: "8px" }}
        className="flex items-center gap-1.5 py-1.5 text-sm font-bold text-muted-foreground"
      >
        <StarIcon aria-hidden strokeWidth={1.5} className="size-3.5 shrink-0" />
        Favorites
      </div>
      {rows.map((row) =>
        "group" in row ? (
          <GroupNode
            key={row.key}
            group={row.group}
            depth={0}
            defaultCollapsed
            reorderable={false}
            {...favoritesShared}
          />
        ) : (
          <NoteRow
            key={row.key}
            note={row.note}
            depth={1}
            active={row.note.id === activeId}
            favorite
            onSelect={() => onSelectNote(row.note.id)}
            onOpenBeside={() => onOpenNoteBeside(row.note.id)}
            onToggleFavorite={() => onToggleFavorite("note", row.note.id)}
          />
        ),
      )}
    </div>
  );
}

type SharedProps = {
  childGroupsByParent: Map<number | null, Group[]>;
  notesByGroup: Map<number | null, Note[]>;
  activeId: number | null;
  viewedGroupId: number | null;
  reveal: Reveal | null;
  favorites: Favorites;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  isGroupEmpty: (id: number) => boolean;
  draggingGroupId: number | null;
  canDropGroupOn: (parentId: number | null) => boolean;
  /** Whether the dragged group may sit among the sub-groups of `parentId` (even its current parent). */
  canPlaceGroupIn: (parentId: number | null) => boolean;
  onDragGroupStart: (id: number) => void;
  onDragGroupEnd: () => void;
  onDropGroup: (id: number, parentId: number | null) => void;
  onPlaceGroup: (id: number, parentId: number | null, beforeGroupId: number | null) => void;
  onSelectNote: (id: number) => void;
  onOpenNoteBeside: (id: number) => void;
  onSelectGroup: (id: number) => void;
  /** Whether note rows show a delete button; off inside the Favorites section. */
  canDeleteNotes: boolean;
  onDeleteNote: (id: number) => void;
  onCreateNote: (groupId: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
  notebooks: Notebook[];
  currentNotebookId: number;
  onMoveGroupToNotebook: (id: number, notebookId: number) => void;
  onPlaceNote: (noteId: number, groupId: number | null, beforeNoteId: number | null) => void;
};

function GroupNode({
  group,
  depth,
  childGroupsByParent,
  notesByGroup,
  activeId,
  viewedGroupId,
  reveal,
  favorites,
  onToggleFavorite,
  isGroupEmpty,
  draggingGroupId,
  canDropGroupOn,
  canPlaceGroupIn,
  onDragGroupStart,
  onDragGroupEnd,
  onDropGroup,
  onPlaceGroup,
  onSelectNote,
  onOpenNoteBeside,
  onSelectGroup,
  canDeleteNotes,
  onDeleteNote,
  onCreateNote,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveNoteToGroup,
  notebooks,
  currentNotebookId,
  onMoveGroupToNotebook,
  onPlaceNote,
  defaultCollapsed = false,
  nextSiblingId = null,
  reorderable = true,
}: SharedProps & {
  group: Group;
  depth: number;
  defaultCollapsed?: boolean;
  /** The sub-group listed after this one under the same parent, which "drop below" places before. */
  nextSiblingId?: number | null;
  /** False for the pinned copies in Favorites, which sit in a list of their own, not among their siblings. */
  reorderable?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [addingSubgroup, setAddingSubgroup] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Opens this group, once per request, when the note being revealed is somewhere inside it.
  const [seenRevealNonce, setSeenRevealNonce] = useState<number>();
  if (reveal && reveal.nonce !== seenRevealNonce) {
    setSeenRevealNonce(reveal.nonce);
    if (reveal.ancestorIds.has(group.id)) setCollapsed(false);
  }
  const isTopLevel = depth === 0;
  const empty = isGroupEmpty(group.id);
  const childGroups = childGroupsByParent.get(group.id) ?? [];
  const childNotes = notesByGroup.get(group.id) ?? [];

  // What a dragged group may do to this row. Dropping below an expanded group with contents would
  // read as dropping beside its last child, so there the lower edge is the row's middle instead.
  const groupEdges: DropEdge[] = [];
  if (canDropGroupOn(group.id)) groupEdges.push("into");
  if (reorderable && draggingGroupId !== group.id && canPlaceGroupIn(group.parentId)) {
    groupEdges.push("before");
    if (collapsed || empty) groupEdges.push("after");
  }

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      {renaming ? (
        <InlineTextInput
          initialValue={group.name}
          depth={depth}
          onSubmit={(name) => {
            onRenameGroup(group.id, name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <DropZone
          onDropNote={(noteId) => onMoveNoteToGroup(noteId, group.id)}
          groupEdges={groupEdges}
          onDropGroup={(groupId, edge) => {
            if (edge === "into") onDropGroup(groupId, group.id);
            else
              onPlaceGroup(groupId, group.parentId, edge === "before" ? group.id : nextSiblingId);
          }}
        >
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(GROUP_DRAG_TYPE, String(group.id));
              e.dataTransfer.effectAllowed = "move";
              onDragGroupStart(group.id);
            }}
            onDragEnd={onDragGroupEnd}
            className={cn(
              "group/row relative flex items-center gap-1.5 rounded-md py-0.5 text-sm",
              draggingGroupId === group.id && "opacity-50",
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onDoubleClick={() => setRenaming(true)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onDoubleClick={(e) => e.stopPropagation()}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
                title={collapsed ? "Expand" : "Collapse"}
                // Ghost buttons stay filled while aria-expanded; this one is open for most of its life.
                className="size-5 text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
              >
                <ChevronRightIcon
                  strokeWidth={2.5}
                  className={cn("size-3 transition-transform", !collapsed && "rotate-90")}
                />
              </Button>
            </CollapsibleTrigger>
            <FolderIcon />
            <Button
              variant="ghost"
              onClick={() => onSelectGroup(group.id)}
              aria-current={viewedGroupId === group.id ? "page" : undefined}
              title={`View all notes in ${group.name}`}
              className={cn(
                "h-auto min-w-0 flex-1 justify-start border-0 px-1 py-1 hover:bg-transparent dark:hover:bg-transparent",
                isTopLevel ? "font-bold text-foreground" : "font-medium text-foreground/80",
              )}
            >
              <span
                className={cn(
                  "truncate underline decoration-1 underline-offset-4",
                  viewedGroupId === group.id
                    ? "decoration-foreground"
                    : "decoration-foreground/30 group-hover/button:decoration-foreground/60",
                )}
              >
                {group.name}
              </span>
            </Button>
            <div className={ROW_ACTIONS_CLASS}>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setCollapsed(false);
                  onCreateNote(group.id);
                }}
                aria-label={`New note in ${group.name}`}
                title="New note"
                className="text-muted-foreground hover:text-foreground"
              >
                + note
              </Button>
              <GroupMenu
                groupName={group.name}
                canDelete={empty}
                favorite={isFavorite(favorites, "group", group.id)}
                onRename={() => setRenaming(true)}
                onCreateSubgroup={() => {
                  setCollapsed(false);
                  setAddingSubgroup(true);
                }}
                onToggleFavorite={() => onToggleFavorite("group", group.id)}
                notebooks={notebooks.filter((n) => n.id !== currentNotebookId)}
                onMoveToNotebook={(notebookId) => onMoveGroupToNotebook(group.id, notebookId)}
                onDelete={() => onDeleteGroup(group.id)}
              />
            </div>
          </div>
        </DropZone>
      )}

      {addingSubgroup && (
        <InlineTextInput
          depth={depth + 1}
          placeholder="Group name"
          onSubmit={(name) => {
            onCreateGroup(name, group.id);
            setAddingSubgroup(false);
          }}
          onCancel={() => setAddingSubgroup(false)}
        />
      )}

      <CollapsibleContent className="relative">
        <span
          aria-hidden
          className="absolute bottom-0 top-0 w-px bg-border"
          style={{ left: `${depth * 16 + 12}px` }}
        />
        {childGroups.map((child, index) => (
          <GroupNode
            key={child.id}
            group={child}
            depth={depth + 1}
            nextSiblingId={childGroups[index + 1]?.id ?? null}
            childGroupsByParent={childGroupsByParent}
            notesByGroup={notesByGroup}
            activeId={activeId}
            viewedGroupId={viewedGroupId}
            reveal={reveal}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            isGroupEmpty={isGroupEmpty}
            draggingGroupId={draggingGroupId}
            canDropGroupOn={canDropGroupOn}
            canPlaceGroupIn={canPlaceGroupIn}
            onDragGroupStart={onDragGroupStart}
            onDragGroupEnd={onDragGroupEnd}
            onDropGroup={onDropGroup}
            onPlaceGroup={onPlaceGroup}
            onSelectNote={onSelectNote}
            onOpenNoteBeside={onOpenNoteBeside}
            onSelectGroup={onSelectGroup}
            canDeleteNotes={canDeleteNotes}
            onDeleteNote={onDeleteNote}
            onCreateNote={onCreateNote}
            onCreateGroup={onCreateGroup}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            onMoveNoteToGroup={onMoveNoteToGroup}
            notebooks={notebooks}
            currentNotebookId={currentNotebookId}
            onMoveGroupToNotebook={onMoveGroupToNotebook}
            onPlaceNote={onPlaceNote}
          />
        ))}

        {childNotes.map((note, index) => (
          <NoteRow
            key={note.id}
            note={note}
            depth={depth + 1}
            active={note.id === activeId}
            reveal={reveal?.noteId === note.id ? reveal : null}
            favorite={isFavorite(favorites, "note", note.id)}
            onDropNote={(noteId, edge) =>
              onPlaceNote(
                noteId,
                group.id,
                edge === "before" ? note.id : (childNotes[index + 1]?.id ?? null),
              )
            }
            onSelect={() => onSelectNote(note.id)}
            onOpenBeside={() => onOpenNoteBeside(note.id)}
            onDelete={canDeleteNotes ? () => onDeleteNote(note.id) : undefined}
            onToggleFavorite={() => onToggleFavorite("note", note.id)}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoteRow({
  note,
  depth,
  active,
  reveal = null,
  favorite,
  onDropNote,
  onSelect,
  onOpenBeside,
  onDelete,
  onToggleFavorite,
}: {
  note: Note;
  depth: number;
  active: boolean;
  /** Set while this row is the one to bring into view. */
  reveal?: Reveal | null;
  favorite: boolean;
  /** Called when a note is dropped above or below this row. Omitted for rows that aren't part of a sibling list (the pinned notes). */
  onDropNote?: (noteId: number, edge: DropEdge) => void;
  onSelect: () => void;
  onOpenBeside: () => void;
  /** Omitted where notes mustn't be deleted from the row (the Favorites section): no delete button. */
  onDelete?: () => void;
  onToggleFavorite: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const revealNonce = reveal?.nonce;
  useEffect(() => {
    if (revealNonce === undefined) return;
    rowRef.current?.scrollIntoView?.({ block: "nearest" });
    reveal?.done();
  }, [revealNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (
    <div ref={rowRef} className="group/row relative">
      <Button
        variant="ghost"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(NOTE_DRAG_TYPE, String(note.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={cn(
          "h-auto w-full justify-start rounded-md border-0 py-1.5 pr-2",
          active && "bg-accent font-medium",
        )}
      >
        <span className="truncate">{noteTitle(note)}</span>
      </Button>
      <div className={ROW_ACTIONS_CLASS}>
        <NoteMenu
          label={noteTitle(note)}
          favorite={favorite}
          onToggleFavorite={onToggleFavorite}
          onOpenBeside={onOpenBeside}
        />
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            aria-label={`Delete ${noteTitle(note)}`}
            className="opacity-60 hover:opacity-100"
          >
            <XIcon />
          </Button>
        )}
      </div>
    </div>
  );

  return onDropNote ? (
    <DropZone noteEdges={NOTE_ROW_EDGES} onDropNote={onDropNote}>
      {row}
    </DropZone>
  ) : (
    row
  );
}

const NOTE_ROW_EDGES: readonly DropEdge[] = ["before", "after"];
const INTO_ONLY: readonly DropEdge[] = ["into"];

/**
 * Wraps its children as an HTML5 drop target for a dragged note and, when
 * `onDropGroup` is given, a dragged group. Omitting it leaves group drags
 * unhandled, so the browser shows its "not allowed" cursor.
 *
 * `noteEdges`/`groupEdges` say which parts of the zone the drag may use: dropped
 * "into" it (highlighted), or above or below it (a line at that edge). A drag that
 * may use none of them where the pointer is isn't accepted there, and the drop
 * handler is told which edge it landed on.
 */
function DropZone({
  onDropNote,
  onDropGroup,
  noteEdges = INTO_ONLY,
  groupEdges = INTO_ONLY,
  children,
}: {
  onDropNote?: (noteId: number, edge: DropEdge) => void;
  onDropGroup?: (groupId: number, edge: DropEdge) => void;
  noteEdges?: readonly DropEdge[];
  groupEdges?: readonly DropEdge[];
  children: ReactNode;
}) {
  const [hover, setHover] = useState<DropEdge | null>(null);

  function targetOf(e: DragEvent<HTMLDivElement>): { kind: "note" | "group"; edge: DropEdge } | null {
    const types = Array.from(e.dataTransfer.types);
    const kind =
      onDropNote && types.includes(NOTE_DRAG_TYPE)
        ? "note"
        : onDropGroup && types.includes(GROUP_DRAG_TYPE)
          ? "group"
          : null;
    if (!kind) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = dropEdge(
      e.clientY - rect.top,
      rect.height,
      kind === "note" ? noteEdges : groupEdges,
    );
    return edge ? { kind, edge } : null;
  }

  return (
    <div
      onDragOver={(e) => {
        const target = targetOf(e);
        if (!target) {
          setHover(null);
          return;
        }
        e.preventDefault();
        setHover(target.edge);
      }}
      onDragLeave={(e) => {
        // Moving onto a child of the zone also fires dragleave; ignore it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHover(null);
      }}
      onDrop={(e) => {
        setHover(null);
        const target = targetOf(e);
        if (!target) return;
        e.preventDefault();
        const id = Number(
          e.dataTransfer.getData(target.kind === "note" ? NOTE_DRAG_TYPE : GROUP_DRAG_TYPE),
        );
        if (Number.isNaN(id)) return;
        if (target.kind === "note") onDropNote?.(id, target.edge);
        else onDropGroup?.(id, target.edge);
      }}
      className={cn("relative rounded-md", hover === "into" && "bg-accent")}
    >
      {children}
      {(hover === "before" || hover === "after") && (
        <span
          aria-hidden
          data-drop-edge={hover}
          className={cn(
            "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary",
            hover === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
    </div>
  );
}

export function InlineTextInput({
  initialValue = "",
  depth,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initialValue?: string;
  depth: number;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  function submit() {
    const trimmed = value.trim();
    if (trimmed === "") {
      onCancel();
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Input
      type="text"
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      className="pr-2"
    />
  );
}
