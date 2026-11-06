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

const UUID_TABLES = ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments"] as const;
/** 128 random bits, as lowercase hex: what `lower(hex(randomblob(16)))` makes. */
const UUID_PATTERN = /^[0-9a-f]{32}$/;

type UuidRow = { id: number; uuid: string | null };
const uuidsOf = (db: Database.Database, table: string) =>
  db.prepare(`SELECT id, uuid FROM ${table} ORDER BY id`).all() as UuidRow[];

/**
 * Puts a database file back as the build before uuids left it: no column, no trigger, no index. The file must not be
 * open in the app.
 */
function dropUuids(file: string): void {
  const db = new Database(file);
  for (const table of UUID_TABLES) {
    db.exec(`
      DROP TRIGGER trg_${table}_fill_uuid;
      DROP INDEX idx_${table}_uuid;
      ALTER TABLE ${table} DROP COLUMN uuid;
    `);
  }
  db.close();
}

/**
 * A little of everything in the current schema: two notebooks, a group with a note in it, a trashed note and a trashed
 * group, and an attachment. Returns the ids of the live note and group.
 */
async function seedEverything() {
  const notebooks = await import("./notebooksRepo");
  const groups = await import("./groupsRepo");
  const notes = await import("./notesRepo");
  const trash = await import("./trashRepo");
  const attachments = await import("./attachmentsRepo");

  const second = notebooks.createNotebook("Second");
  const group = groups.createGroup("Projects", null, second.id);
  const note = notes.createNote("In a group", "", group.id);
  const loose = notes.createNote("Loose", "", null, second.id);
  const doomedNote = notes.createNote("Doomed", "", null, second.id);
  const doomedGroup = groups.createGroup("Doomed group", null, second.id);
  attachments.addAttachment(note.id, "report.pdf", "abc-report.pdf", 12);
  trash.trashNote(doomedNote.id);
  trash.trashGroup(doomedGroup.id);
  return { notebook: second, group, note, loose, doomedNote, doomedGroup };
}

