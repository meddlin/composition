"use client";

import { ArchiveIcon, ArrowDownToLineIcon, ArrowUpNarrowWideIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, FileTextIcon, KanbanIcon, ListIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { reportSections } from "@/lib/composition/todoReportList";
import { archiveGroups, countDescendants, sortByPriority, sortDoneLast, subtreeIds, todoSections, type TodoNode } from "@/lib/composition/todos";
import { MAX_TODO_TITLE_LENGTH, type ArchivedTodo, type Todo, type TodoDeletePreview, type TodoMissingReport, type TodoReportEntry } from "@/lib/composition/todosApi";
import type { ReportKind } from "@/lib/composition/todoReports";
import type { TodoResult } from "@/lib/composition/todosStore";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { TODO_DRAG_TYPE } from "../notes/dragTypes";
import type { WorkspaceStore } from "../notes/workspaceStore";
import type { TodoPanelState, TodoSection, TodoView } from "./kinds";
import type { PanelId } from "./layoutTree";
import { RolledEntry } from "./RolledOver";
import { TodoArchive } from "./TodoArchive";
import { TodoBoard } from "./TodoBoard";
import { TodoMenu } from "./TodoMenu";
import { PriorityMenu } from "./TodoPriority";
import { TodoReports } from "./TodoReports";
import { todoLookStyle } from "./todoLookStyle";

/** How far, in px, each level of sub-items is pushed in. */
const INDENT = 20;

/**
 * A text box for a to-do's title. Enter sends it, Escape gives up. `keepOpen` is for adding several in a row: the box
 * clears and stays instead of closing after each one. `addLabel` gives it a small Add button beside it (named by the label),
 * for a box that has no other way to say it takes Enter; it is off while there is nothing to add.
 */
function TitleInput({
  initial = "",
  label,
  placeholder,
  keepOpen = false,
  autoFocus = false,
  addLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  label: string;
  placeholder?: string;
  keepOpen?: boolean;
  autoFocus?: boolean;
  addLabel?: string;
  onSubmit: (title: string) => Promise<TodoResult>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const box = useRef<HTMLInputElement>(null);
  // Enter closes a box that is leaving, and the blur that follows must not send the title a second time.
  const finished = useRef(false);

  async function submit() {
    const title = value.trim();
    if (title === "") return;
    if (!keepOpen) finished.current = true;
    const { error } = await onSubmit(title);
    if (error) finished.current = false;
    else if (keepOpen) {
      setValue("");
      // Back in the box, so the next one can be typed straight away (the Add button has taken the focus).
      box.current?.focus();
    }
  }

  const input = (
    <Input
      ref={box}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      maxLength={MAX_TODO_TITLE_LENGTH}
      autoFocus={autoFocus}
      className="h-7"
      onChange={(event) => setValue(event.target.value)}
      // A rename starts with the old title selected, so typing replaces it.
      onFocus={(event) => initial !== "" && event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          event.stopPropagation();
          finished.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (finished.current || !onCancel) return;
        // Leaving a box with something typed in it keeps what was typed; leaving it empty just closes it.
        if (value.trim() === "" || value.trim() === initial) onCancel();
        else void submit();
      }}
    />
  );
  if (!addLabel) return input;
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{input}</div>
      <Button type="button" size="sm" variant="secondary" aria-label={addLabel} disabled={value.trim() === ""} onClick={() => void submit()}>
        Add
      </Button>
    </div>
  );
}

type RowProps = {
  node: TodoNode;
  depth: number;
  store: WorkspaceStore;
  collapsed: ReadonlySet<number>;
  onToggleCollapsed: (id: number, collapsed: boolean) => void;
  editing: number | null;
  onEdit: (id: number | null) => void;
  addingTo: number | null;
  onAddTo: (id: number | null) => void;
  onRemove: (todo: Todo) => void;
  onDeleteForGood: (todo: Todo) => void;
  /** The rows beside this one in the list it is shown in, in order: what Move up and Move down step past. */
  siblings: TodoNode[];
  /** Puts the item just before or just after another one under the same parent. */
  onPlace: (id: number, targetId: number, edge: Edge) => void;
  /** Where the rows are shown, so a drop knows what it may reorder among. A row with no section cannot be dragged. */
  section?: DragFrom;
  /** How a row is picked up, and takes what is dropped on it, to rearrange the list. */
  drag?: RowDrag;
};

