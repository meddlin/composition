using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Composition.Core;

/// <summary>
/// The desktop's schema pass, ported from apps/web/src/lib/composition/db.ts (<c>openConnection</c>): the same
/// statements, in the same order, with the same text, so a database either side has touched is a no-op for the other.
/// The DDL strings below are copies of db.ts's and are guarded by the oracle comparison in the tests, not by being
/// shared; when db.ts changes, those tests fail until this file follows (apps/windows/scripts/conformance.sh; the
/// windows-core workflow runs it on every pull request that touches db.ts).
/// </summary>
public static class Schema
{
    private const string Notes = """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """;

    private const string Groups = """
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """;

    private const string Notebooks = """
        CREATE TABLE IF NOT EXISTS notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """;

    private const string Trash = """
        CREATE TABLE IF NOT EXISTS trashed_notes (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            group_id INTEGER,
            deleted_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS trashed_groups (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT NOT NULL
        );
        """;

    private const string Attachments = """
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments (note_id);
        """;

    /// <summary>db.ts DOCUMENTS_SCHEMA: PDFs a note owns, their marks and bookmarks (docs/pdf-markup-plan.md).</summary>
    private const string Documents = """
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            size INTEGER NOT NULL,
            page_count INTEGER NOT NULL,
            view_state TEXT,
            created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_note_id ON documents (note_id);
        CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents (sha256);
        CREATE TABLE IF NOT EXISTS pdf_annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page INTEGER NOT NULL,
            kind TEXT NOT NULL,
            color TEXT NOT NULL,
            rects TEXT,
            quote TEXT NOT NULL DEFAULT '',
            comment TEXT NOT NULL DEFAULT '',
            body TEXT,
            group_uuid TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pdf_annotations_page ON pdf_annotations (document_id, page);
        CREATE TABLE IF NOT EXISTS pdf_bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            page INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pdf_bookmarks_document ON pdf_bookmarks (document_id, page);
        """;

    private const string Todos = """
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER,
            title TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'todo',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todos_parent_id ON todos (parent_id);
        """;

    private const string TodoCycle = """
        CREATE TABLE IF NOT EXISTS todo_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            todo_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            at TEXT NOT NULL,
            on_date TEXT NOT NULL,
            utc_offset INTEGER NOT NULL DEFAULT 0,
            from_status TEXT,
            to_status TEXT,
            week_start TEXT,
            roll_count INTEGER,
            reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_todo_events_todo_id ON todo_events (todo_id);
        CREATE INDEX IF NOT EXISTS idx_todo_events_on_date ON todo_events (on_date);
        CREATE TABLE IF NOT EXISTS todo_closed (
            kind TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            closed_at TEXT NOT NULL,
            PRIMARY KEY (kind, period_start)
        );
        CREATE TABLE IF NOT EXISTS todo_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            note_id INTEGER NOT NULL,
            generated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_todo_reports_period ON todo_reports (kind, period_start);
        -- Where the reports go: the id of the To-do reports notebook and of its Weekly, Monthly and Quarterly groups, so a rename is
        -- followed and a deletion is noticed (and made again).
        CREATE TABLE IF NOT EXISTS todo_places (
            place TEXT PRIMARY KEY,
            ref_id INTEGER NOT NULL
        );
        """;

    private static readonly (string Column, string Ddl)[] TodoCycleColumns =
    [
        ("done_at", "ALTER TABLE todos ADD COLUMN done_at TEXT"),
        ("done_on", "ALTER TABLE todos ADD COLUMN done_on TEXT"),
        ("archived_at", "ALTER TABLE todos ADD COLUMN archived_at TEXT"),
        ("archive_week", "ALTER TABLE todos ADD COLUMN archive_week TEXT"),
        ("archive_reason", "ALTER TABLE todos ADD COLUMN archive_reason TEXT"),
        ("rolled_from_week", "ALTER TABLE todos ADD COLUMN rolled_from_week TEXT"),
        ("roll_count", "ALTER TABLE todos ADD COLUMN roll_count INTEGER NOT NULL DEFAULT 0"),
        ("position", "ALTER TABLE todos ADD COLUMN position INTEGER"),
        ("priority", "ALTER TABLE todos ADD COLUMN priority INTEGER"),
    ];

