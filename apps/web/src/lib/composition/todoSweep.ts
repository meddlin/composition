import { statusAsOf, type TodoEvent } from "./todoEvents";
import type { LocalDate, Period } from "./todoWeeks";
import type { TodoStatus } from "./todosApi";

/**
 * What closing a week does to the to-do list: done items go to the archive and open ones roll over to be placed in
 * the next week. Pure: it takes the items and the log and says what to do, and the repo does it. See
 * docs/todo-archival-plan.md (T2, T5, T6).
 */

/** What the sweep needs to know about an item as it is now. */
export type SweepItem = {
  id: number;
  parentId: number | null;
  status: TodoStatus;
  /** The local date it was made on. */
  createdOn: LocalDate;
  archived: boolean;
  /** Set while the item waits in Rolled over: the first day of the week it first rolled from. */
  rolledFromWeek: LocalDate | null;
  /** How many week closes it has been through while open. */
  rollCount: number;
};

/** What closing one week does. */
export type WeekPlan = {
  week: Period;
  /** The items that go to the archive, as done. */
  archive: number[];
  /** The items that roll over, with the values to store. */
  roll: { id: number; rolledFromWeek: LocalDate; rollCount: number }[];
};

/**
 * The plan for closing `weeks`, oldest first. Each week is judged by how every item stood at the end of its last day,
 * rebuilt from the log, because the sweep can run late: an item the owner pulled into the new week on Sunday must not
 * be rolled by a sweep that only runs on Monday.
 */
export function planSweep(items: readonly SweepItem[], events: readonly TodoEvent[], weeks: readonly Period[]): WeekPlan[] {
  const eventsOf = new Map<number, TodoEvent[]>();
  for (const event of events) eventsOf.set(event.todoId, [...(eventsOf.get(event.todoId) ?? []), event]);
  const childrenOf = new Map<number, SweepItem[]>();
  for (const item of items) {
    if (item.parentId !== null) childrenOf.set(item.parentId, [...(childrenOf.get(item.parentId) ?? []), item]);
  }

  // What each close leaves behind, which the next week in the same pass starts from.
  const state = new Map(
    items.map((item) => [item.id, { archived: item.archived, rolledFromWeek: item.rolledFromWeek, rollCount: item.rollCount }]),
  );

  return weeks.map((week) => {
    const existed = (item: SweepItem) => item.createdOn <= week.end;
    const statusThen = (item: SweepItem) => statusAsOf(item.status, eventsOf.get(item.id) ?? [], week.end);
    const archivedNow = (item: SweepItem) => state.get(item.id)!.archived;
    // An item is finished when it is done and so is everything under it; an archived one was done when it left, and a
    // sub-item made after the week ended does not count.
    const finished = (item: SweepItem): boolean =>
      archivedNow(item) ||
      !existed(item) ||
      (statusThen(item) === "done" && (childrenOf.get(item.id) ?? []).every(finished));

    const archive = items.filter((item) => !archivedNow(item) && existed(item) && finished(item)).map((item) => item.id);
    const roll = items
      .filter((item) => !archivedNow(item) && existed(item) && ["todo", "in_progress"].includes(statusThen(item)))
      .map((item) => {
        const before = state.get(item.id)!;
        return { id: item.id, rolledFromWeek: before.rolledFromWeek ?? week.start, rollCount: before.rollCount + 1 };
      });

    for (const id of archive) state.get(id)!.archived = true;
    for (const { id, rolledFromWeek, rollCount } of roll) Object.assign(state.get(id)!, { rolledFromWeek, rollCount });
    return { week, archive, roll };
  });
}
