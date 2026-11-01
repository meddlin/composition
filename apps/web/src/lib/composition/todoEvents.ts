import type { LocalDate } from "./todoWeeks";
import type { TodoStatus } from "./todosApi";

/**
 * The to-do activity log: one event for every change to an item, written as it happens and never shown. It is what
 * the weekly sweep and the reports read, because an item's row only says how it is now. Pure types and rules; the
 * table that holds them is in db.ts.
 */

export const EVENT_KINDS = ["created", "renamed", "status_changed", "rolled", "archived", "restored"] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** Why an item left the live list. Only `done` is the sweep's doing; the other two are the user's. */
export type ArchiveReason = "done" | "removed" | "dropped";

export type TodoEvent = {
  todoId: number;
  kind: EventKind;
  /** The instant it happened, ISO. */
  at: string;
  /** The local date it happened on, fixed when it was written, so changing the machine's time zone never moves it into another week. */
  on: LocalDate;
  /** The machine's offset from UTC in minutes, east positive, when it happened. */
  utcOffset?: number;
  /** `status_changed`: where the item was and where it went. */
  fromStatus?: TodoStatus;
  toStatus?: TodoStatus;
  /** `rolled` and `archived`: the first day of the week whose close did it (for `archived` by the user, the week it happened in). */
  weekStart?: LocalDate;
  /** `rolled`: how many weeks the item has now been through. */
  rollCount?: number;
  /** `archived`. */
  reason?: ArchiveReason;
};

/**
 * What status an item had at the end of `date`. `events` are that item's, oldest first. The row holds only the
 * status it has now, so this undoes the changes made after `date`: the first one says what it was before.
 */
export function statusAsOf(current: TodoStatus, events: readonly TodoEvent[], date: LocalDate): TodoStatus {
  const firstLater = events.find((event) => event.kind === "status_changed" && event.on > date);
  return firstLater?.fromStatus ?? current;
}
