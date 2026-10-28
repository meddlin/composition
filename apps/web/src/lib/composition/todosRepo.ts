import { getDb } from "./db";
import { withDone, withStatus } from "./todos";
import { isTodoStatus, type Todo, type TodoStatus } from "./todosApi";

type TodoRow = {
  id: number;
  parent_id: number | null;
  title: string;
  done: number;
  status: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: TodoRow): Todo {
  // `done` is the one a row from an older version is sure to have right; a status that isn't one of ours falls back to it.
  const done = row.done === 1;
  const status: TodoStatus = isTodoStatus(row.status) ? row.status : done ? "done" : "todo";
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    status,
    done: status === "done",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTodos(): Todo[] {
  return (getDb().prepare("SELECT * FROM todos ORDER BY id").all() as TodoRow[]).map(fromRow);
}

export function getTodo(id: number): Todo | null {
  const row = getDb().prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
  return row ? fromRow(row) : null;
}

export function addTodo(title: string, parentId: number | null): Todo {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare("INSERT INTO todos (parent_id, title, done, status, created_at, updated_at) VALUES (?, ?, 0, 'todo', ?, ?)")
    .run(parentId, title, now, now);
  const todo = getTodo(Number(result.lastInsertRowid));
  if (!todo) throw new Error("Failed to read back the to-do that was just added");
  return todo;
}

/** A change to an item: a new title, and/or ticking it (`done`) or moving it (`status`; wins over `done` if both are given). */
export function updateTodo(id: number, change: { title?: string; done?: boolean; status?: TodoStatus }): Todo | null {
  const current = getTodo(id);
  if (!current) return null;
  let next = current;
  if (change.done !== undefined) next = withDone(next, change.done);
  if (change.status !== undefined) next = withStatus(next, change.status);
  getDb()
    .prepare("UPDATE todos SET title = ?, done = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(change.title ?? current.title, next.done ? 1 : 0, next.status, new Date().toISOString(), id);
  return getTodo(id);
}

/** Deletes the item and every item under it. */
export function deleteTodoTree(id: number): void {
  getDb()
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM todos WHERE id = ?
         UNION ALL
         SELECT t.id FROM todos t JOIN subtree s ON t.parent_id = s.id
       )
       DELETE FROM todos WHERE id IN (SELECT id FROM subtree)`,
    )
    .run(id);
}
