import sqlite3
from datetime import UTC, datetime

import pytest
from _doubles import FakeSearchIndex

from composition.storage import GroupNotEmptyError, NotesStore


def test_delete_note_removes_it(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    note = store.create_note("Test Note")

    store.delete_note(note.id)

    assert store.get_note(note.id) is None
    assert note.id not in [n.id for n in store.list_notes()]


def _attach(db_path, note_id, stored_name):
    """What the desktop app does when a file is attached: a row plus a file."""
    attachments = db_path.parent / "attachments"
    attachments.mkdir(exist_ok=True)
    (attachments / stored_name).write_text("bytes")
    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO attachments (note_id, file_name, stored_name, size, created_at) "
        "VALUES (?, 'report.pdf', ?, 5, '2026-01-01T00:00:00+00:00')",
        (note_id, stored_name),
    )
    connection.commit()
    connection.close()


def test_store_creates_the_attachments_table(tmp_path):
    NotesStore(tmp_path / "test.db")

    connection = sqlite3.connect(tmp_path / "test.db")
    columns = {row[1] for row in connection.execute("PRAGMA table_info(attachments)")}
    connection.close()

    assert columns == {
        "id",
        "note_id",
        "file_name",
        "stored_name",
        "size",
        "created_at",
    }


def test_delete_note_removes_its_attachments_and_their_files(tmp_path):
    db_path = tmp_path / "test.db"
    store = NotesStore(db_path)
    doomed = store.create_note("Doomed")
    kept = store.create_note("Kept")
    _attach(db_path, doomed.id, "aaaa-report.pdf")
    _attach(db_path, kept.id, "bbbb-report.pdf")

    store.delete_note(doomed.id)

    connection = sqlite3.connect(db_path)
    remaining = [
        r[0] for r in connection.execute("SELECT stored_name FROM attachments")
    ]
    connection.close()
    assert remaining == ["bbbb-report.pdf"]
    assert not (tmp_path / "attachments" / "aaaa-report.pdf").exists()
    assert (tmp_path / "attachments" / "bbbb-report.pdf").exists()


def test_delete_note_tolerates_an_attachment_file_that_is_already_gone(tmp_path):
    db_path = tmp_path / "test.db"
    store = NotesStore(db_path)
    note = store.create_note("Doomed")
    _attach(db_path, note.id, "aaaa-report.pdf")
    (tmp_path / "attachments" / "aaaa-report.pdf").unlink()

    store.delete_note(note.id)

    assert store.get_note(note.id) is None


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


def test_migration_adds_group_id_column_to_existing_db(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.execute(
        """
        CREATE TABLE notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
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
    assert notes[0].group_id is None


def test_create_note_defaults_to_ungrouped(tmp_path):
    store = NotesStore(tmp_path / "test.db")

    note = store.create_note("Test Note")

    assert note.group_id is None


def test_create_note_with_group(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    group = store.create_group("Work")

    note = store.create_note("Test Note", group_id=group.id)

    assert note.group_id == group.id


def test_create_group_supports_nesting(tmp_path):
    store = NotesStore(tmp_path / "test.db")

    parent = store.create_group("Work")
    child = store.create_group("Projects", parent_id=parent.id)

    assert child.parent_id == parent.id
    groups = {g.id: g for g in store.list_groups()}
    assert groups[parent.id].parent_id is None
    assert groups[child.id].parent_id == parent.id


def test_rename_group(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    group = store.create_group("Old Name")

    store.rename_group(group.id, "New Name")

    assert store.get_group(group.id).name == "New Name"


def test_set_note_group_moves_note(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    work = store.create_group("Work")
    personal = store.create_group("Personal")
    note = store.create_note("Test Note", group_id=work.id)

    store.set_note_group(note.id, personal.id)

    assert store.get_note(note.id).group_id == personal.id


def test_set_note_group_does_not_bump_updated_at(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    group = store.create_group("Work")
    note = store.create_note("Test Note")

    store.set_note_group(note.id, group.id)

    assert store.get_note(note.id).updated_at == note.updated_at


def test_set_note_group_reindexes(tmp_path):
    fake = FakeSearchIndex()
    store = NotesStore(tmp_path / "test.db", search_index=fake)
    group = store.create_group("Work")
    note = store.create_note("Test Note")

    store.set_note_group(note.id, group.id)

    assert fake.indexed[-1].group_id == group.id


def test_delete_group_raises_when_it_has_notes(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    group = store.create_group("Work")
    store.create_note("Test Note", group_id=group.id)

    with pytest.raises(GroupNotEmptyError):
        store.delete_group(group.id)

    assert store.get_group(group.id) is not None


def test_delete_group_raises_when_it_has_sub_groups(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    parent = store.create_group("Work")
    store.create_group("Projects", parent_id=parent.id)

    with pytest.raises(GroupNotEmptyError):
        store.delete_group(parent.id)


def test_delete_group_succeeds_when_empty(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    group = store.create_group("Work")

    store.delete_group(group.id)

    assert store.get_group(group.id) is None


def test_group_is_empty(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    empty_group = store.create_group("Empty")
    non_empty_group = store.create_group("Not Empty")
    store.create_note("Test Note", group_id=non_empty_group.id)

    assert store.group_is_empty(empty_group.id) is True
    assert store.group_is_empty(non_empty_group.id) is False
