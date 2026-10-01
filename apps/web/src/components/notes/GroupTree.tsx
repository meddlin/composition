"use client";

import { ChevronRightIcon, StarIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { isFavorite, type Favorites, type FavoriteType } from "@/lib/composition/favorites";
import { canMoveGroup } from "@/lib/composition/groupMove";
import { cn } from "@/lib/utils";
import { GROUP_DRAG_TYPE, NOTE_DRAG_TYPE } from "./dragTypes";
import { FavoriteMenu } from "./FavoriteMenu";
import { FolderIcon } from "./FolderIcon";
import { GroupMenu } from "./GroupMenu";
import { noteTitle, type Group, type Note } from "./types";

// Overlays a row's buttons instead of reserving space, so names can run right up to the edge.
// Stays visible while a menu is open: its popup is portaled out, so the row is no longer
// hovered or focused.
const ROW_ACTIONS_CLASS =
  "pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-md bg-surface opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100";

type TreeProps = {
  groups: Group[];
  notes: Note[];
  activeId: number | null;
  viewedGroupId: number | null;
  favorites: Favorites;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onCreateNote: (groupId: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveGroup: (id: number, parentId: number | null) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
};

export function GroupTree({
  groups,
  notes,
  activeId,
  viewedGroupId,
  favorites,
  onToggleFavorite,
  onSelectNote,
  onSelectGroup,
  onDeleteNote,
  onCreateNote,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onMoveNoteToGroup,
}: TreeProps) {
  // Only one group is ever being dragged; tracked here (dragover can't read the
  // payload) so each row can tell whether it is a legal place to drop it.
  const [draggingGroupId, setDraggingGroupId] = useState<number | null>(null);

  function canDropGroupOn(parentId: number | null): boolean {
    return draggingGroupId !== null && canMoveGroup(groups, draggingGroupId, parentId);
  }

  function dropGroup(id: number, parentId: number | null) {
    // The moved row remounts under its new parent, so its dragend never fires.
    setDraggingGroupId(null);
    onMoveGroup(id, parentId);
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

  const shared: SharedProps = {
    childGroupsByParent,
    notesByGroup,
    activeId,
    viewedGroupId,
    favorites,
    onToggleFavorite,
    isGroupEmpty,
    draggingGroupId,
    canDropGroupOn,
    onDragGroupStart: setDraggingGroupId,
    onDragGroupEnd: () => setDraggingGroupId(null),
    onDropGroup: dropGroup,
    onSelectNote,
    onSelectGroup,
    onDeleteNote,
    onCreateNote,
    onCreateGroup,
    onRenameGroup,
    onDeleteGroup,
    onMoveNoteToGroup,
  };

  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const notesById = new Map(notes.map((n) => [n.id, n]));

  return (
    <div className="flex flex-col gap-0.5">
      <FavoritesSection
        favorites={favorites}
        groupsById={groupsById}
        notesById={notesById}
        activeId={activeId}
        viewedGroupId={viewedGroupId}
        onToggleFavorite={onToggleFavorite}
        onSelectNote={onSelectNote}
        onSelectGroup={onSelectGroup}
        onDeleteNote={onDeleteNote}
      />
      {canDropGroupOn(null) && (
        <DropZone onDropGroup={(groupId) => dropGroup(groupId, null)}>
          <div className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1.5 text-center text-xs text-muted-foreground">
            Drop here to move to top level
          </div>
        </DropZone>
      )}
      {(childGroupsByParent.get(null) ?? []).map((group) => (
        <GroupNode key={group.id} group={group} depth={0} {...shared} />
      ))}

      <DropZone onDropNote={(noteId) => onMoveNoteToGroup(noteId, null)}>
        <div
          style={{ paddingLeft: "8px" }}
          className="rounded-md py-1.5 text-sm font-bold text-muted-foreground"
        >
          Ungrouped
        </div>
      </DropZone>
      {(notesByGroup.get(null) ?? []).map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          depth={1}
          active={note.id === activeId}
          favorite={isFavorite(favorites, "note", note.id)}
          onSelect={() => onSelectNote(note.id)}
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
 * Absent when nothing is pinned. An entry whose group or note no longer exists
 * is skipped rather than shown.
 */
function FavoritesSection({
  favorites,
  groupsById,
  notesById,
  activeId,
  viewedGroupId,
  onToggleFavorite,
  onSelectNote,
  onSelectGroup,
  onDeleteNote,
}: {
  favorites: Favorites;
  groupsById: Map<number, Group>;
  notesById: Map<number, Note>;
  activeId: number | null;
  viewedGroupId: number | null;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onDeleteNote: (id: number) => void;
}) {
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
          <FavoriteGroupRow
            key={row.key}
            group={row.group}
            viewed={viewedGroupId === row.group.id}
            onSelect={() => onSelectGroup(row.group.id)}
            onRemove={() => onToggleFavorite("group", row.group.id)}
          />
        ) : (
          <NoteRow
            key={row.key}
            note={row.note}
            depth={1}
            active={row.note.id === activeId}
            favorite
            // The same note is usually in the tree too; keep its menu trigger distinguishable.
            menuLabel={`favorite ${noteTitle(row.note)}`}
            onSelect={() => onSelectNote(row.note.id)}
            onDelete={() => onDeleteNote(row.note.id)}
            onToggleFavorite={() => onToggleFavorite("note", row.note.id)}
          />
        ),
      )}
    </div>
  );
}

function FavoriteGroupRow({
  group,
  viewed,
  onSelect,
  onRemove,
}: {
  group: Group;
  viewed: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group/row relative flex items-center gap-1.5 rounded-md py-0.5 pl-6 text-sm">
      <FolderIcon />
      <Button
        variant="ghost"
        onClick={onSelect}
        aria-current={viewed ? "page" : undefined}
        title={`View all notes in ${group.name}`}
        className="h-auto min-w-0 flex-1 justify-start border-0 px-1 py-1 font-bold text-foreground hover:bg-transparent dark:hover:bg-transparent"
      >
        <span
          className={cn(
            "truncate underline decoration-1 underline-offset-4",
            viewed
              ? "decoration-foreground"
              : "decoration-foreground/30 group-hover/button:decoration-foreground/60",
          )}
        >
          {group.name}
        </span>
      </Button>
      <div className={ROW_ACTIONS_CLASS}>
        <FavoriteMenu label={`favorite ${group.name}`} favorite onToggleFavorite={onRemove} />
      </div>
    </div>
  );
}

type SharedProps = {
  childGroupsByParent: Map<number | null, Group[]>;
  notesByGroup: Map<number | null, Note[]>;
  activeId: number | null;
  viewedGroupId: number | null;
  favorites: Favorites;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  isGroupEmpty: (id: number) => boolean;
  draggingGroupId: number | null;
  canDropGroupOn: (parentId: number | null) => boolean;
  onDragGroupStart: (id: number) => void;
  onDragGroupEnd: () => void;
  onDropGroup: (id: number, parentId: number | null) => void;
  onSelectNote: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onCreateNote: (groupId: number) => void;
  onCreateGroup: (name: string, parentId: number | null) => void;
  onRenameGroup: (id: number, name: string) => void;
  onDeleteGroup: (id: number) => void;
  onMoveNoteToGroup: (noteId: number, groupId: number | null) => void;
};

function GroupNode({
  group,
  depth,
  childGroupsByParent,
  notesByGroup,
  activeId,
  viewedGroupId,
  favorites,
  onToggleFavorite,
  isGroupEmpty,
  draggingGroupId,
  canDropGroupOn,
  onDragGroupStart,
  onDragGroupEnd,
  onDropGroup,
  onSelectNote,
  onSelectGroup,
  onDeleteNote,
  onCreateNote,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveNoteToGroup,
}: SharedProps & { group: Group; depth: number }) {
  const [renaming, setRenaming] = useState(false);
  const [addingSubgroup, setAddingSubgroup] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isTopLevel = depth === 0;
  const empty = isGroupEmpty(group.id);
  const childGroups = childGroupsByParent.get(group.id) ?? [];
  const childNotes = notesByGroup.get(group.id) ?? [];

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
          onDropGroup={
            canDropGroupOn(group.id)
              ? (groupId) => onDropGroup(groupId, group.id)
              : undefined
          }
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
        {childGroups.map((child) => (
          <GroupNode
            key={child.id}
            group={child}
            depth={depth + 1}
            childGroupsByParent={childGroupsByParent}
            notesByGroup={notesByGroup}
            activeId={activeId}
            viewedGroupId={viewedGroupId}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            isGroupEmpty={isGroupEmpty}
            draggingGroupId={draggingGroupId}
            canDropGroupOn={canDropGroupOn}
            onDragGroupStart={onDragGroupStart}
            onDragGroupEnd={onDragGroupEnd}
            onDropGroup={onDropGroup}
            onSelectNote={onSelectNote}
            onSelectGroup={onSelectGroup}
            onDeleteNote={onDeleteNote}
            onCreateNote={onCreateNote}
            onCreateGroup={onCreateGroup}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            onMoveNoteToGroup={onMoveNoteToGroup}
          />
        ))}

        {childNotes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            depth={depth + 1}
            active={note.id === activeId}
            favorite={isFavorite(favorites, "note", note.id)}
            onSelect={() => onSelectNote(note.id)}
            onDelete={() => onDeleteNote(note.id)}
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
  favorite,
  menuLabel = noteTitle(note),
  onSelect,
  onDelete,
  onToggleFavorite,
}: {
  note: Note;
  depth: number;
  active: boolean;
  favorite: boolean;
  /** Names the "⋯" menu's trigger; defaults to the note's title. */
  menuLabel?: string;
  onSelect: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="group/row relative">
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
        <FavoriteMenu label={menuLabel} favorite={favorite} onToggleFavorite={onToggleFavorite} />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          aria-label={`Delete ${noteTitle(note)}`}
          className="opacity-60 hover:opacity-100"
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps its children as an HTML5 drop target for a dragged note and, when
 * `onDropGroup` is given, a dragged group. Omitting it leaves group drags
 * unhandled, so the browser shows its "not allowed" cursor.
 */
function DropZone({
  onDropNote,
  onDropGroup,
  children,
}: {
  onDropNote?: (noteId: number) => void;
  onDropGroup?: (groupId: number) => void;
  children: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);

  function accepts(types: readonly string[]): "note" | "group" | null {
    if (onDropNote && types.includes(NOTE_DRAG_TYPE)) return "note";
    if (onDropGroup && types.includes(GROUP_DRAG_TYPE)) return "group";
    return null;
  }

  return (
    <div
      onDragOver={(e) => {
        if (!accepts(Array.from(e.dataTransfer.types))) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Moving onto a child of the zone also fires dragleave; ignore it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        const kind = accepts(Array.from(e.dataTransfer.types));
        if (!kind) return;
        e.preventDefault();
        const id = Number(
          e.dataTransfer.getData(kind === "note" ? NOTE_DRAG_TYPE : GROUP_DRAG_TYPE),
        );
        if (Number.isNaN(id)) return;
        if (kind === "note") onDropNote?.(id);
        else onDropGroup?.(id);
      }}
      className={cn("rounded-md", dragOver && "bg-accent")}
    >
      {children}
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
