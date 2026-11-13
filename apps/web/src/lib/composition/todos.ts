import { applyOrder, placeBefore } from "./ordering";
import { MAX_TODO_TITLE_LENGTH, type ArchivedTodo, type Todo, type TodoPriority, type TodoStatus } from "./todosApi";

/** An item with its sub-items, in order. */
export type TodoNode = { todo: Todo; children: TodoNode[] };

/** The items as a forest: top-level items in order, each with its sub-items. An item whose parent is missing is left out. */
export function buildTodoTree(todos: readonly Todo[]): TodoNode[] {
  const nodes = new Map<number, TodoNode>(todos.map((todo) => [todo.id, { todo, children: [] }]));
  const roots: TodoNode[] = [];
  for (const todo of todos) {
    const node = nodes.get(todo.id)!;
    if (todo.parentId === null) roots.push(node);
    else nodes.get(todo.parentId)?.children.push(node);
  }
  return roots;
}

/** The live list sorted into the three places an item can be: waiting in Rolled over, This week, or the Backlog. */
export type TodoSections = { rolledOver: TodoNode[]; thisWeek: TodoNode[]; backlog: TodoNode[] };

/**
 * Where each item is shown. A rolled-over item is the top of its own entry in Rolled over, with everything under it, even
 * when its parent is not rolled (it is then taken out from under the parent, which stays where it is). Every other
 * top-level item is in the Backlog if its status says so and in This week if not, with its sub-items beneath it whatever
 * their own status. The rolled mark wins over the backlog status. An item whose parent is missing is left out.
 */
export function todoSections(todos: readonly Todo[]): TodoSections {
  const rolled = new Set(todos.filter((t) => t.rolledFromWeek !== undefined).map((t) => t.id));
  const isRolledTop = (t: Todo) => rolled.has(t.id) && (t.parentId === null || !rolled.has(t.parentId));
  const rolledTops = new Set(todos.filter(isRolledTop).map((t) => t.id));

  const nodes = new Map<number, TodoNode>(todos.map((todo) => [todo.id, { todo, children: [] }]));
  for (const todo of todos) {
    if (todo.parentId !== null) nodes.get(todo.parentId)?.children.push(nodes.get(todo.id)!);
  }
  // A branch with the rolled entries taken out of it.
  const withoutRolled = (node: TodoNode): TodoNode => ({
    todo: node.todo,
    children: node.children.filter((child) => !rolledTops.has(child.todo.id)).map(withoutRolled),
  });

  const tops = todos.filter((t) => t.parentId === null && !rolled.has(t.id)).map((t) => withoutRolled(nodes.get(t.id)!));
  return {
    rolledOver: todos.filter(isRolledTop).map((t) => nodes.get(t.id)!),
    thisWeek: tops.filter((node) => node.todo.status !== "backlog"),
    backlog: tops.filter((node) => node.todo.status === "backlog"),
  };
}

/** One entry in the archive: an item, with the items archived under it in the same week beneath it. */
export type ArchiveEntry = {
  todo: ArchivedTodo;
  /** What it was under, for an entry that is not shown under its parent (the parent is on the list, or archived in another week). */
  parentTitle: string | null;
  children: ArchiveEntry[];
};

/** The archive's entries for one week. `week` is the first day of the week they were archived in. */
export type ArchiveGroup = { week: string; entries: ArchiveEntry[] };

/**
 * The archive as it is shown: filtered by what is typed (any part of a title, whatever the case), grouped by the week
 * archived, newest week first. A branch archived together is one entry with its sub-items under it; a sub-item archived
 * on its own, or whose parent does not match, is an entry of its own that says what it was under (`titles` knows every
 * item, listed or archived). Within a week the most recently archived come first, and what went at the same moment
 * (the weekly sweep) in the order it was made.
 */
export function archiveGroups(archived: readonly ArchivedTodo[], titles: ReadonlyMap<number, string>, query: string): ArchiveGroup[] {
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? archived : archived.filter((item) => item.title.toLowerCase().includes(needle));
  const byWeek = new Map<string, ArchivedTodo[]>();
  for (const item of shown) byWeek.set(item.archiveWeek, [...(byWeek.get(item.archiveWeek) ?? []), item]);

  return [...byWeek]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([week, items]) => {
      const inWeek = new Set(items.map((item) => item.id));
      const entries = new Map<number, ArchiveEntry>(
        items.map((todo) => [todo.id, { todo, parentTitle: todo.parentId === null ? null : (titles.get(todo.parentId) ?? null), children: [] }]),
      );
      const tops: ArchiveEntry[] = [];
      for (const todo of [...items].sort((a, b) => a.id - b.id)) {
        const entry = entries.get(todo.id)!;
        if (todo.parentId !== null && inWeek.has(todo.parentId)) {
          entry.parentTitle = null;
          entries.get(todo.parentId)!.children.push(entry);
        } else {
          tops.push(entry);
        }
      }
      tops.sort((a, b) => b.todo.archivedAt.localeCompare(a.todo.archivedAt) || a.todo.id - b.todo.id);
      return { week, entries: tops };
    });
}

