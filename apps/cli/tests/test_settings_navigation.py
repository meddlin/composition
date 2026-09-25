import pytest
from _doubles import FakeSearchIndex
from textual.widgets import Tree

from composition.app import CompositionApp
from composition.screens.settings_screen import SettingsScreen
from composition.settings import AppSettings


@pytest.fixture
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "composition.db"
    fake_search = FakeSearchIndex()
    monkeypatch.setattr(
        "composition.app.load_settings",
        lambda: AppSettings(app_data_dir=db_path.parent),
    )
    return CompositionApp(search_index=fake_search)


def _settings_node(tree: Tree):
    for node in tree.root.children:
        if node.data == {"type": "settings", "id": None}:
            return node
    return None


async def test_settings_entry_pinned_at_bottom_of_tree(app):
    app.notes_store.create_note("Test Note")

    async with app.run_test() as pilot:
        app.screen._refresh_notes()
        await pilot.pause()

        tree = app.screen.query_one("#notes-tree", Tree)
        assert tree.root.children[-1].label.plain == "⚙ Settings"
        assert tree.root.children[-1].data == {"type": "settings", "id": None}


async def test_selecting_settings_entry_opens_settings_screen(app):
    async with app.run_test() as pilot:
        app.screen._refresh_notes()
        await pilot.pause()

        tree = app.screen.query_one("#notes-tree", Tree)
        node = _settings_node(tree)
        assert node is not None

        tree.move_cursor(node)
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()

        assert isinstance(app.screen, SettingsScreen)
