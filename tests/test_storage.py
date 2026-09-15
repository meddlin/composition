import sqlite3
from datetime import UTC, datetime

from _doubles import FakeSearchIndex

from composition.storage import NotesStore


def test_delete_note_removes_it(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    note = store.create_note("Test Note")

    store.delete_note(note.id)

    assert store.get_note(note.id) is None
    assert note.id not in [n.id for n in store.list_notes()]


def test_create_note_indexes_into_search(tmp_path):
    fake = FakeSearchIndex()
    store = NotesStore(tmp_path / "test.db", search_index=fake)

    note = store.create_note("Test Note", tags="a,b")

    assert fake.indexed[-1].id == note.id
    assert fake.indexed[-1].tags == "a,b"


def test_update_note_content_reindexes(tmp_path):
    fake = FakeSearchIndex()
    store = NotesStore(tmp_path / "test.db", search_index=fake)
    note = store.create_note("Test Note")

    store.update_note_content(note.id, "new content")

    assert len(fake.indexed) == 2
    assert fake.indexed[-1].content == "new content"


def test_delete_note_removes_from_search(tmp_path):
    fake = FakeSearchIndex()
    store = NotesStore(tmp_path / "test.db", search_index=fake)
    note = store.create_note("Test Note")

    store.delete_note(note.id)

    assert fake.deleted == [note.id]


def test_notes_store_works_without_search_index(tmp_path):
    store = NotesStore(tmp_path / "test.db")

    note = store.create_note("Test Note")
    store.update_note_content(note.id, "content")
    store.delete_note(note.id)

    assert store.get_note(note.id) is None


def test_migration_adds_tags_column_to_existing_db(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.execute(
        """
        CREATE TABLE notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    now = datetime.now(UTC).isoformat()
    connection.execute(
        "INSERT INTO notes (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("Legacy Note", "legacy content", now, now),
    )
    connection.commit()
    connection.close()

    store = NotesStore(db_path)

    notes = store.list_notes()
    assert len(notes) == 1
    assert notes[0].tags == ""

    note = store.create_note("New Note")
    assert note.tags == ""


def test_migration_adds_description_column_to_existing_db(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.execute(
        """
        CREATE TABLE notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    now = datetime.now(UTC).isoformat()
    connection.execute(
        "INSERT INTO notes (title, content, tags, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("Legacy Note", "legacy content", "", now, now),
    )
    connection.commit()
    connection.close()

    store = NotesStore(db_path)

    notes = store.list_notes()
    assert len(notes) == 1
    assert notes[0].description == ""

    note = store.create_note("New Note")
    assert note.description == ""


def test_create_note_content_includes_generated_frontmatter(tmp_path):
    store = NotesStore(tmp_path / "test.db")

    note = store.create_note("My Title")

    assert note.content.startswith("---\n")
    assert "title: My Title" in note.content


def test_update_note_syncs_title_tags_description_and_reindexes(tmp_path):
    fake = FakeSearchIndex()
    store = NotesStore(tmp_path / "test.db", search_index=fake)
    note = store.create_note("Old Title")

    store.update_note(
        note.id,
        "new content",
        title="New Title",
        tags="a,b",
        description="a new description",
    )

    updated = store.get_note(note.id)
    assert updated.content == "new content"
    assert updated.title == "New Title"
    assert updated.tags == "a,b"
    assert updated.description == "a new description"
    assert fake.indexed[-1].title == "New Title"
    assert fake.indexed[-1].tags == "a,b"


def test_update_note_content_does_not_touch_title_tags_description(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    note = store.create_note("Original Title", tags="x,y")
    store.update_note(
        note.id, note.content, title="Original Title", tags="x,y", description="orig"
    )

    store.update_note_content(note.id, "---\ntitle: Sneaky\n---\nnew body")

    updated = store.get_note(note.id)
    assert updated.content == "---\ntitle: Sneaky\n---\nnew body"
    assert updated.title == "Original Title"
    assert updated.tags == "x,y"
    assert updated.description == "orig"