describe("opening the database", () => {
  it("creates every table in a new file", async () => {
    const { getDb } = await import("./db");
    const db = getDb();

    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((t) => t.name)
      .filter((name) => !name.startsWith("sqlite_"));
    expect(tables.sort()).toEqual([
      "attachments",
      "feed_items",
      "feeds",
      "groups",
      "notebooks",
      "notes",
      "reading_list",
      "todo_closed",
      "todo_events",
      "todo_places",
      "todo_reports",
      "todos",
      "trashed_groups",
      "trashed_notes",
    ]);
    expect(columnsOf(db, "attachments").sort()).toEqual(
      ["created_at", "file_name", "id", "note_id", "size", "stored_name", "uuid"].sort(),
    );
    const indexes = db.prepare("PRAGMA index_list(attachments)").all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("idx_attachments_note_id");
  });

  describe("the to-do weekly cycle", () => {
    const CYCLE_COLUMNS = [
      "done_at",
      "done_on",
      "archived_at",
      "archive_week",
      "archive_reason",
      "rolled_from_week",
      "roll_count",
      "position",
      "priority",
    ];

    it("gives a new database the columns, and tables for the log, the closed periods and the reports", async () => {
      const { getDb } = await import("./db");
      const db = getDb();

      expect(columnsOf(db, "todos")).toEqual(expect.arrayContaining(CYCLE_COLUMNS));
      expect(columnsOf(db, "todo_events").sort()).toEqual(
        ["at", "from_status", "id", "kind", "on_date", "reason", "roll_count", "to_status", "todo_id", "utc_offset", "week_start"].sort(),
      );
      expect(columnsOf(db, "todo_closed").sort()).toEqual(["closed_at", "kind", "period_end", "period_start"]);
      expect(columnsOf(db, "todo_reports").sort()).toEqual(
        ["generated_at", "id", "kind", "note_id", "period_end", "period_start"].sort(),
      );
      expect(columnsOf(db, "todo_places").sort()).toEqual(["place", "ref_id"]);
    });

    it("adds the columns to a to-do table that predates them, keeping its items as they were", async () => {
      const old = new Database(dbFile);
      old.exec(`CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, title TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'todo', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      old.prepare("INSERT INTO todos (title, done, status, created_at, updated_at) VALUES ('Kept', 1, 'done', 'c', 'u')").run();
      old.close();

      const { getDb } = await import("./db");
      const db = getDb();

      expect(columnsOf(db, "todos")).toEqual(expect.arrayContaining(CYCLE_COLUMNS));
      expect(db.prepare("SELECT * FROM todos").get()).toEqual({
        id: 1,
        parent_id: null,
        title: "Kept",
        done: 1,
        status: "done",
        created_at: "c",
        updated_at: "u",
        done_at: null,
        done_on: null,
        archived_at: null,
        archive_week: null,
        archive_reason: null,
        rolled_from_week: null,
        roll_count: 0,
        position: null,
        priority: null,
      });
    });

    it("leaves the log and the to-dos alone when the database is opened again", async () => {
      const first = await import("./db");
      const db = first.getDb();
      db.prepare("INSERT INTO todos (title, created_at, updated_at) VALUES ('A', 'c', 'u')").run();
      db.prepare("INSERT INTO todo_events (todo_id, kind, at, on_date) VALUES (1, 'created', 'c', '2026-10-27')").run();
      first.closeDb();

      const again = first.getDb();

      expect(again.prepare("SELECT COUNT(*) AS n FROM todos").get()).toEqual({ n: 1 });
      expect(again.prepare("SELECT todo_id, kind, on_date, utc_offset FROM todo_events").all()).toEqual([
        { todo_id: 1, kind: "created", on_date: "2026-10-27", utc_offset: 0 },
      ]);
    });
  });

  it("puts everything an older database held into one notebook", async () => {
    writeOldDatabase([...NOTE_COLUMNS]);
    const { getDb } = await import("./db");
    const db = getDb();

    const notebooks = db.prepare("SELECT id, name FROM notebooks").all() as { id: number; name: string }[];
    expect(notebooks).toEqual([{ id: 1, name: "Notebook" }]);
    expect(db.prepare("SELECT notebook_id FROM notes").get()).toEqual({ notebook_id: 1 });
  });

  it("gives rows written without a notebook (by an older CLI) to the first notebook when reopened", async () => {
    const first = await import("./db");
    const db = first.getDb();
    db.prepare("INSERT INTO notes (title, created_at, updated_at) VALUES ('Late', 'x', 'x')").run();
    first.closeDb();

    expect(first.getDb().prepare("SELECT notebook_id FROM notes").get()).toEqual({ notebook_id: 1 });
    expect(first.getDb().prepare("SELECT COUNT(*) AS n FROM notebooks").get()).toEqual({ n: 1 });
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
      [
        "content",
        "created_at",
        "description",
        "group_id",
        "id",
        "notebook_id",
        "position",
        "tags",
        "title",
        "updated_at",
        "uuid",
      ].sort(),
    );
    expect(columnsOf(db, "groups")).toContain("position");
    expect(db.prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 1 });
  });

  it("gives the note of the oldest database, and the notebook made for it, a uuid", async () => {
    writeOldDatabase([...NOTE_COLUMNS]);
    const { getDb } = await import("./db");
    const db = getDb();

    expect(db.prepare("SELECT title, uuid FROM notes").get()).toEqual({
      title: "Legacy note",
      uuid: expect.stringMatching(UUID_PATTERN),
    });
    expect(db.prepare("SELECT name, uuid FROM notebooks").get()).toEqual({
      name: "Notebook",
      uuid: expect.stringMatching(UUID_PATTERN),
    });
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

/**
 * Every note, group, notebook, trashed item and attachment has a `uuid` that no device shares and nothing re-issues. The
 * integer `id` stays the local handle; the uuid is what a second device (the iPad, a sync server) will know a row by.
 */
describe("uuids", () => {
  const countRows = (db: Database.Database, table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  describe("a database that predates them", () => {
    it("gives every row, in every table, a unique uuid, and keeps the rows as they were", async () => {
      const first = await import("./db");
      first.getDb();
      await seedEverything();
      first.closeDb();
      dropUuids(dbFile);
      const before = new Database(dbFile, { readonly: true });
      const idsBefore = Object.fromEntries(
        UUID_TABLES.map((table) => [table, (before.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: number }[]).map((r) => r.id)]),
      );
      before.close();

      const db = first.getDb();

      const everyUuid: string[] = [];
      for (const table of UUID_TABLES) {
        const rows = uuidsOf(db, table);
        expect(rows.map((r) => r.id), table).toEqual(idsBefore[table]);
        expect(rows.length, table).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.uuid, `${table} ${row.id}`).toMatch(UUID_PATTERN);
          everyUuid.push(row.uuid!);
        }
      }
      expect(new Set(everyUuid).size).toBe(everyUuid.length);
    });

    it("indexes the column uniquely, so two rows can never share a uuid", async () => {
      const { getDb } = await import("./db");
      const db = getDb();

      for (const table of UUID_TABLES) {
        const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as { name: string; unique: number }[];
        const index = indexes.find((i) => i.name === `idx_${table}_uuid`);
        expect(index?.unique, table).toBe(1);
      }
      db.prepare("INSERT INTO notebooks (name, uuid, created_at, updated_at) VALUES ('A', 'same', 'x', 'x')").run();
      expect(() =>
        db.prepare("INSERT INTO notebooks (name, uuid, created_at, updated_at) VALUES ('B', 'same', 'x', 'x')").run(),
      ).toThrow(/UNIQUE/);
    });

    it("fills a table bigger than one batch", async () => {
      writeOldDatabase([...NOTE_COLUMNS]);
      const old = new Database(dbFile);
      const insert = old.prepare("INSERT INTO notes (title, created_at, updated_at) VALUES (?, 'x', 'x')");
      old.transaction(() => {
        for (let i = 0; i < 649; i++) insert.run(`Note ${i}`);
      })();
      old.close();

      const { getDb } = await import("./db");
      const rows = uuidsOf(getDb(), "notes");

      expect(rows).toHaveLength(650);
      expect(rows.every((r) => r.uuid !== null && UUID_PATTERN.test(r.uuid))).toBe(true);
      expect(new Set(rows.map((r) => r.uuid)).size).toBe(650);
    });

    it("keeps the uuids it already has and fills only the gaps, as when an earlier open was cut short", async () => {
      const first = await import("./db");
      first.getDb();
      await seedEverything();
      const before = uuidsOf(first.getDb(), "notes");
      first.closeDb();
      const raw = new Database(dbFile);
      raw.prepare("UPDATE notes SET uuid = NULL WHERE id % 2 = 0").run();
      raw.close();

      const after = uuidsOf(first.getDb(), "notes");

      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      for (const [index, row] of after.entries()) {
        expect(row.uuid).toMatch(UUID_PATTERN);
        if (row.id % 2 === 1) expect(row.uuid).toBe(before[index].uuid);
      }
    });
  });

  describe("a row written by an older build, which does not know the column", () => {
    /** What every build before uuids inserts: no `uuid`. A plain connection has no user-defined functions either. */
    const OLDER_INSERTS: readonly [table: (typeof UUID_TABLES)[number], sql: string][] = [
      ["notebooks", "INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Old notebook', 'x', 'x')"],
      ["groups", "INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at) VALUES ('Old group', NULL, 1, 'x', 'x')"],
      ["notes", "INSERT INTO notes (title, content, created_at, updated_at) VALUES ('Old note', '', 'x', 'x')"],
      ["notes", "INSERT INTO notes (title, content, created_at, updated_at) VALUES ('Second old note', '', 'x', 'x')"],
      ["trashed_notes", "INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (900, 'Old trashed note', 'x', 'x', 'x')"],
      ["trashed_groups", "INSERT INTO trashed_groups (id, name, created_at, updated_at, deleted_at) VALUES (900, 'Old trashed group', 'x', 'x', 'x')"],
      ["attachments", "INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) VALUES (1, 'a.txt', 'a.txt', 1, 'x')"],
    ];

    it("still gets a uuid in every table, from the trigger", async () => {
      const first = await import("./db");
      first.getDb();
      first.closeDb();

      const older = new Database(dbFile);
      const given: string[] = [];
      for (const [table, sql] of OLDER_INSERTS) {
        const { lastInsertRowid } = older.prepare(sql).run();
        const row = older.prepare(`SELECT uuid FROM ${table} WHERE rowid = ?`).get(lastInsertRowid) as { uuid: string | null };
        expect(row.uuid, table).toMatch(UUID_PATTERN);
        given.push(row.uuid!);
      }
      older.close();

      expect(new Set(given).size).toBe(given.length);
    });

    it("does not lose a uuid it was given, and does not replace one the insert sets", async () => {
      const { getDb } = await import("./db");
      const db = getDb();

      db.prepare("INSERT INTO notes (title, uuid, created_at, updated_at) VALUES ('Chosen', 'cafe', 'x', 'x')").run();

      expect(db.prepare("SELECT uuid FROM notes WHERE title = 'Chosen'").get()).toEqual({ uuid: "cafe" });
    });

    it("gives the trashed row of an older build's Trash move a uuid, though not the note's", async () => {
      const first = await import("./db");
      const notes = await import("./notesRepo");
      first.getDb();
      const note = notes.createNote("Trashed by an old build");
      first.closeDb();

      const older = new Database(dbFile);
      older.exec(`
        INSERT OR REPLACE INTO trashed_notes
          (id, title, content, tags, description, created_at, updated_at, group_id, notebook_id, deleted_at)
        SELECT id, title, content, tags, description, created_at, updated_at, group_id, notebook_id, 'x'
        FROM notes WHERE id = ${note.id};
        DELETE FROM notes WHERE id = ${note.id};
      `);
      const trashed = older.prepare("SELECT uuid FROM trashed_notes WHERE id = ?").get(note.id) as { uuid: string };
      older.close();

      expect(trashed.uuid).toMatch(UUID_PATTERN);
      expect(trashed.uuid).not.toBe(note.uuid);
    });
  });

  describe("opening the database again", () => {
    it("changes nothing: the same uuids, one column, one trigger and one index per table", async () => {
      const first = await import("./db");
      first.getDb();
      await seedEverything();
      const schemaOf = (db: Database.Database) =>
        db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
      const snapshot = (db: Database.Database) =>
        Object.fromEntries(UUID_TABLES.map((table) => [table, uuidsOf(db, table)]));
      const before = { schema: schemaOf(first.getDb()), uuids: snapshot(first.getDb()) };
      first.closeDb();

      const again = first.getDb();

      expect(schemaOf(again)).toEqual(before.schema);
      expect(snapshot(again)).toEqual(before.uuids);
      for (const table of UUID_TABLES) {
        expect(columnsOf(again, table).filter((c) => c === "uuid"), table).toHaveLength(1);
        const triggers = again.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(table);
        expect(triggers, table).toHaveLength(1);
      }
    });

    it("does not write to the file, so it never holds up another app's writes", async () => {
      const first = await import("./db");
      first.getDb();
      await seedEverything();
      first.closeDb();
      const watcher = new Database(dbFile, { readonly: true });
      const before = watcher.pragma("data_version", { simple: true });

      first.getDb();

      expect(watcher.pragma("data_version", { simple: true })).toBe(before);
      watcher.close();
    });
  });

  describe("the Trash Can", () => {
    it("keeps a note's uuid through the trash and back", async () => {
      const notes = await import("./notesRepo");
      const trash = await import("./trashRepo");
      const { getDb } = await import("./db");
      const note = notes.createNote("Round trip");
      expect(note.uuid).toMatch(UUID_PATTERN);

      trash.trashNote(note.id);
      expect(getDb().prepare("SELECT uuid FROM trashed_notes WHERE id = ?").get(note.id)).toEqual({ uuid: note.uuid });
      expect(trash.getTrashedNotes([note.id])[0].uuid).toBe(note.uuid);
      expect(notes.getNote(note.id)).toBeNull();

      expect(trash.restoreNote(note.id)).toEqual({ restoredToTopLevel: false });
      expect(notes.getNote(note.id)?.uuid).toBe(note.uuid);
    });

    it("keeps a group's uuid through the trash and back", async () => {
      const groups = await import("./groupsRepo");
      const trash = await import("./trashRepo");
      const { getDb } = await import("./db");
      const group = groups.createGroup("Round trip");
      expect(group.uuid).toMatch(UUID_PATTERN);

      trash.trashGroup(group.id);
      expect(getDb().prepare("SELECT uuid FROM trashed_groups WHERE id = ?").get(group.id)).toEqual({ uuid: group.uuid });
      expect(groups.getGroup(group.id)).toBeNull();

      expect(trash.restoreGroup(group.id)).toEqual({ restoredToTopLevel: false });
      expect(groups.getGroup(group.id)?.uuid).toBe(group.uuid);
    });

    it("keeps the uuid when the note's group is gone and it comes back at the top level", async () => {
      const groups = await import("./groupsRepo");
      const notes = await import("./notesRepo");
      const trash = await import("./trashRepo");
      const group = groups.createGroup("Soon gone");
      const note = notes.createNote("Orphaned", "", group.id);
      trash.trashNote(note.id);
      trash.trashGroup(group.id);

      expect(trash.restoreNote(note.id)).toEqual({ restoredToTopLevel: true });

      expect(notes.getNote(note.id)).toMatchObject({ uuid: note.uuid, groupId: null });
    });

    it("keeps the uuid when the note's id has been taken, and the note comes back under a new one", async () => {
      const notes = await import("./notesRepo");
      const trash = await import("./trashRepo");
      const { getDb } = await import("./db");
      const note = notes.createNote("Clash");
      trash.trashNote(note.id);
      getDb().prepare("INSERT INTO notes (id, title, created_at, updated_at, notebook_id) VALUES (?, 'Squatter', 'x', 'x', 1)").run(note.id);

      expect(trash.restoreNote(note.id)).not.toBeNull();

      const restored = notes.listNotes().find((n) => n.title === "Clash");
      expect(restored?.id).not.toBe(note.id);
      expect(restored?.uuid).toBe(note.uuid);
    });

    it("gives the note a new uuid if another live note already holds its own", async () => {
      const notes = await import("./notesRepo");
      const trash = await import("./trashRepo");
      const { getDb } = await import("./db");
      const note = notes.createNote("Duplicate");
      trash.trashNote(note.id);
      getDb().prepare("INSERT INTO notes (title, uuid, created_at, updated_at, notebook_id) VALUES ('Holder', ?, 'x', 'x', 1)").run(note.uuid);

      expect(trash.restoreNote(note.id)).not.toBeNull();

      const restored = notes.getNote(note.id);
      expect(restored?.uuid).toMatch(UUID_PATTERN);
      expect(restored?.uuid).not.toBe(note.uuid);
      expect(countRows(getDb(), "trashed_notes")).toBe(0);
    });
  });

  describe("moving things around", () => {
    it("leaves the uuids alone when notes and groups change group or notebook, are renamed or are reordered", async () => {
      const first = await import("./db");
      first.getDb();
      const { notebook, group, note, loose } = await seedEverything();
      const notes = await import("./notesRepo");
      const groups = await import("./groupsRepo");
      const notebooks = await import("./notebooksRepo");
      const uuids = () => ({
        notes: uuidsOf(first.getDb(), "notes"),
        groups: uuidsOf(first.getDb(), "groups"),
        notebooks: uuidsOf(first.getDb(), "notebooks"),
      });
      const before = uuids();

      const third = notebooks.createNotebook("Third");
      groups.moveGroupToNotebook(group.id, third.id);
      notes.setNoteGroup(note.id, null);
      notes.placeNote(loose.id, null, note.id);
      groups.placeGroup(group.id, null, null);
      groups.renameGroup(group.id, "Renamed");
      notebooks.renameNotebook(notebook.id, "Renamed too");
      notebooks.placeNotebook(third.id, notebook.id);

      const after = uuids();
      expect(after.notes).toEqual(before.notes);
      expect(after.groups).toEqual(before.groups);
      expect(after.notebooks.slice(0, before.notebooks.length)).toEqual(before.notebooks);
      expect(after.notebooks.map((r) => r.id)).toContain(third.id);
    });
  });

  describe("backups", () => {
    /** The two steps of a restore, as the service does them (service.restoreBackup). */
    async function restore(file: string): Promise<void> {
      const { closeDb } = await import("./db");
      const backup = await import("./backup");
      const { loadWebSettings, resolvedDbPath } = await import("./webSettings");
      const settings = loadWebSettings();
      const staged = await backup.stageBackup(file, settings.appDataDir);
      closeDb();
      backup.applyStagedBackup(staged, { appDataDir: settings.appDataDir, dbPath: resolvedDbPath(settings) });
    }

    async function backUp(file: string): Promise<void> {
      const { getDb } = await import("./db");
      const backup = await import("./backup");
      const { loadWebSettings } = await import("./webSettings");
      const settings = loadWebSettings();
      await backup.createBackup({ file, db: getDb(), appDataDir: settings.appDataDir, settings });
    }

    const everyUuid = (db: Database.Database) =>
      Object.fromEntries(UUID_TABLES.map((table) => [table, uuidsOf(db, table)]));

    it("snapshots the column, the trigger and the index along with the rows", async () => {
      const { getDb } = await import("./db");
      const backup = await import("./backup");
      const { loadWebSettings } = await import("./webSettings");
      getDb();
      await seedEverything();
      const file = path.join(home, "backup.tar.gz");
      await backUp(file);

      const staged = await backup.stageBackup(file, loadWebSettings().appDataDir);
      const snapshot = new Database(path.join(staged.dir, "composition.db"), { readonly: true });

      expect(everyUuid(snapshot)).toEqual(everyUuid(getDb()));
      for (const table of UUID_TABLES) {
        const objects = snapshot
          .prepare("SELECT name FROM sqlite_master WHERE tbl_name = ? AND type IN ('trigger', 'index')")
          .all(table) as { name: string }[];
        expect(objects.map((o) => o.name), table).toEqual(
          expect.arrayContaining([`trg_${table}_fill_uuid`, `idx_${table}_uuid`]),
        );
      }
      snapshot.close();
      await backup.discardStagedBackup(staged);
    });

    it("brings every uuid back when it is restored, over data that has since changed", async () => {
      const first = await import("./db");
      const notes = await import("./notesRepo");
      const trash = await import("./trashRepo");
      first.getDb();
      await seedEverything();
      const original = everyUuid(first.getDb());
      const file = path.join(home, "backup.tar.gz");
      await backUp(file);
      notes.createNote("Made after the backup");
      for (const { id } of notes.listNotes().slice(0, 2)) trash.trashNote(id);
      expect(everyUuid(first.getDb())).not.toEqual(original);

      await restore(file);

      expect(everyUuid(first.getDb())).toEqual(original);
    });

    it("leaves a restored database able to give an older build's inserts a uuid", async () => {
      const first = await import("./db");
      first.getDb();
      await seedEverything();
      const file = path.join(home, "backup.tar.gz");
      await backUp(file);
      await restore(file);
      first.getDb();
      first.closeDb();

      const older = new Database(dbFile);
      older.prepare("INSERT INTO notes (title, created_at, updated_at) VALUES ('Written later', 'x', 'x')").run();
      const row = older.prepare("SELECT uuid FROM notes WHERE title = 'Written later'").get() as { uuid: string };
      older.close();

      expect(row.uuid).toMatch(UUID_PATTERN);
    });

    it("backfills a restored backup from before uuids when the database is opened", async () => {
      const first = await import("./db");
      const backup = await import("./backup");
      const { writeArchive } = await import("./tarArchive");
      const { loadWebSettings } = await import("./webSettings");
      first.getDb();
      const { note } = await seedEverything();
      const current = path.join(home, "backup.tar.gz");
      await backUp(current);
      // The same backup as an older build would have made it: unpack the database, strip the uuids, pack it again.
      const staged = await backup.stageBackup(current, loadWebSettings().appDataDir);
      const oldDatabase = path.join(home, "old.db");
      fs.copyFileSync(path.join(staged.dir, "composition.db"), oldDatabase);
      await backup.discardStagedBackup(staged);
      dropUuids(oldDatabase);
      const manifest = { format: "composition-backup", version: 1, createdAt: "2026-01-01T00:00:00.000Z", counts: {} };
      const old = path.join(home, "old.tar.gz");
      await writeArchive(old, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [
        { name: "composition.db", file: oldDatabase },
      ]);

      await restore(old);

      const db = first.getDb();
      const restored = everyUuid(db);
      const all: string[] = [];
      for (const table of UUID_TABLES) {
        expect(restored[table].length, table).toBeGreaterThan(0);
        for (const row of restored[table]) {
          expect(row.uuid, `${table} ${row.id}`).toMatch(UUID_PATTERN);
          all.push(row.uuid!);
        }
      }
      expect(new Set(all).size).toBe(all.length);
      expect(db.prepare("SELECT title FROM notes WHERE id = ?").get(note.id)).toEqual({ title: "In a group" });
    });
  });
});
