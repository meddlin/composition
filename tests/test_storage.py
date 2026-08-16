from composition.storage import NotesStore


def test_delete_note_removes_it(tmp_path):
    store = NotesStore(tmp_path / "test.db")
    note = store.create_note("Test Note")

    store.delete_note(note.id)

    assert store.get_note(note.id) is None
    assert note.id not in [n.id for n in store.list_notes()]
