"use client";

import { ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { buildTodoTree, countDescendants, type TodoNode } from "@/lib/composition/todos";
import { MAX_TODO_TITLE_LENGTH, type Todo } from "@/lib/composition/todosApi";
import type { TodoResult } from "@/lib/composition/todosStore";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import type { WorkspaceStore } from "../notes/workspaceStore";
import type { TodoPanelState } from "./kinds";
import type { PanelId } from "./layoutTree";
import { todoLookStyle } from "./todoLookStyle";

/** How far, in px, each level of sub-items is pushed in. */
const INDENT = 20;

/**
 * A text box for a to-do's title. Enter sends it, Escape gives up. `keepOpen` is for adding several in a row: the box
 * clears and stays instead of closing after each one.
 */
function TitleInput({
  initial = "",
  label,
  placeholder,
  keepOpen = false,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  label: string;
  placeholder?: string;
  keepOpen?: boolean;
  autoFocus?: boolean;
  onSubmit: (title: string) => Promise<TodoResult>;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Enter closes a box that is leaving, and the blur that follows must not send the title a second time.
  const finished = useRef(false);

  async function submit() {
    const title = value.trim();
    if (title === "") return;
    if (!keepOpen) finished.current = true;
    const { error } = await onSubmit(title);
    if (error) finished.current = false;
    else if (keepOpen) setValue("");
  }

  return (
    <Input
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
  onDelete: (todo: Todo) => void;
};

function TodoRow(props: RowProps) {
  const { node, depth, store, collapsed, onToggleCollapsed, editing, onEdit, addingTo, onAddTo, onDelete } = props;
  const { todo, children } = node;
  const folded = collapsed.has(todo.id);
  const shownChildren = children.length > 0 && !folded;

  return (
    <li>
      <div
        className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-muted/50 focus-within:bg-muted/50"
        style={{ paddingLeft: depth * INDENT }}
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
        {editing !== todo.id && (
          <div className="flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <Button variant="ghost" size="icon-xs" aria-label={`Add a sub-item to ${todo.title}`} onClick={() => {
              onToggleCollapsed(todo.id, false);
              onAddTo(todo.id);
            }}>
              <PlusIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Rename ${todo.title}`} onClick={() => onEdit(todo.id)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Delete ${todo.title}`} onClick={() => onDelete(todo)}>
              <Trash2Icon />
            </Button>
          </div>
        )}
      </div>
      {(shownChildren || addingTo === todo.id) && (
        <ul>
          {shownChildren && children.map((child) => <TodoRow key={child.todo.id} {...props} node={child} depth={depth + 1} />)}
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

/**
 * A to-do list: items with sub-items, to add, rename, delete and tick off (a done item is struck through). The items
 * are the workspace's, so every to-do panel, in any window, shows the same list; the panel itself saves only which
 * items it has folded away.
 */
export function TodoPanel({ store, panelId, state }: { store: WorkspaceStore; panelId: PanelId; state: TodoPanelState }) {
  const todosStore = store.todos;
  const { status, todos, look: savedLook, error } = useSyncExternalStore(todosStore.subscribe, todosStore.getSnapshot, todosStore.getSnapshot);
  const [editing, setEditing] = useState<number | null>(null);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Todo | null>(null);

  useEffect(() => {
    void todosStore.load();
  }, [todosStore]);

  const tree = useMemo(() => buildTodoTree(todos), [todos]);
  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);

  function toggleCollapsed(id: number, fold: boolean) {
    if (collapsed.has(id) === fold) return;
    const next = fold ? [...state.collapsed, id] : state.collapsed.filter((c) => c !== id);
    store.setPanelState(panelId, { ...state, collapsed: next } satisfies TodoPanelState);
  }

  function askToDelete(todo: Todo) {
    // An item with nothing under it is quick to type again; one with sub-items is not.
    if (countDescendants(todos, todo.id) === 0) void todosStore.remove(todo.id);
    else setDeleting(todo);
  }

  const underDeleting = deleting ? countDescendants(todos, deleting.id) : 0;
  // The to-do background chosen in Settings > Styling; the notes' background shows only where it says "Same as notes".
  const look = todoLookStyle(savedLook);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2 p-2", look.className)} style={look.style}>
      <TitleInput
        label="New to-do"
        placeholder="Add a to-do"
        keepOpen
        onSubmit={(title) => todosStore.add(title, null)}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === "error" ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
            <span>The to-do list could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => void todosStore.load()}>
              Try again
            </Button>
          </div>
        ) : status !== "ready" ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : tree.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">Nothing to do yet.</p>
        ) : (
          <ul aria-label="To-dos">
            {tree.map((node) => (
              <TodoRow
                key={node.todo.id}
                node={node}
                depth={0}
                store={store}
                collapsed={collapsed}
                onToggleCollapsed={toggleCollapsed}
                editing={editing}
                onEdit={setEditing}
                addingTo={addingTo}
                onAddTo={setAddingTo}
                onDelete={askToDelete}
              />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this to-do?"
        description={
          deleting && (
            <>
              “{deleting.title}” and its {underDeleting === 1 ? "sub-item" : `${underDeleting} sub-items`} will be deleted for good.
            </>
          )
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void todosStore.remove(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
