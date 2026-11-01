"use client";

import type { DragEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Todo } from "@/lib/composition/todosApi";

/** After this many week closes an item still waiting in Rolled over gets a gentle nudge. */
const NUDGE_AT = 3;

/** "Oct 18", for the first day of a week, in the viewer's own language. */
function weekLabel(firstDay: string): string {
  const [year, month, day] = firstDay.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One entry in Rolled over: an item (with its rolled sub-items beneath it, in the list) that was open when its week
 * closed, the week it first rolled from, how long it has waited, and the three things to do with it: add it to this
 * week, move it to the backlog, or drop it. Each acts on the whole rolled branch. Nothing happens by itself; after a few
 * weeks it only suggests moving or dropping it.
 */
export function RolledEntry({
  todo,
  parentTitle,
  subItems = 0,
  onAdd,
  onBacklog,
  onDrop,
  drag,
  children,
}: {
  todo: Todo;
  /** What it is under, when it was rolled without its parent. */
  parentTitle: string | null;
  /** How many sub-items it has, for an entry that does not list them. */
  subItems?: number;
  onAdd: () => void;
  onBacklog: () => void;
  onDrop: () => void;
  /** Makes the entry something to drag onto This week. */
  drag?: { onDragStart: (event: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  children?: ReactNode;
}) {
  const waited = todo.rollCount ?? 1;
  return (
    <li
      className="flex flex-col gap-1 rounded-md border bg-card p-2 text-sm text-card-foreground shadow-xs"
      draggable={drag ? true : undefined}
      onDragStart={drag?.onDragStart}
      onDragEnd={drag?.onDragEnd}
    >
      {parentTitle !== null && <span className="truncate text-xs text-muted-foreground">in {parentTitle}</span>}
      <span className="break-words">{todo.title}</span>
      {subItems > 0 && <span className="text-xs text-muted-foreground">and {subItems === 1 ? "1 sub-item" : `${subItems} sub-items`}</span>}
      <span className="text-xs text-muted-foreground">
        From the week of {weekLabel(todo.rolledFromWeek ?? "")}
        {waited >= 2 && ` · waiting ${waited} weeks`}
      </span>
      {waited >= NUDGE_AT && (
        <span className="text-xs italic text-muted-foreground">Rolled over {waited} times. Maybe move it to the backlog, or drop it?</span>
      )}
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="secondary" aria-label={`Add ${todo.title} to this week`} onClick={onAdd}>
          Add to this week
        </Button>
        <Button size="xs" variant="ghost" aria-label={`Move ${todo.title} to the backlog`} onClick={onBacklog}>
          Move to backlog
        </Button>
        <Button size="xs" variant="ghost" aria-label={`Drop ${todo.title}`} onClick={onDrop}>
          Drop
        </Button>
      </div>
      {children}
    </li>
  );
}
