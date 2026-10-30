import { getDb } from "./db";
import type { ReadingItem } from "./readingListApi";

type ReadingRow = {
  id: number;
  url: string;
  title: string;
  read: number;
  created_at: string;
  updated_at: string;
};

function fromRow(row: ReadingRow): ReadingItem {
  return { id: row.id, url: row.url, title: row.title, read: row.read === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listReadingItems(): ReadingItem[] {
  return (getDb().prepare("SELECT * FROM reading_list ORDER BY id").all() as ReadingRow[]).map(fromRow);
}

export function getReadingItem(id: number): ReadingItem | null {
  const row = getDb().prepare("SELECT * FROM reading_list WHERE id = ?").get(id) as ReadingRow | undefined;
  return row ? fromRow(row) : null;
}

export function findReadingItemByUrl(url: string): ReadingItem | null {
  const row = getDb().prepare("SELECT * FROM reading_list WHERE url = ?").get(url) as ReadingRow | undefined;
  return row ? fromRow(row) : null;
}

export function addReadingItem(url: string): ReadingItem {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare("INSERT INTO reading_list (url, title, read, created_at, updated_at) VALUES (?, '', 0, ?, ?)")
    .run(url, now, now);
  const item = getReadingItem(Number(result.lastInsertRowid));
  if (!item) throw new Error("Failed to read back the link that was just added");
  return item;
}

/** A change to a link: its title and/or whether it is read. Null when the link is gone. */
export function updateReadingItem(id: number, change: { title?: string; read?: boolean }): ReadingItem | null {
  const current = getReadingItem(id);
  if (!current) return null;
  getDb()
    .prepare("UPDATE reading_list SET title = ?, read = ?, updated_at = ? WHERE id = ?")
    .run(change.title ?? current.title, (change.read ?? current.read) ? 1 : 0, new Date().toISOString(), id);
  return getReadingItem(id);
}

export function deleteReadingItem(id: number): void {
  getDb().prepare("DELETE FROM reading_list WHERE id = ?").run(id);
}
