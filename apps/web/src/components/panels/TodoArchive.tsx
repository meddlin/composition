"use client";

import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArchiveEntry, ArchiveGroup } from "@/lib/composition/todos";
import type { ArchivedTodo } from "@/lib/composition/todosApi";

const REASONS: Record<ArchivedTodo["archiveReason"], string> = { done: "Done", removed: "Removed", dropped: "Dropped" };

/** "Oct 13", in the viewer's own language. */
const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The first day of a week, "2026-10-25", as "Oct 25". */
function weekLabel(firstDay: string): string {
  const [year, month, day] = firstDay.split("-").map(Number);
  return shortDate(new Date(year, month - 1, day));
}

/** When it left the list: the day it was done for a done item (when that is known), else the day it was removed or dropped. */
function whenLabel(todo: ArchivedTodo): string {
  const stamp = todo.archiveReason === "done" ? todo.doneAt : todo.archivedAt;
  const date = stamp ? new Date(stamp) : null;
  return date && !Number.isNaN(date.getTime()) ? shortDate(date) : "";
}

function Row({ entry, onRestore, onDelete }: { entry: ArchiveEntry; onRestore: (todo: ArchivedTodo) => void; onDelete: (todo: ArchivedTodo) => void }) {
  const { todo } = entry;
  const when = whenLabel(todo);
  return (
    <li className="flex flex-col gap-1 rounded-md border bg-card p-2 text-sm text-card-foreground shadow-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {entry.parentTitle !== null && <span className="block truncate text-xs text-muted-foreground">in {entry.parentTitle}</span>}
          <span className="break-words">{todo.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{REASONS[todo.archiveReason]}</span>
            {when && <span>{when}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <Button size="xs" variant="secondary" aria-label={`Restore ${todo.title}`} onClick={() => onRestore(todo)}>
            Restore
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Delete ${todo.title} permanently`} title="Delete permanently" onClick={() => onDelete(todo)}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {entry.children.length > 0 && (
        <ul className="ml-4 flex flex-col gap-1">
          {entry.children.map((child) => (
            <Row key={child.todo.id} entry={child} onRestore={onRestore} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The archive: what left the list, a week at a time (newest first), each entry marked done, removed or dropped, with a
 * branch that was archived together kept together. Restore brings an entry back to the list; Delete permanently erases it.
 */
export function TodoArchive({
  groups,
  searching,
  onRestore,
  onDelete,
}: {
  groups: ArchiveGroup[];
  /** Whether something is typed in the search box, so an empty archive can say whether that is why. */
  searching: boolean;
  onRestore: (todo: ArchivedTodo) => void;
  onDelete: (todo: ArchivedTodo) => void;
}) {
  if (groups.length === 0) {
    return <p className="p-1 text-sm text-muted-foreground">{searching ? "Nothing in the archive matches that." : "Nothing has been archived yet."}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <section key={group.week} aria-label={`Archived in the week of ${group.week}`} className="flex flex-col gap-1">
          <h3 className="px-1 text-xs font-medium text-muted-foreground">Week of {weekLabel(group.week)}</h3>
          <ul aria-label="Archived items" className="flex flex-col gap-1.5">
            {group.entries.map((entry) => (
              <Row key={entry.todo.id} entry={entry} onRestore={onRestore} onDelete={onDelete} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