type DragHandlers = { onDragStart: (event: DragEvent<HTMLElement>) => void; onDragEnd: () => void };

/** Which side of a row a dragged item would land on. */
type Edge = "before" | "after";

type RowDrag = {
  source: (todo: Todo, section: DragFrom) => DragHandlers;
  /** The row edge a dragged item is over, where a line shows it would land. */
  mark: { id: number; edge: Edge } | null;
  onOver: (event: DragEvent<HTMLElement>, todo: Todo, section: DragFrom) => void;
  onLeave: (event: DragEvent<HTMLElement>, todo: Todo) => void;
  onDrop: (event: DragEvent<HTMLElement>, todo: Todo, section: DragFrom) => void;
};

function TodoRow(props: RowProps) {
  const { node, depth, store, collapsed, onToggleCollapsed, editing, onEdit, addingTo, onAddTo, onRemove, onDeleteForGood, siblings, onPlace, section, drag } = props;
  const { todo, children } = node;
  const folded = collapsed.has(todo.id);
  const shownChildren = children.length > 0 && !folded;
  const place = siblings.findIndex((sibling) => sibling.todo.id === todo.id);
  const above = siblings[place - 1];
  const below = siblings[place + 1];
  // A box being typed in is not a handle: dragging inside it should select text.
  const handlers = section && editing !== todo.id ? drag?.source(todo, section) : undefined;
  const mark = drag?.mark?.id === todo.id ? drag.mark.edge : undefined;

  return (
    <li draggable={handlers ? true : undefined} onDragStart={handlers?.onDragStart} onDragEnd={handlers?.onDragEnd}>
      <div
        className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-muted/50 focus-within:bg-muted/50 data-[drop=before]:shadow-[inset_0_2px_0_0_var(--ring)] data-[drop=after]:shadow-[inset_0_-2px_0_0_var(--ring)]"
        style={{ paddingLeft: depth * INDENT }}
        data-drop={mark}
        onDragOver={section && drag ? (event) => drag.onOver(event, todo, section) : undefined}
        onDragLeave={drag ? (event) => drag.onLeave(event, todo) : undefined}
        onDrop={section && drag ? (event) => drag.onDrop(event, todo, section) : undefined}
      >
        {children.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={folded ? `Show the sub-items of ${todo.title}` : `Hide the sub-items of ${todo.title}`}
            aria-expanded={!folded}
            onClick={() => onToggleCollapsed(todo.id, !folded)}
          >
            <ChevronRightIcon className={cn("transition-transform", !folded && "rotate-90")} />
          </Button>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )}
        <Checkbox
          checked={todo.done}
          aria-label={`${todo.title}: done`}
          onCheckedChange={(checked) => void store.todos.setDone(todo.id, checked === true)}
        />
        {editing === todo.id ? (
          <div className="min-w-0 flex-1 pl-1">
            <TitleInput
              autoFocus
              initial={todo.title}
              label={`Rename ${todo.title}`}
              onSubmit={async (title) => {
                const result = title === todo.title ? {} : await store.todos.rename(todo.id, title);
                if (!result.error) onEdit(null);
                return result;
              }}
              onCancel={() => onEdit(null)}
            />
          </div>
        ) : (
          <span
            className={cn("min-w-0 flex-1 break-words px-1 text-sm", todo.done && "text-muted-foreground line-through")}
            onDoubleClick={() => onEdit(todo.id)}
          >
            {todo.title}
          </span>
        )}
        {todo.priority !== undefined && (
          <PriorityMenu title={todo.title} priority={todo.priority} onChange={(priority) => void store.todos.setPriority(todo.id, priority)} />
        )}
        {editing !== todo.id && (
          <div className="flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {todo.priority === undefined && (
              <PriorityMenu title={todo.title} priority={undefined} onChange={(priority) => void store.todos.setPriority(todo.id, priority)} />
            )}
            {section && (
              <>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${todo.title} up`} title="Move up" disabled={!above} onClick={() => above && onPlace(todo.id, above.todo.id, "before")}>
                  <ChevronUpIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Move ${todo.title} down`} title="Move down" disabled={!below} onClick={() => below && onPlace(todo.id, below.todo.id, "after")}>
                  <ChevronDownIcon />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon-xs" aria-label={`Add a sub-item to ${todo.title}`} onClick={() => {
              onToggleCollapsed(todo.id, false);
              onAddTo(todo.id);
            }}>
              <PlusIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Rename ${todo.title}`} onClick={() => onEdit(todo.id)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${todo.title}`} title="Remove" onClick={() => onRemove(todo)}>
              <Trash2Icon />
            </Button>
            <TodoMenu title={todo.title} onDeleteForGood={() => onDeleteForGood(todo)} />
          </div>
        )}
      </div>
      {(shownChildren || addingTo === todo.id) && (
        <ul>
          {shownChildren && children.map((child) => <TodoRow key={child.todo.id} {...props} node={child} depth={depth + 1} siblings={children} />)}
          {addingTo === todo.id && (
            <li style={{ paddingLeft: (depth + 1) * INDENT + 28 }} className="py-0.5 pr-1">
              <TitleInput
                autoFocus
                keepOpen
                label={`New sub-item of ${todo.title}`}
                placeholder="Add a sub-item"
                onSubmit={(title) => store.todos.add(title, todo.id)}
                onCancel={() => onAddTo(null)}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** The sections an item is dragged from, and the two that take a drop. */
type DragFrom = "backlog" | "rolled-over" | "this-week";
type DragTarget = "this-week" | "backlog";

/** What a section needs to take a drop: how it looks while something can be dropped (or is about to be), and the three events. */
type DropZone = {
  state: "ready" | "over" | undefined;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

/** The half of a row the pointer is over: dropped there, an item lands before the row (upper half) or after it. */
function edgeOf(event: DragEvent<HTMLElement>): Edge {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? "before" : "after";
}

/** A section of the list: a heading that folds it away, and what is in it. */
function Section({
  title,
  count,
  folded,
  onToggle,
  dropZone,
  actions,
  children,
}: {
  title: string;
  count?: number;
  folded: boolean;
  onToggle: () => void;
  dropZone?: DropZone;
  /** Buttons beside the heading. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-1 rounded-md data-[drop-target]:outline-1 data-[drop-target]:outline-dashed data-[drop-target]:outline-offset-2 data-[drop-target=ready]:outline-muted-foreground/40 data-[drop-target=over]:bg-accent data-[drop-target=over]:outline-ring"
      data-drop-target={dropZone?.state}
      onDragOver={dropZone?.onDragOver}
      onDragLeave={dropZone?.onDragLeave}
      onDrop={dropZone?.onDrop}
    >
      <div className="flex items-center justify-between gap-1">
        <h3>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 px-1 font-medium text-muted-foreground"
            aria-expanded={!folded}
            aria-label={folded ? `Show the ${title} section` : `Hide the ${title} section`}
            onClick={onToggle}
          >
            <ChevronRightIcon className={cn("transition-transform", !folded && "rotate-90")} />
            {title}
            {count !== undefined && count > 0 && <span>({count})</span>}
          </Button>
        </h3>
        {actions}
      </div>
      {!folded && children}
    </section>
  );
}

/** How long the Undo stays after an item is removed. */
const UNDO_MS = 8000;

/**
 * A to-do list: items with sub-items, to add, rename, remove and tick off (a done item is struck through). The list view
 * has three sections: what rolled over from earlier weeks and waits to be placed (shown only while something does), this
 * week, and the backlog. It can also be shown as a board with a column per status (backlog, to-do, in progress, done), with
 * Rolled over as a strip above the columns. Removing an item asks first, then archives it and offers an Undo. The items are the workspace's, so
 * every to-do panel, in any window, shows the same items; the panel itself saves only which items and sections it has
 * folded away and which view it is on.
 */
export function TodoPanel({ store, panelId, state }: { store: WorkspaceStore; panelId: PanelId; state: TodoPanelState }) {
  const todosStore = store.todos;
  const { status, todos, look: savedLook, setup, archive, reports, error } = useSyncExternalStore(todosStore.subscribe, todosStore.getSnapshot, todosStore.getSnapshot);
  // An item being dragged: to another section if it `moves` (a top-level item that is not done; a sub-item only reorders), or to
  // another place among its siblings. Which section it is over, and which row edge, are kept beside it.
  const [dragging, setDragging] = useState<{ id: number; parentId: number | null; from: DragFrom; moves: boolean } | null>(null);
  const [over, setOver] = useState<DragTarget | null>(null);
  const [mark, setMark] = useState<{ id: number; edge: Edge } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  /** What was just done, said at the bottom for a few seconds; with the id of an item just removed, an Undo comes with it. */
  const [bar, setBar] = useState<{ message: string; undo?: number } | null>(null);
  /** The item the owner has asked to remove, waiting on their yes, so a slip of the mouse cannot take it off the list. */
  const [removing, setRemoving] = useState<Todo | null>(null);
  /** What is typed in the Archive view's search box. */
  const [query, setQuery] = useState("");
  /** The item the owner is deleting for good, and what that would erase, once found out (for that item). */
  const [deleting, setDeleting] = useState<{ id: number; title: string } | null>(null);
  const [previewed, setPreviewed] = useState<{ id: number; result: TodoDeletePreview | "error" } | null>(null);
  const preview: TodoDeletePreview | "loading" | "error" = deleting && previewed?.id === deleting.id ? previewed.result : "loading";

  useEffect(() => {
    void todosStore.load();
  }, [todosStore]);

  useEffect(() => {
    if (!bar) return;
    const timer = setTimeout(() => setBar(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [bar]);

  // The archive and the reports are read when their views are opened, and kept up to date after that.
  useEffect(() => {
    if (state.view === "archive") void todosStore.loadArchive();
    if (state.view === "reports") void todosStore.loadReports();
  }, [state.view, todosStore]);

  // Before anything is erased for good, find out how much goes and which reports mention it.
  useEffect(() => {
    if (!deleting) return;
    let current = true;
    void todosStore.previewDelete(deleting.id).then((result) => {
      if (current) setPreviewed({ id: deleting.id, result: result.preview ?? "error" });
    });
    return () => {
      current = false;
    };
  }, [deleting, todosStore]);

  const sections = useMemo(() => todoSections(todos), [todos]);
  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);
  const titles = useMemo(() => new Map([...todos, ...(archive ?? [])].map((t) => [t.id, t.title])), [todos, archive]);
  const sectionsOfReports = useMemo(() => (reports ? reportSections(reports) : null), [reports]);
  const groups = useMemo(() => (archive ? archiveGroups(archive, titles, query) : null), [archive, titles, query]);
  /** What is waiting in Rolled over, whole branches, so the board's columns can leave it out. */
  const inRolledOver = useMemo(() => new Set(sections.rolledOver.flatMap((node) => [...subtreeIds(todos, node.todo.id)])), [sections, todos]);

  function toggleCollapsed(id: number, fold: boolean) {
    if (collapsed.has(id) === fold) return;
    const next = fold ? [...state.collapsed, id] : state.collapsed.filter((c) => c !== id);
    store.setPanelState(panelId, { ...state, collapsed: next } satisfies TodoPanelState);
  }

  function toggleSection(section: TodoSection) {
    const next = state.foldedSections.includes(section) ? state.foldedSections.filter((s) => s !== section) : [...state.foldedSections, section];
    store.setPanelState(panelId, { ...state, foldedSections: next } satisfies TodoPanelState);
  }

  function endDrag() {
    setDragging(null);
    setOver(null);
    setMark(null);
  }

  /** Picking up an item; its id rides along under its own type, not as text. Its sub-items come along with it. */
  const dragSource = (todo: Todo, from: DragFrom, moves: boolean): DragHandlers => ({
    onDragStart: (event) => {
      // A sub-item is inside the row of its item, which is draggable too: only the one picked up is dragged.
      event.stopPropagation();
      event.dataTransfer.setData(TODO_DRAG_TYPE, String(todo.id));
      event.dataTransfer.effectAllowed = "move";
      setDragging({ id: todo.id, parentId: todo.parentId, from, moves });
    },
    onDragEnd: endDrag,
  });

  /** Puts an item just before or just after another one under the same parent. */
  function place(id: number, targetId: number, edge: Edge) {
    const target = todos.find((t) => t.id === targetId);
    if (!target) return;
    const siblings = todos.filter((t) => t.parentId === target.parentId);
    const next = siblings[siblings.findIndex((t) => t.id === targetId) + 1];
    void todosStore.move(id, edge === "before" ? targetId : (next?.id ?? null));
  }

  // A row takes a drop from an item of the same list under the same parent, which rearranges them. Anything else is left to
  // bubble up to the section (an item from another section) or to whoever wants it.
  const reorders = (todo: Todo, section: DragFrom) =>
    dragging !== null && dragging.id !== todo.id && dragging.parentId === todo.parentId && dragging.from === section;
  const rowDrag: RowDrag = {
    source: (todo, section) => dragSource(todo, section, todo.parentId === null && !todo.done),
    mark,
    onOver: (event, todo, section) => {
      if (!reorders(todo, section)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const edge = edgeOf(event);
      setMark((now) => (now?.id === todo.id && now.edge === edge ? now : { id: todo.id, edge }));
    },
    onLeave: (event, todo) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setMark((now) => (now?.id === todo.id ? null : now));
    },
    onDrop: (event, todo, section) => {
      if (!reorders(todo, section)) return;
      event.preventDefault();
      event.stopPropagation();
      const { id } = dragging!;
      endDrag();
      place(id, todo.id, edgeOf(event));
    },
  };

  // A section takes a drop only while an item it accepts is held; any other drag (a note, a panel) is left to whoever wants it.
  const dropZone = (target: DragTarget, accepts: (from: DragFrom) => boolean, onDropped: (id: number, from: DragFrom) => void): DropZone => ({
    state: dragging === null || !dragging.moves || !accepts(dragging.from) ? undefined : over === target ? "over" : "ready",
    onDragOver: (event) => {
      if (dragging === null || !dragging.moves || !accepts(dragging.from)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(target);
    },
    onDragLeave: (event) => {
      // Moving across what is inside the section is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOver((now) => (now === target ? null : now));
    },
    onDrop: (event) => {
      if (dragging === null || !dragging.moves || !accepts(dragging.from)) return;
      event.preventDefault();
      const { id, from } = dragging;
      endDrag();
      onDropped(id, from);
    },
  });
  // This week takes what comes from the Backlog or Rolled over; the Backlog takes what comes from This week.
  const weekDropZone = dropZone("this-week", (from) => from !== "this-week", (id, from) => {
    void (from === "rolled-over" ? todosStore.acceptRolled(id) : todosStore.setStatus(id, "todo"));
  });
  const backlogDropZone = dropZone("backlog", (from) => from === "this-week", (id) => void todosStore.setStatus(id, "backlog"));

  function setView(view: TodoView) {
    if (view !== state.view) store.setPanelState(panelId, { ...state, view } satisfies TodoPanelState);
  }

  /** Asks before removing; the item goes only on a yes, and the Undo is still there afterwards. */
  function askRemove(todo: Todo) {
    setRemoving(todo);
  }

  function confirmRemove() {
    if (!removing) return;
    const todo = removing;
    setRemoving(null);
    remove(todo);
  }

  // Removing keeps the item in the archive, and the Undo is there afterwards too.
  function remove(todo: Todo) {
    const subItems = countDescendants(todos, todo.id);
    setBar({ message: `Removed “${todo.title}”${subItems > 0 ? ` and ${subItems === 1 ? "1 sub-item" : `${subItems} sub-items`}` : ""}.`, undo: todo.id });
    void todosStore.remove(todo.id);
  }

  async function undoRemove() {
    if (bar?.undo === undefined) return;
    const id = bar.undo;
    setBar(null);
    await todosStore.restore(id);
  }

  async function restore(item: ArchivedTodo) {
    const result = await todosStore.restore(item.id);
    if (result.error) return;
    setBar({
      message: result.toTopLevel
        ? `Restored “${item.title}” at the top level, because what it was under is still archived.`
        : `Restored “${item.title}”.`,
    });
  }

  function closeDelete() {
    setDeleting(null);
    setPreviewed(null);
  }

  async function makeReport(kind: ReportKind, periodStart: string, label: string) {
    const result = await todosStore.generateReport(kind, periodStart);
    if (!result.error) setBar({ message: `Made a new report for ${label}.` });
  }

  function deleteForGood() {
    if (!deleting) return;
    const { id, title } = deleting;
    closeDelete();
    setBar({ message: `Deleted “${title}” permanently.` });
    void todosStore.deleteForGood(id);
  }

  // The to-do background chosen in Settings > Styling; the notes' background shows only where it says "Same as notes".
  const look = todoLookStyle(savedLook);

  const rowProps = {
    store,
    collapsed,
    onToggleCollapsed: toggleCollapsed,
    editing,
    onEdit: setEditing,
    addingTo,
    onAddTo: setAddingTo,
    onRemove: askRemove,
    onDeleteForGood: (todo: Todo) => setDeleting({ id: todo.id, title: todo.title }),
    onPlace: place,
    drag: rowDrag,
  };
  const rows = (nodes: TodoNode[], section: DragFrom) =>
    nodes.map((node) => <TodoRow key={node.todo.id} node={node} depth={0} {...rowProps} siblings={nodes} section={section} />);
  /** Whether the done items are already below the open ones among their siblings, so there is nothing for "Move completed to the bottom" to do. */
  const doneAtBottom = sortDoneLast(todos).every((t, i) => t.id === todos[i].id);
  /** Likewise for "Sort by priority". */
  const prioritySorted = sortByPriority(todos).every((t, i) => t.id === todos[i].id);
  const sortButton = (
    <Button
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      disabled={prioritySorted}
      title="Order the to-dos by priority, P1 first and those with none last"
      onClick={() => void todosStore.sortByPriority()}
    >
      <ArrowUpNarrowWideIcon />
      Sort by priority
    </Button>
  );
  const rolledEntries = (withChildren: boolean) =>
    sections.rolledOver.map((node) => (
      <RolledEntry
        key={node.todo.id}
        todo={node.todo}
        parentTitle={node.todo.parentId === null ? null : (titles.get(node.todo.parentId) ?? null)}
        subItems={withChildren ? 0 : countDescendants(todos, node.todo.id)}
        onAdd={() => void todosStore.acceptRolled(node.todo.id)}
        onBacklog={() => void todosStore.moveRolledToBacklog(node.todo.id)}
        onDrop={() => void todosStore.drop(node.todo.id)}
        drag={withChildren ? dragSource(node.todo, "rolled-over", true) : undefined}
      >
        {withChildren && node.children.length > 0 && <ul>{rows(node.children, "rolled-over")}</ul>}
      </RolledEntry>
    ));

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2 p-2", look.className)} style={look.style}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {state.view === "reports" ? (
            <span className="block px-1 text-sm text-muted-foreground">To-do reports</span>
          ) : state.view === "archive" ? (
            <Input
              type="search"
              aria-label="Search the archive"
              placeholder="Search the archive"
              value={query}
              className="h-7"
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : (
            <TitleInput
              label="New to-do"
              placeholder="Add a to-do"
              keepOpen
              addLabel="Add to-do"
              onSubmit={(title) => todosStore.add(title, null)}
            />
          )}
        </div>
        <div role="group" aria-label="View" className="flex shrink-0 gap-0.5 rounded-lg border p-0.5">
          {(
            [
              ["list", "List", ListIcon],
              ["board", "Board", KanbanIcon],
              ["reports", "Reports", FileTextIcon],
              ["archive", "Archive", ArchiveIcon],
            ] as const
          ).map(([view, label, Icon]) => (
            <Button
              key={view}
              variant={state.view === view ? "secondary" : "ghost"}
              size="icon-xs"
              aria-label={`${label} view`}
              aria-pressed={state.view === view}
              title={`${label} view`}
              onClick={() => setView(view)}
            >
              <Icon />
            </Button>
          ))}
        </div>
      </div>
      {setup?.pending && (
        <section aria-label="Archive completed items" className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm text-card-foreground">
          <p>Archive {setup.completed === 1 ? "1 item" : `${setup.completed} items`} you&apos;ve already completed?</p>
          <p className="text-xs text-muted-foreground">
            They are filed under the weeks they were last changed. If you leave them, they are archived at the end of the week
            instead, without a date.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void todosStore.finishSetup(true)}>
              Yes, archive {setup.completed === 1 ? "it" : "them"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void todosStore.finishSetup(false)}>
              No, leave {setup.completed === 1 ? "it" : "them"}
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", state.view === "list" && "overflow-y-auto")}>
        {status === "error" ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
            <span>The to-do list could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => void todosStore.load()}>
              Try again
            </Button>
          </div>
        ) : status !== "ready" ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : state.view === "reports" ? (
          sectionsOfReports === null ? (
            <p className="p-1 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <TodoReports
              sections={sectionsOfReports}
              onOpen={(report: TodoReportEntry) => store.openNoteBeside(report.noteId)}
              onRegenerate={(report: TodoReportEntry) => void makeReport(report.kind, report.periodStart, report.label)}
              onGenerate={(kind: ReportKind, period: TodoMissingReport) => void makeReport(kind, period.periodStart, period.label)}
            />
          )
        ) : state.view === "archive" ? (
          groups === null ? (
            <p className="p-1 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <TodoArchive
              groups={groups}
              searching={query.trim() !== ""}
              onRestore={(item) => void restore(item)}
              onDelete={(item) => setDeleting({ id: item.id, title: item.title })}
            />
          )
        ) : state.view === "board" ? (
          <>
            {sections.rolledOver.length > 0 && (
              <section aria-label="Rolled over" className="mb-2 flex max-h-48 shrink-0 flex-col gap-1 overflow-y-auto">
                <h3 className="px-1 text-xs font-medium text-muted-foreground">Rolled over ({sections.rolledOver.length})</h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1.5">{rolledEntries(false)}</ul>
              </section>
            )}
            <div className="min-h-0 flex-1">
              <TodoBoard
                todos={todos.filter((t) => !inRolledOver.has(t.id))}
                onMove={(id, next) => void todosStore.setStatus(id, next)}
                onRemove={askRemove}
                onDeleteForGood={rowProps.onDeleteForGood}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Section
              title="This week"
              folded={state.foldedSections.includes("this-week")}
              onToggle={() => toggleSection("this-week")}
              dropZone={weekDropZone}
              actions={
                sections.thisWeek.length > 0 && (
                  <div className="flex">
                    {sortButton}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      disabled={doneAtBottom}
                      title="Move the completed to-dos below the others"
                      onClick={() => void todosStore.sortDoneLast()}
                    >
                      <ArrowDownToLineIcon />
                      Completed to bottom
                    </Button>
                  </div>
                )
              }
            >
              {sections.thisWeek.length === 0 ? (
                <p className="p-1 text-sm text-muted-foreground">{todos.length === 0 ? "Nothing to do yet." : "Nothing this week."}</p>
              ) : (
                <ul aria-label="To-dos">
                  {rows(sections.thisWeek, "this-week")}
                </ul>
              )}
            </Section>
            {sections.rolledOver.length > 0 && (
              <Section
                title="Rolled over"
                count={sections.rolledOver.length}
                folded={state.foldedSections.includes("rolled-over")}
                onToggle={() => toggleSection("rolled-over")}
              >
                <ul aria-label="Rolled over items" className="flex flex-col gap-1.5">
                  {rolledEntries(true)}
                </ul>
              </Section>
            )}
            <Section
              title="Backlog"
              count={sections.backlog.length}
              folded={state.foldedSections.includes("backlog")}
              onToggle={() => toggleSection("backlog")}
              dropZone={backlogDropZone}
              actions={sections.backlog.length > 0 && sortButton}
            >
              <TitleInput
                label="New backlog item"
                placeholder="Add to the backlog"
                keepOpen
                addLabel="Add to backlog"
                onSubmit={(title) => todosStore.add(title, null, "backlog")}
              />
              {sections.backlog.length > 0 && (
                <ul aria-label="Backlog items">{rows(sections.backlog, "backlog")}</ul>
              )}
            </Section>
          </div>
        )}
      </div>
      {bar && (
        <div role="status" className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm text-card-foreground shadow-sm">
          <span className="min-w-0 break-words">{bar.message}</span>
          {bar.undo !== undefined && (
            <Button size="xs" variant="secondary" onClick={() => void undoRemove()}>
              Undo
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this to-do?"
        description={
          removing && (
            <>
              “{removing.title}”
              {(() => {
                const subItems = countDescendants(todos, removing.id);
                return subItems > 0 ? ` and ${subItems === 1 ? "its 1 sub-item" : `its ${subItems} sub-items`}` : "";
              })()}{" "}
              will be taken off the list and kept in the archive, where you can restore it.
            </>
          )
        }
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete permanently?"
        description={
          deleting && (
            <>
              “{deleting.title}”
              {preview !== "loading" && preview !== "error" && preview.items > 1
                ? ` and its ${preview.items - 1 === 1 ? "1 sub-item" : `${preview.items - 1} sub-items`}`
                : preview === "loading" || preview === "error"
                  ? " and anything under it"
                  : ""}{" "}
              will be erased for good, with {preview !== "loading" && preview !== "error" && preview.items > 1 ? "their" : "its"} history. This cannot be undone, and backup files you made earlier may still contain{" "}
              {preview !== "loading" && preview !== "error" && preview.items > 1 ? "them" : "it"}.
            </>
          )
        }
        confirmLabel="Delete permanently"
        confirmDisabled={preview === "loading"}
        onConfirm={deleteForGood}
        onCancel={closeDelete}
      >
        <div className="text-sm text-muted-foreground">
          {preview === "loading" ? (
            <p>Checking the reports…</p>
          ) : preview === "error" ? (
            <p>The reports could not be checked.</p>
          ) : preview.reports.length === 0 ? (
            <p>No report mentions it.</p>
          ) : (
            <>
              <p>These reports mention it. Deleting does not change them, so open one to edit it first:</p>
              <ul className="mt-1 flex flex-col items-start gap-0.5">
                {preview.reports.map((report) => (
                  <li key={report.noteId}>
                    <button
                      type="button"
                      className="text-left text-foreground underline underline-offset-2"
                      aria-label={`Open ${report.title}`}
                      onClick={() => {
                        closeDelete();
                        store.openNoteBeside(report.noteId);
                      }}
                    >
                      {report.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
