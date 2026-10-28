import { MAX_TODO_TITLE_LENGTH, type Todo, type TodoStatus } from "./todosApi";

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

/** The ids of the item and every item under it. */
export function subtreeIds(todos: readonly Todo[], id: number): Set<number> {
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

/** A title as it is stored: trimmed, on one line. Null when nothing is left, or it is too long to keep. */
export function cleanTodoTitle(title: string): string | null {
  const cleaned = title.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 && cleaned.length <= MAX_TODO_TITLE_LENGTH ? cleaned : null;
}