/** The ids of the item and every item under it. */
export function subtreeIds(todos: readonly { id: number; parentId: number | null }[], id: number): Set<number> {
  const ids = new Set([id]);
  // Items are listed in no order the loop can rely on, so repeat until nothing new joins.
  for (let grew = true; grew; ) {
    grew = false;
    for (const todo of todos) {
      if (todo.parentId !== null && ids.has(todo.parentId) && !ids.has(todo.id)) {
        ids.add(todo.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** How many items are under this one, at any depth. */
export function countDescendants(todos: readonly Todo[], id: number): number {
  return subtreeIds(todos, id).size - 1;
}

/** The item moved to a status. Ticking and the board both go through here, so `done` can't drift from `status`. */
export function withStatus(todo: Todo, status: TodoStatus): Todo {
  return { ...todo, status, done: status === "done" };
}

/** The item ticked or unticked: done goes to "done"; unticking a done item puts it back to "todo", and any other status is kept. */
export function withDone(todo: Todo, done: boolean): Todo {
  if (done) return withStatus(todo, "done");
  return withStatus(todo, todo.status === "done" ? "todo" : todo.status);
}

/**
 * The items with `id` moved to sit immediately before `beforeId` among its siblings (the items under the same parent), or
 * last among them when `beforeId` is null or not one of them. Everything else keeps its place. The repo persists the same
 * rule (todosRepo.ts), so the screen shows at once what will be stored.
 */
export function placeTodo(todos: readonly Todo[], id: number, beforeId: number | null): Todo[] {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return [...todos];
  const siblings = todos.filter((t) => t.parentId === todo.parentId).map((t) => t.id);
  return applyOrder([...todos], placeBefore(siblings, id, beforeId));
}

/**
 * The items with `id` (and everything under it) moved under `parentId`, or to the top level when that is null, placed
 * immediately before `beforeId` among its new siblings, or last when `beforeId` is null or not one of them. Unchanged
 * when the item is missing or the parent is the item itself or under it. The repo persists the same rule (todosRepo.ts).
 */
export function nestTodo(todos: readonly Todo[], id: number, parentId: number | null, beforeId: number | null): Todo[] {
  if (!todos.some((t) => t.id === id) || (parentId !== null && subtreeIds(todos, id).has(parentId))) return [...todos];
  return placeTodo(
    todos.map((t) => (t.id === id ? { ...t, parentId } : t)),
    id,
    beforeId,
  );
}

/** Every group of siblings, as ids in display order with the open items first and the done ones after, each keeping its own order. */
export function doneLastGroups(todos: readonly Todo[]): number[][] {
  const groups = new Map<number | null, Todo[]>();
  for (const todo of todos) groups.set(todo.parentId, [...(groups.get(todo.parentId) ?? []), todo]);
  return [...groups.values()].map((group) => [...group.filter((t) => !t.done), ...group.filter((t) => t.done)].map((t) => t.id));
}

/** The items with the done ones moved below the open ones among their siblings, at every level. Nothing else changes order. */
export function sortDoneLast(todos: readonly Todo[]): Todo[] {
  return doneLastGroups(todos).reduce((list, ids) => applyOrder(list, ids), [...todos]);
}

/** The item with its priority set, or cleared with null. */
export function withPriority(todo: Todo, priority: TodoPriority | null): Todo {
  const { priority: _old, ...rest } = todo;
  void _old;
  return priority === null ? rest : { ...rest, priority };
}

/** Every group of siblings, as ids in priority order: P1 first, items with none last, equal ones keeping the order they have. */
export function priorityGroups(todos: readonly Todo[]): number[][] {
  const groups = new Map<number | null, Todo[]>();
  for (const todo of todos) groups.set(todo.parentId, [...(groups.get(todo.parentId) ?? []), todo]);
  const rank = (todo: Todo) => todo.priority ?? Number.POSITIVE_INFINITY;
  // Array.prototype.sort is stable, so equal priorities keep their order.
  return [...groups.values()].map((group) => [...group].sort((a, b) => rank(a) - rank(b)).map((t) => t.id));
}

/** The items sorted by priority among their siblings, at every level. Nothing else changes order. */
export function sortByPriority(todos: readonly Todo[]): Todo[] {
  return priorityGroups(todos).reduce((list, ids) => applyOrder(list, ids), [...todos]);
}

/** A title as it is stored: trimmed, on one line. Null when nothing is left, or it is too long to keep. */
export function cleanTodoTitle(title: string): string | null {
  const cleaned = title.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 && cleaned.length <= MAX_TODO_TITLE_LENGTH ? cleaned : null;
}
