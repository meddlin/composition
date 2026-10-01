"use client";

import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { canMoveGroup } from "@/lib/composition/groupMove";
import { cn } from "@/lib/utils";
import { GROUP_DRAG_TYPE, NOTE_DRAG_TYPE } from "./dragTypes";
import { FolderIcon } from "./FolderIcon";
import { GroupMenu } from "./GroupMenu";
import { noteTitle, type Group, type Note } from "./types";

type TreeProps = {
  groups: Group[];
  notes: Note[];
  activeId: number | null;
  viewedGroupId: number | null;
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

  return (
    <div className="flex flex-col gap-0.5">
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
          onSelect={() => onSelectNote(note.id)}
          onDelete={() => onDeleteNote(note.id)}
        />
      ))}
    </div>
  );
}

type SharedProps = {
  childGroupsByParent: Map<number | null, Group[]>;
  notesByGroup: Map<number | null, Note[]>;
  activeId: number | null;
  viewedGroupId: number | null;
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
            {/* Overlays the row instead of reserving space, so names can run right up to the edge.
                Stays visible while the menu is open: its popup is portaled out, so the row is no
                longer hovered or focused. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-md bg-surface opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-data-[state=open]:pointer-events-auto has-data-[state=open]:opacity-100">
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
                onRename={() => setRenaming(true)}
                onCreateSubgroup={() => {
                  setCollapsed(false);
                  setAddingSubgroup(true);
                }}
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
            onSelect={() => onSelectNote(note.id)}
            onDelete={() => onDeleteNote(note.id)}
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
  onSelect,
  onDelete,
}: {
  note: Note;
  depth: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
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
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={`Delete ${noteTitle(note)}`}
        className="absolute right-0 top-1/2 -translate-y-1/2 bg-surface opacity-0 focus-visible:opacity-100 group-hover/row:opacity-60 group-hover/row:hover:opacity-100"
      >
        <XIcon />
      </Button>
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
