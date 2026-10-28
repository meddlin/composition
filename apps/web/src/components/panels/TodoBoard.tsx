"use client";

import { ChevronLeftIcon, ChevronRightIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TODO_STATUSES, type Todo, type TodoStatus } from "@/lib/composition/todosApi";
import { cn } from "@/lib/utils";

export const STATUS_LABELS: Record<TodoStatus, string> = {
  backlog: "Backlog",
  todo: "To-do",
  in_progress: "In progress",
  done: "Done",
};

function Card({
  todo,
  parentTitle,
  dragging,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  todo: Todo;
  parentTitle: string | null;
  dragging: boolean;
  onMove: (id: number, status: TodoStatus) => void;
  onDelete: (todo: Todo) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const at = TODO_STATUSES.indexOf(todo.status);
  const before = at > 0 ? TODO_STATUSES[at - 1] : null;
  const after = at < TODO_STATUSES.length - 1 ? TODO_STATUSES[at + 1] : null;

  return (
    <li
      draggable
      aria-label={todo.title}
      className={cn(
        "group flex cursor-grab flex-col gap-1 rounded-md border bg-card p-2 text-sm text-card-foreground shadow-xs active:cursor-grabbing",
        dragging && "opacity-40",
      )}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(todo.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {parentTitle !== null && <span className="truncate text-xs text-muted-foreground">in {parentTitle}</span>}
      <span className={cn("break-words", todo.done && "text-muted-foreground line-through")}>{todo.title}</span>
      <div className="flex items-center justify-between">
        <div className="flex">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={before === null}
            aria-label={before ? `Move ${todo.title} to ${STATUS_LABELS[before]}` : `Move ${todo.title} back`}
            onClick={() => before && onMove(todo.id, before)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={after === null}
            aria-label={after ? `Move ${todo.title} to ${STATUS_LABELS[after]}` : `Move ${todo.title} forward`}
            onClick={() => after && onMove(todo.id, after)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Delete ${todo.title}`}
          onClick={() => onDelete(todo)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

/**
 * The items as a board: a column per status, a card per item. A card moves with the arrows on it, or by dragging it
 * to another column. Every item is a card, sub-items too (they say what they are under); moving an item does not
 * move the items under it.
 */
export function TodoBoard({
  todos,
  onMove,
  onDelete,
}: {
  todos: readonly Todo[];
  onMove: (id: number, status: TodoStatus) => void;
  onDelete: (todo: Todo) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<TodoStatus | null>(null);
  const titles = new Map(todos.map((t) => [t.id, t.title]));

  function drop(status: TodoStatus) {
    const moved = todos.find((t) => t.id === dragging);
    setDragging(null);
    setOver(null);
    if (moved && moved.status !== status) onMove(moved.id, status);
  }

  return (
    <div className="flex h-full min-h-0 gap-2 overflow-x-auto" role="group" aria-label="To-do board">
      {TODO_STATUSES.map((status) => {
        const cards = todos.filter((t) => t.status === status);
        return (
          <section
            key={status}
            aria-label={STATUS_LABELS[status]}
            className={cn(
              "flex min-h-0 w-52 shrink-0 flex-1 flex-col gap-2 rounded-lg border bg-muted/40 p-2",
              over === status && dragging !== null && "border-ring bg-muted",
            )}
            onDragOver={(event) => {
              if (dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== status) setOver(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(status);
            }}
          >
            <h3 className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
              {STATUS_LABELS[status]}
              <span aria-label={`${cards.length} ${cards.length === 1 ? "item" : "items"}`}>{cards.length}</span>
            </h3>
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto" aria-label={`${STATUS_LABELS[status]} items`}>
              {cards.map((todo) => (
                <Card
                  key={todo.id}
                  todo={todo}
                  parentTitle={todo.parentId === null ? null : (titles.get(todo.parentId) ?? null)}
                  dragging={dragging === todo.id}
                  onMove={onMove}
                  onDelete={onDelete}
                  onDragStart={() => setDragging(todo.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
