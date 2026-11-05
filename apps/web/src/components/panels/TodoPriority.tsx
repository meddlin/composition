"use client";

import { FlagIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { priorityTag, TODO_PRIORITIES, TODO_PRIORITY_NAMES, type TodoPriority } from "@/lib/composition/todosApi";
import { cn } from "@/lib/utils";

/** How loud each priority is: P1 stands out, P5 is barely there. */
const TONES: Record<TodoPriority, string> = {
  1: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  2: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  3: "bg-secondary text-secondary-foreground",
  4: "border-border text-muted-foreground",
  5: "border-dashed border-border text-muted-foreground/80",
};

/** "P2", coloured by how urgent it is. Its full name ("P2 – High") is the tooltip and the accessible name. */
export function PriorityBadge({ priority, className }: { priority: TodoPriority; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-4 px-1.5 text-[11px]", TONES[priority], className)}
      title={`${priorityTag(priority)} – ${TODO_PRIORITY_NAMES[priority]}`}
      aria-label={`Priority ${priorityTag(priority)}, ${TODO_PRIORITY_NAMES[priority]}`}
    >
      {priorityTag(priority)}
    </Badge>
  );
}

const NONE = "none";

/**
 * The button that sets an item's priority. With one set it is the badge itself (always shown); with none it is a small
 * flag, which the row shows only while the pointer or focus is on it.
 */
export function PriorityMenu({
  title,
  priority,
  onChange,
}: {
  title: string;
  priority: TodoPriority | undefined;
  onChange: (priority: TodoPriority | null) => void;
}) {
  return (
    // Not modal, like the other row menus: an outside click closes it and goes through.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {priority === undefined ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Set the priority of ${title}`} title="Set priority">
            <FlagIcon />
          </Button>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded-4xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`Change the priority of ${title} (now ${priorityTag(priority)}, ${TODO_PRIORITY_NAMES[priority]})`}
          >
            <PriorityBadge priority={priority} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" loop aria-label={`Priority of ${title}`}>
        <DropdownMenuRadioGroup
          value={priority === undefined ? NONE : String(priority)}
          onValueChange={(value) => onChange(value === NONE ? null : (Number(value) as TodoPriority))}
        >
          {TODO_PRIORITIES.map((p) => (
            <DropdownMenuRadioItem key={p} value={String(p)}>
              {priorityTag(p)} – {TODO_PRIORITY_NAMES[p]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value={NONE}>No priority</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
