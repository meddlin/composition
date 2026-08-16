import pytest

from composition.app import CompositionApp
from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.main_screen import MainScreen
from composition.storage import NotesStore


@pytest.fixture
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "composition.db"
    monkeypatch.setattr("composition.app.NotesStore", lambda: NotesStore(db_path))
    return CompositionApp()


async def test_ctrl_d_shows_confirmation_modal(app):
    app.notes_store.create_note("Test Note")

    async with app.run_test() as pilot:
        await pilot.press("ctrl+d")
        await pilot.pause()

        assert isinstance(app.screen, ConfirmDeleteModal)


async def test_confirming_delete_removes_note(app):
    note = app.notes_store.create_note("Test Note")

    async with app.run_test() as pilot:
        await pilot.press("ctrl+d")
        await pilot.pause()
        await pilot.press("y")
        await pilot.pause()

        assert app.notes_store.get_note(note.id) is None
        assert isinstance(app.screen, MainScreen)


async def test_cancel_preserves_note(app):
    note = app.notes_store.create_note("Test Note")

    async with app.run_test() as pilot:
        await pilot.press("ctrl+d")
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()

        assert app.notes_store.get_note(note.id) is not None
