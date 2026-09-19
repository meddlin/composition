import pytest
from _doubles import FakeSearchIndex
from textual.widgets import Input, Tree

from composition.app import CompositionApp
from composition.screens.main_screen import MainScreen
from composition.screens.rename_group_modal import RenameGroupModal
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


def _highlight_group(app, group_id: int | None) -> None:
    tree = app.screen.query_one("#notes-tree", Tree)

    def find(node):
        if node.data == {"type": "group", "id": group_id}:
            return node
        for child in node.children:
            found = find(child)
            if found is not None:
                return found
        return None

    node = find(tree.root)
    assert node is not None
    tree.move_cursor(node)


async def test_r_on_group_opens_rename_modal_prefilled(app):
    group = app.notes_store.create_group("Old Name")

    async with app.run_test() as pilot:
        app.screen._refresh_notes()
        await pilot.pause()
        _highlight_group(app, group.id)
        await pilot.pause()

        await pilot.press("r")
        await pilot.pause()

        assert isinstance(app.screen, RenameGroupModal)
        assert app.screen.query_one("#name-input", Input).value == "Old Name"


async def test_submitting_rename_modal_renames_group(app):
    group = app.notes_store.create_group("Old Name")

    async with app.run_test() as pilot:
        app.screen._refresh_notes()
        await pilot.pause()
        _highlight_group(app, group.id)
        await pilot.pause()

        await pilot.press("r")
        await pilot.pause()
        name_input = app.screen.query_one("#name-input", Input)
        name_input.value = "New Name"
        await pilot.press("enter")
        await pilot.pause()

        assert isinstance(app.screen, MainScreen)
        assert app.notes_store.get_group(group.id).name == "New Name"


async def test_cancelling_rename_modal_keeps_name(app):
    group = app.notes_store.create_group("Old Name")

    async with app.run_test() as pilot:
        app.screen._refresh_notes()
        await pilot.pause()
        _highlight_group(app, group.id)
        await pilot.pause()

        await pilot.press("r")
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()

        assert isinstance(app.screen, MainScreen)
        assert app.notes_store.get_group(group.id).name == "Old Name"


async def test_r_on_a_note_does_nothing(app):
    note = app.notes_store.create_note("Test Note")

    async with app.run_test() as pilot:
        await pilot.pause()
        tree = app.screen.query_one("#notes-tree", Tree)

        def find(node):
            if node.data == {"type": "note", "id": note.id}:
                return node
            for child in node.children:
                found = find(child)
                if found is not None:
                    return found
            return None

        tree.move_cursor(find(tree.root))
        await pilot.pause()

        await pilot.press("r")
        await pilot.pause()

        assert isinstance(app.screen, MainScreen)


async def test_r_on_ungrouped_bucket_does_nothing(app):
    app.notes_store.create_note("Test Note")  # lands in the "Ungrouped" bucket

    async with app.run_test() as pilot:
        await pilot.pause()
        _highlight_group(app, None)
        await pilot.pause()

        await pilot.press("r")
        await pilot.pause()

        assert isinstance(app.screen, MainScreen)
