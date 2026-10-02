import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The schema and its additive migrations live only here: the CLI, the web app and the
 * desktop app all open the same `composition.db` through this module, so a database
 * written by any older version has to come up to date in place without losing a note.
 */

let home: string;
let dbFile: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-db-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
  dbFile = path.join(home, ".composition", "composition.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const NOTE_COLUMNS = ["tags", "description", "group_id"] as const;
const COLUMN_DDL: Record<(typeof NOTE_COLUMNS)[number], string> = {
  tags: "tags TEXT NOT NULL DEFAULT ''",
  description: "description TEXT NOT NULL DEFAULT ''",
  group_id: "group_id INTEGER",
};

/** A `notes` table as an earlier version created it: without some of the later columns. */
function writeOldDatabase(missing: readonly (typeof NOTE_COLUMNS)[number][]): void {
  const later = NOTE_COLUMNS.filter((column) => !missing.includes(column)).map((c) => COLUMN_DDL[c]);
  const db = new Database(dbFile);
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      ${later.map((ddl) => `${ddl},`).join("\n      ")}
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.prepare("INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    "Legacy note",
    "legacy content",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  );
  db.close();
}

const columnsOf = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("opening the database", () => {
  it("creates every table in a new file", async () => {
    const { getDb } = await import("./db");
    const db = getDb();

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((t) => t.name)
      .filter((name) => !name.startsWith("sqlite_"));
    expect(tables.sort()).toEqual(["attachments", "groups", "notes", "trashed_groups", "trashed_notes"]);
    expect(columnsOf(db, "attachments").sort()).toEqual(
      ["created_at", "file_name", "id", "note_id", "size", "stored_name"].sort(),
    );
    const indexes = db.prepare("PRAGMA index_list(attachments)").all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_attachments_note_id");
  });

  it("turns on write-ahead logging, which lets several apps share the file", async () => {
    const { getDb } = await import("./db");

    expect(getDb().pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it.each(NOTE_COLUMNS.map((column) => [column]))(
    "adds the %s column to a database that predates it, keeping the note",
    async (column) => {
      writeOldDatabase([column]);
      const { getDb } = await import("./db");
      const db = getDb();

      expect(columnsOf(db, "notes")).toContain(column);
      const note = db.prepare("SELECT title, content, tags, description, group_id FROM notes").get();
      expect(note).toEqual({
        title: "Legacy note",
        content: "legacy content",
        tags: "",
        description: "",
        group_id: null,
      });
    },
  );

  it("adds every later column to the oldest database at once", async () => {
    writeOldDatabase([...NOTE_COLUMNS]);
    const { getDb } = await import("./db");
    const db = getDb();

    expect(columnsOf(db, "notes").sort()).toEqual(
      ["content", "created_at", "description", "group_id", "id", "tags", "title", "updated_at"].sort(),
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 1 });
  });

  it("leaves a current database and its notes alone when it is opened again", async () => {
    writeOldDatabase([...NOTE_COLUMNS]);
    const first = await import("./db");
    first.getDb().prepare("UPDATE notes SET tags = 'work'").run();
    first.closeDb();

    const reopened = first.getDb();

    expect(reopened.prepare("SELECT tags FROM notes").get()).toEqual({ tags: "work" });
    expect(columnsOf(reopened, "notes").filter((c) => c === "tags")).toHaveLength(1);
  });
});
