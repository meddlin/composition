import { getDb } from "./db";
import type { Todo } from "./todosApi";

type TodoRow = {
  id: number;
  parent_id: number | null;
  title: string;
  done: number;
  created_at: string;
  updated_at: string;
};

function fromRow(row: TodoRow): Todo {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    done: row.done === 1,
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
    .prepare("INSERT INTO todos (parent_id, title, done, created_at, updated_at) VALUES (?, ?, 0, ?, ?)")
    .run(parentId, title, now, now);
  const todo = getTodo(Number(result.lastInsertRowid));
  if (!todo) throw new Error("Failed to read back the to-do that was just added");
  return todo;
}

export function updateTodo(id: number, change: { title?: string; done?: boolean }): Todo | null {
  const current = getTodo(id);
  if (!current) return null;
  getDb()
    .prepare("UPDATE todos SET title = ?, done = ?, updated_at = ? WHERE id = ?")
    .run(change.title ?? current.title, (change.done ?? current.done) ? 1 : 0, new Date().toISOString(), id);
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
