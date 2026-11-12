import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.resolve(here, "../../web");
export const COMPOSITION_LIB = path.join(WEB_DIR, "src/lib/composition");

// better-sqlite3 lives in apps/web/node_modules, not above this folder.
const requireFromWeb = createRequire(path.join(WEB_DIR, "package.json"));
export type Db = import("better-sqlite3").Database;
export const Database = requireFromWeb("better-sqlite3") as typeof import("better-sqlite3");

export function oracleDir(): string {
  const dir = process.env.COMPOSITION_ORACLE_DIR;
  if (!dir) throw new Error("Set COMPOSITION_ORACLE_DIR (run through apps/windows/scripts/conformance.sh).");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A throwaway HOME, so the real db.ts / backup.ts resolve ~/.composition into it and never into the user's data. */
export function isolatedHome(): { home: string; appDataDir: string; dbFile: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-windows-oracle-"));
  const appDataDir = path.join(home, ".composition");
  fs.mkdirSync(appDataDir, { recursive: true });
  return { home, appDataDir, dbFile: path.join(appDataDir, "composition.db") };
}

export type SchemaDump = {
  master: { type: string; name: string; tbl_name: string; sql: string | null }[];
  columns: Record<string, { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]>;
  schemaVersion: number;
  journalMode: string;
};

/** Everything that says what the database looks like to SQLite, sorted so creation order does not matter. */
export function dumpSchema(db: Db): SchemaDump {
  const master = (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as SchemaDump["master"]);
  const columns: SchemaDump["columns"] = {};
  for (const row of master.filter((r) => r.type === "table" && !r.name.startsWith("sqlite_"))) {
    columns[row.name] = db.prepare(`PRAGMA table_info(${row.name})`).all() as SchemaDump["columns"][string];
  }
  return {
    master,
    columns,
    schemaVersion: db.pragma("schema_version", { simple: true }) as number,
    journalMode: db.pragma("journal_mode", { simple: true }) as string,
  };
}

/** Every row of every table, by table name, rows in rowid order. uuids included (the caller decides what to ignore). */
export function dumpData(db: Db): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  for (const { name } of tables) out[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
  return out;
}

export function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** A database as the very first version created it (no tags, group_id, position, notebooks, uuid, Trash Can columns...). */
export function writeOldestDatabase(file: string): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE trashed_notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, group_id INTEGER, deleted_at TEXT NOT NULL);
    CREATE TABLE attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, file_name TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const t = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run("Legacy one", "one", t, t);
  db.prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run("Legacy two", "two\n\nwith [a link](note:1)", t, t);
  db.prepare("INSERT INTO groups (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run("Old group", null, t, t);
  db.prepare("INSERT INTO groups (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run("Old child", 1, t, t);
  db.prepare("INSERT INTO trashed_notes (id, title, content, created_at, updated_at, deleted_at) VALUES (7, 'Old trash', 'x', ?, ?, ?)").run(t, t, t);
  db.prepare("INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (1, 'a.pdf', 'a-1.pdf', 3, ?)").run(t);
  db.prepare("INSERT INTO todos (title, done, created_at, updated_at) VALUES ('ticked', 1, ?, ?), ('open', 0, ?, ?)").run(t, t, t, t);
  db.close();
}

/** Rows without a uuid column, the way an old build (or the CLI) writes them; the fill trigger must supply it. */
export function populate(db: Db, insertSql: (sql: string, ...params: unknown[]) => void): void {
  void db;
  const t = "2026-11-01T10:00:00.000Z";
  insertSql("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)", "Work", t, t);
  insertSql("INSERT INTO groups (name, parent_id, created_at, updated_at, notebook_id, position) VALUES (?, ?, ?, ?, ?, ?)", "Projects", null, t, t, 1, 0);
  insertSql("INSERT INTO groups (name, parent_id, created_at, updated_at, notebook_id, position) VALUES (?, ?, ?, ?, ?, ?)", "Sub", 1, t, t, 1, 0);
  for (let i = 1; i <= 6; i++) {
    insertSql(
      "INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, position, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      `Note ${i}`, `---\ntitle: Note ${i}\n---\nBody ${i} café ☕ 日本語`, i % 2 ? "a,b" : "", "", t, t, i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : null, i, 1,
    );
  }
  insertSql("INSERT INTO trashed_notes (id, title, content, created_at, updated_at, group_id, deleted_at, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", 90, "Trashed", "gone", t, t, null, t, 1);
  insertSql("INSERT INTO trashed_groups (id, name, parent_id, created_at, updated_at, deleted_at, notebook_id) VALUES (?, ?, ?, ?, ?, ?, ?)", 91, "Trashed group", null, t, t, t, 1);
  insertSql("INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (?, ?, ?, ?, ?)", 1, "Spec.pdf", "spec-1a2b3c.pdf", 5, t);
  insertSql(
    "INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, view_state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    2, "Paper.pdf", "paper-0a1b2c.pdf", "ab".repeat(32), 6, 2, null, t,
  );
  insertSql(
    "INSERT INTO pdf_annotations (document_id, page, kind, color, rects, quote, comment, body, group_uuid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    1, 0, "highlight", "yellow", "[[72,700,300,712]]", "a quoted line", "", null, null, t, t,
  );
  insertSql("INSERT INTO pdf_bookmarks (document_id, page, label, created_at) VALUES (?, ?, ?, ?)", 1, 1, "Intro", t);
}

/** The tables that carry a uuid (db.ts UUID_TABLES); every one of them must survive a round trip, uuid included. */
export const UUID_TABLES = ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments", "documents", "pdf_annotations", "pdf_bookmarks"];
