// The schema, as `apps/web/src/lib/composition/db.ts` defines it. The statement text is kept identical to the desktop's
// on purpose: the iPad's database must be indistinguishable from one the desktop made, so a backup restores in either
// direction (docs/ipad-app-design.md, "Data: GRDB over the same schema"). When db.ts changes, this file changes with it,
// and the conformance corpus fails until it does.

enum Schema {
    static let notes = """
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """

    static let groups = """
    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """

    static let notebooks = """
    CREATE TABLE IF NOT EXISTS notebooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """

    static let trash = """
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
    """

    static let attachments = """
    CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_note_id ON attachments (note_id);
    """

    // The plugin tables. The iPad v1 has no plugins (C6) but creates the tables, so its file has the desktop's shape and a
    // desktop backup restores into it without a missing table.

    static let todos = """
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
    """

    static let readingList = """
    CREATE TABLE IF NOT EXISTS reading_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """

    static let feeds = """
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
    """

    /// The PDFs notes own, their marks and their bookmarks (the desktop's `DOCUMENTS_SCHEMA`). The iPad has no PDF reader yet (docs/pdf-markup-plan.md,
    /// P3 puts it in M2), but it creates the tables so that its file has the desktop's shape and a desktop backup restores into it with its marks.
    static let documents = """
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
    """

    /// The Contacts plugin's rolodex (the desktop's `CONTACTS_SCHEMA`).
    static let contacts = """
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
    """

    static let todoCycle = """
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
    CREATE TABLE IF NOT EXISTS todo_places (
        place TEXT PRIMARY KEY,
        ref_id INTEGER NOT NULL
    );
    """

    /// The columns the weekly cycle adds to `todos`, as additive migrations.
    static let todoCycleColumns: [(column: String, ddl: String)] = [
        ("done_at", "ALTER TABLE todos ADD COLUMN done_at TEXT"),
        ("done_on", "ALTER TABLE todos ADD COLUMN done_on TEXT"),
        ("archived_at", "ALTER TABLE todos ADD COLUMN archived_at TEXT"),
        ("archive_week", "ALTER TABLE todos ADD COLUMN archive_week TEXT"),
        ("archive_reason", "ALTER TABLE todos ADD COLUMN archive_reason TEXT"),
        ("rolled_from_week", "ALTER TABLE todos ADD COLUMN rolled_from_week TEXT"),
        ("roll_count", "ALTER TABLE todos ADD COLUMN roll_count INTEGER NOT NULL DEFAULT 0"),
        ("position", "ALTER TABLE todos ADD COLUMN position INTEGER"),
        ("priority", "ALTER TABLE todos ADD COLUMN priority INTEGER"),
    ]

    /// Every row of these tables carries a `uuid` (docs/architecture/data-model.md#identity-the-uuid-column).
    static let uuidTables = ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments", "documents", "pdf_annotations", "pdf_bookmarks"]

    /// Built-in SQL only: an older desktop build opening this file has no user-defined functions, and its inserts must
    /// still work. So Swift never generates a uuid itself either.
    static let newUuid = "lower(hex(randomblob(16)))"

    /// Rows filled per write transaction, so the backfill never holds the writer for long.
    static let uuidBackfillBatch = 200

    /// The `AFTER INSERT` trigger that fills a missing uuid, and the unique index. SQLite keeps a trigger's text verbatim in
    /// `sqlite_master`, so the whitespace is part of the file: it is written out here to match db.ts character for
    /// character (its template literal sits eight spaces in), and the conformance test compares it exactly.
    static func uuidTriggerAndIndex(_ table: String) -> String {
        "CREATE TRIGGER IF NOT EXISTS trg_\(table)_fill_uuid AFTER INSERT ON \(table) WHEN NEW.uuid IS NULL\n"
            + "        BEGIN\n"
            + "          UPDATE \(table) SET uuid = \(newUuid) WHERE rowid = NEW.rowid;\n"
            + "        END;\n"
            + "        CREATE UNIQUE INDEX IF NOT EXISTS idx_\(table)_uuid ON \(table) (uuid);\n"
    }
}
