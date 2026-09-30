"use client";

import { useState, type ReactNode } from "react";
import { noteTitle, type Group, type Note } from "./types";

// Custom MIME type so drop targets can tell a dragged note apart from any
// other draggable content a browser might offer.
const NOTE_DRAG_TYPE = "application/x-composition-note-id";

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
  onMoveNoteToGroup,
}: TreeProps) {
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
      {(childGroupsByParent.get(null) ?? []).map((group) => (
        <GroupNode key={group.id} group={group} depth={0} {...shared} />
      ))}

      <DropZone onDrop={(noteId) => onMoveNoteToGroup(noteId, null)}>
        <div
          style={{ paddingLeft: "8px" }}
          className="rounded-md py-1.5 text-sm font-bold text-foreground/50"
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
    <div>
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
        <DropZone onDrop={(noteId) => onMoveNoteToGroup(noteId, group.id)}>
          <div
            className="group/row relative flex items-center gap-1.5 rounded-md py-1.5 text-sm"
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onDoubleClick={() => setRenaming(true)}
          >
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              onDoubleClick={(e) => e.stopPropagation()}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
              title={collapsed ? "Expand" : "Collapse"}
              className="rounded p-0.5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            >
              <ChevronIcon expanded={!collapsed} />
            </button>
            <FolderIcon />
            <button
              type="button"
              onClick={() => onSelectGroup(group.id)}
              aria-current={viewedGroupId === group.id ? "page" : undefined}
              title={`View all notes in ${group.name}`}
              className={`min-w-0 flex-1 truncate text-left ${
                isTopLevel
                  ? "font-bold text-foreground"
                  : "font-medium text-foreground/80"
              }`}
            >
              <span
                className={`underline decoration-1 underline-offset-4 ${
                  viewedGroupId === group.id
                    ? "decoration-foreground"
                    : "decoration-foreground/30 hover:decoration-foreground/60"
                }`}
              >
                {group.name}
              </span>
            </button>
            {/* Overlays the row instead of reserving space, so names can run right up to the edge. */}
            <div className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-surface opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setCollapsed(false);
                  onCreateNote(group.id);
                }}
                aria-label={`New note in ${group.name}`}
                title="New note"
                className="rounded px-1.5 py-0.5 text-xs opacity-60 hover:bg-foreground/10 hover:opacity-100"
              >
                + note
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollapsed(false);
                  setAddingSubgroup(true);
                }}
                aria-label={`New sub-group inside ${group.name}`}
                title="New sub-group"
                className="rounded px-1.5 py-0.5 text-xs opacity-60 hover:bg-foreground/10 hover:opacity-100"
              >
                + group
              </button>
              <button
                type="button"
                onClick={() => onDeleteGroup(group.id)}
                disabled={!empty}
                aria-label={`Delete ${group.name}`}
                title={
                  empty ? "Delete group" : "Empty this group before deleting"
                }
                className="rounded px-1.5 py-0.5 text-xs opacity-60 hover:bg-foreground/10 hover:opacity-100 disabled:pointer-events-none disabled:opacity-0"
              >
                ✕
              </button>
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

      {!collapsed && (
        <div className="relative">
          <span
            aria-hidden
            className="absolute bottom-0 top-0 w-px bg-foreground/10"
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
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
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
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(NOTE_DRAG_TYPE, String(note.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`w-full truncate rounded-md py-1.5 text-left text-sm ${
          active ? "bg-foreground/10 font-medium" : "hover:bg-foreground/5"
        }`}
      >
        {noteTitle(note)}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${noteTitle(note)}`}
        className="absolute right-0 top-1/2 -translate-y-1/2 rounded bg-surface px-2 py-1 text-xs opacity-0 hover:bg-foreground/10 focus:opacity-100 group-hover/row:opacity-60 group-hover/row:hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/** Wraps its children as an HTML5 drop target for a dragged note id. */
function DropZone({
  onDrop,
  children,
}: {
  onDrop: (noteId: number) => void;
  children: ReactNode;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = Number(e.dataTransfer.getData(NOTE_DRAG_TYPE));
        if (!Number.isNaN(id)) onDrop(id);
      }}
      className={`rounded-md ${dragOver ? "bg-foreground/10" : ""}`}
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
    <input
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
      className="w-full rounded-md border border-foreground/20 bg-transparent py-1.5 pr-2 text-sm outline-none focus:border-foreground/40"
    />
  );
}
