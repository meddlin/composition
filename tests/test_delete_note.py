import pytest
from _doubles import FakeSearchIndex

from composition.app import CompositionApp
from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.main_screen import MainScreen
from composition.settings import AppSettings


@pytest.fixture
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "composition.db"
    fake_search = FakeSearchIndex()
    monkeypatch.setattr(
        "composition.app.load_settings",
        lambda: AppSettings(db_path=db_path),
    )
    return CompositionApp(search_index=fake_search)


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