    private const string ReadingList = """
        CREATE TABLE IF NOT EXISTS reading_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL DEFAULT '',
            read INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """;

    private const string Contacts = """
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT 'personal',
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            birth_date TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            manager TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """;

    private const string Feeds = """
        CREATE TABLE IF NOT EXISTS feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL DEFAULT '',
            site_url TEXT NOT NULL DEFAULT '',
            etag TEXT NOT NULL DEFAULT '',
            last_modified TEXT NOT NULL DEFAULT '',
            last_fetched_at TEXT,
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feed_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feed_id INTEGER NOT NULL,
            guid TEXT NOT NULL,
            url TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            published_at TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            UNIQUE (feed_id, guid)
        );
        CREATE INDEX IF NOT EXISTS idx_feed_items_feed_published ON feed_items (feed_id, published_at);
        """;

    /// <summary>The tables that carry a uuid (db.ts UUID_TABLES), in its order: the order the triggers and indexes are made in.</summary>
    public static readonly string[] UuidTables =
    [
        "notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments",
        "documents", "pdf_annotations", "pdf_bookmarks",
    ];

    /// <summary>Built-in SQL only: an older build opening this file has no user-defined functions.</summary>
    private const string NewUuid = "lower(hex(randomblob(16)))";

    private const int UuidBackfillBatch = 200;

    /// <summary>
    /// Opens (creating if need be) the database at <paramref name="dbPath"/>, runs the schema pass and returns the
    /// connection. Pooling is off: on Windows a pooled connection keeps the file open after Close(), which would make the
    /// backup restore's file swap fail (mandatory file locks); the better-sqlite3 world has no pool.
    /// </summary>
    public static SqliteConnection Open(string dbPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = dbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());
        connection.Open();
        try
        {
            Pass(connection);
        }
        catch
        {
            connection.Dispose();
            throw;
        }
        return connection;
    }

    /// <summary>db.ts <c>openConnection</c>, after the connection is opened.</summary>
    public static void Pass(SqliteConnection db)
    {
        // better-sqlite3 waits up to five seconds for a lock; do the same so two writers (a CLI, this app) queue.
        Exec(db, "PRAGMA busy_timeout = 5000");
        Exec(db, "PRAGMA journal_mode = WAL");
        ExecDdl(db, Notes);
        ExecDdl(db, Groups);
        ExecDdl(db, Notebooks);
        ExecDdl(db, Trash);
        ExecDdl(db, Attachments);
        ExecDdl(db, Documents);
        ExecDdl(db, Todos);
        ExecDdl(db, ReadingList);
        ExecDdl(db, Feeds);
        ExecDdl(db, Contacts);
        // A database from before statuses: items already ticked off are "done", the rest keep the default "todo".
        if (!ColumnNames(db, "todos").Contains("status"))
        {
            Exec(db, "ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'");
            Exec(db, "UPDATE todos SET status = 'done' WHERE done = 1");
        }
        ExecDdl(db, TodoCycle);
        foreach (var (column, ddl) in TodoCycleColumns) EnsureColumn(db, "todos", column, ddl);
        EnsureColumn(db, "notes", "tags", "ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
        EnsureColumn(db, "notes", "description", "ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        EnsureColumn(db, "notes", "group_id", "ALTER TABLE notes ADD COLUMN group_id INTEGER");
        EnsureColumn(db, "notes", "position", "ALTER TABLE notes ADD COLUMN position INTEGER");
        EnsureColumn(db, "groups", "position", "ALTER TABLE groups ADD COLUMN position INTEGER");
        EnsureColumn(db, "notebooks", "position", "ALTER TABLE notebooks ADD COLUMN position INTEGER");
        foreach (var table in new[] { "notes", "groups", "trashed_notes", "trashed_groups" })
            EnsureColumn(db, table, "notebook_id", $"ALTER TABLE {table} ADD COLUMN notebook_id INTEGER");
        EnsureUuids(db);
        AdoptOrphans(db);
    }

    /// <summary>
    /// Runs one of the DDL constants above with LF line endings whatever the checkout has. A raw string literal takes the source
    /// file's line endings, and a Windows checkout with core.autocrlf has CRLF: SQLite would store that text in sqlite_master,
    /// and the schema would stop being byte-identical to the one db.ts writes (found on Windows, 2026-11-12).
    /// </summary>
    private static void ExecDdl(SqliteConnection db, string ddl) => Exec(db, ddl.ReplaceLineEndings("\n"));

    public static void EnsureColumn(SqliteConnection db, string table, string column, string ddl)
    {
        if (!ColumnNames(db, table).Contains(column)) Exec(db, ddl);
    }

    public static HashSet<string> ColumnNames(SqliteConnection db, string table)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        using var cmd = db.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({table})";
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) names.Add(reader.GetString(1));
        return names;
    }

    /// <summary>db.ts <c>ensureUuids</c>: column + trigger + unique index in one immediate transaction, then a batched backfill.</summary>
    public static void EnsureUuids(SqliteConnection db)
    {
        InImmediateTransaction(db, () =>
        {
            foreach (var table in UuidTables)
            {
                EnsureColumn(db, table, "uuid", $"ALTER TABLE {table} ADD COLUMN uuid TEXT");
                // Same text as db.ts's template literal (indentation included), so sqlite_master matches byte for byte.
                Exec(db, $"\n        CREATE TRIGGER IF NOT EXISTS trg_{table}_fill_uuid AFTER INSERT ON {table} WHEN NEW.uuid IS NULL\n"
                       + "        BEGIN\n"
                       + $"          UPDATE {table} SET uuid = {NewUuid} WHERE rowid = NEW.rowid;\n"
                       + "        END;\n"
                       + $"        CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_uuid ON {table} (uuid);\n      ");
            }
        });

        foreach (var table in UuidTables)
        {
            using var fill = db.CreateCommand();
            fill.CommandText = $"UPDATE {table} SET uuid = {NewUuid} WHERE rowid IN (SELECT rowid FROM {table} WHERE uuid IS NULL LIMIT {UuidBackfillBatch})";
            while (fill.ExecuteNonQuery() > 0) { }
        }
    }

    /// <summary>db.ts <c>adoptOrphans</c>: make sure there is a notebook, and that every note and group is in one.</summary>
    public static void AdoptOrphans(SqliteConnection db)
    {
        InImmediateTransaction(db, () =>
        {
            long? first;
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT MIN(id) FROM notebooks";
                var v = cmd.ExecuteScalar();
                first = v is null or DBNull ? null : Convert.ToInt64(v, CultureInfo.InvariantCulture);
            }
            if (first is null)
            {
                var now = Timestamp.Now();
                using var insert = db.CreateCommand();
                insert.CommandText = "INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Notebook', $now, $now); SELECT last_insert_rowid();";
                insert.Parameters.AddWithValue("$now", now);
                first = Convert.ToInt64(insert.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
            foreach (var table in new[] { "notes", "groups", "trashed_notes", "trashed_groups" })
            {
                using var update = db.CreateCommand();
                update.CommandText = $"UPDATE {table} SET notebook_id = $id WHERE notebook_id IS NULL";
                update.Parameters.AddWithValue("$id", first);
                update.ExecuteNonQuery();
            }
        });
    }

    public static void Exec(SqliteConnection db, string sql)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// <c>BEGIN IMMEDIATE</c>, like better-sqlite3's <c>.immediate()</c>. Written as plain SQL so the isolation-level
    /// mapping of the provider cannot change which kind of transaction it is.
    /// </summary>
    public static void InImmediateTransaction(SqliteConnection db, Action work)
    {
        Exec(db, "BEGIN IMMEDIATE");
        try
        {
            work();
            Exec(db, "COMMIT");
        }
        catch
        {
            Exec(db, "ROLLBACK");
            throw;
        }
    }
}

/// <summary>JavaScript's <c>Date.toISOString()</c>: millisecond precision, always UTC, always a trailing Z.</summary>
public static class Timestamp
{
    public static string Now() => Format(DateTime.UtcNow);

    public static string Format(DateTime utc) =>
        utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
